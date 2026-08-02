import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { PiSessionService } from "./piSessionService.js";
import { PendingAskStore } from "./pendingAskStore.js";
import { PendingExtensionDialogStore } from "./pendingExtensionDialogStore.js";
import { CapturingSessionEventHub, emptyArchiveStore, fakeRuntime, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";

const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";

/**
 * A service whose heartbeat ticks once a second and reaps after five, over fake
 * timers. `heartbeatIntervalMs` is what drives the reap sweep, so it has to be
 * well under the timeout for a test to observe the sweep at all.
 */
function reapingService(sessionId: string, options: {
  idleSessionTimeoutMs?: number;
  runtimePatch?: Parameters<typeof fakeRuntime>[1];
  pendingAskStore?: PendingAskStore;
  pendingExtensionDialogStore?: PendingExtensionDialogStore;
  askUserEnabled?: boolean;
} = {}) {
  const fake = fakeRuntime(sessionId, options.runtimePatch ?? {});
  const events = new CapturingSessionEventHub();
  const service = new PiSessionService(events, {
    agentDir: TEST_AGENT_DIR,
    modelRuntime: testModelRuntime,
    sessionManager: sessionGateway([sessionRecord(sessionId)]),
    archiveStore: emptyArchiveStore(),
    createAgentRuntime: runtimeCreator(fake.runtime),
    heartbeatIntervalMs: 1_000,
    idleSessionTimeoutMs: options.idleSessionTimeoutMs ?? 5_000,
    ...(options.pendingAskStore === undefined ? {} : { pendingAskStore: options.pendingAskStore }),
    ...(options.pendingExtensionDialogStore === undefined ? {} : { pendingExtensionDialogStore: options.pendingExtensionDialogStore }),
    ...(options.askUserEnabled === true ? { askUserEnabled: true } : {}),
  });
  return { service, events, fake };
}

/** Start the session and return the UI context its extensions were bound with. */
async function boundUiContext(service: PiSessionService, fake: ReturnType<typeof fakeRuntime>, sessionId: string): Promise<ExtensionUIContext> {
  await service.status(sessionRef(sessionId));
  const bindings = fake.calls.bindExtensions.at(-1);
  if (bindings?.uiContext === undefined) throw new Error("session extensions were not bound");
  return bindings.uiContext;
}

describe("PiSessionService idle session reaping", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("reaps a session idle past the timeout and reopens it on demand", async () => {
    vi.useFakeTimers();
    const { service, fake } = reapingService("reap-session");
    try {
      await service.status(sessionRef("reap-session"));
      expect(service.activeCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(6_000);

      expect(service.activeCount()).toBe(0);
      expect(fake.calls.dispose).toBe(1);

      // Session state lives in the session file, so the next use reopens it.
      await expect(service.status(sessionRef("reap-session"))).resolves.toMatchObject({ sessionId: "reap-session" });
      expect(service.activeCount()).toBe(1);
    } finally {
      await service.dispose();
    }
  });

  it("counts a lookup as activity, so a session in use is never reaped", async () => {
    vi.useFakeTimers();
    const { service } = reapingService("busy-lookup-session");
    try {
      await service.status(sessionRef("busy-lookup-session"));

      for (let tick = 0; tick < 5; tick += 1) {
        await vi.advanceTimersByTimeAsync(3_000);
        await service.status(sessionRef("busy-lookup-session"));
      }

      expect(service.activeCount()).toBe(1);
    } finally {
      await service.dispose();
    }
  });

  it("counts session events as activity when deciding idleness", async () => {
    vi.useFakeTimers();
    let listener: ((event: unknown) => void) | undefined;
    const { service } = reapingService("event-session", {
      runtimePatch: {
        subscribe: (next: (event: unknown) => void) => {
          listener = next;
          return () => undefined;
        },
      },
    });
    try {
      await service.status(sessionRef("event-session"));

      await vi.advanceTimersByTimeAsync(3_000);
      listener?.({ type: "message_end" });

      // 3s after the event: below the 5s timeout only because the event reset it.
      await vi.advanceTimersByTimeAsync(3_000);
      expect(service.activeCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(3_000);
      expect(service.activeCount()).toBe(0);
    } finally {
      await service.dispose();
    }
  });

  it("does not reap a session with in-flight work", async () => {
    vi.useFakeTimers();
    const { service, fake } = reapingService("streaming-session", { runtimePatch: { isStreaming: true } });
    try {
      await service.status(sessionRef("streaming-session"));

      await vi.advanceTimersByTimeAsync(20_000);

      expect(service.activeCount()).toBe(1);
      expect(fake.calls.dispose).toBe(0);
    } finally {
      await service.dispose();
    }
  });

  // Closing the runtime settles open dialogs, which the waiting extension sees as
  // the user dismissing them — so an unanswered dialog has to pin the session.
  it("does not reap a session while an extension awaits a dialog answer", async () => {
    vi.useFakeTimers();
    const store = new PendingExtensionDialogStore({ now: () => new Date("2026-02-01T10:00:00.000Z") });
    const { service, fake } = reapingService("dialog-session", { pendingExtensionDialogStore: store });
    try {
      const uiContext = await boundUiContext(service, fake, "dialog-session");
      // `timeout: 0` waits forever, so only the reap guard keeps this alive.
      const selection = uiContext.select("Pick one", ["a", "b"], { timeout: 0 });

      await vi.advanceTimersByTimeAsync(30_000);

      expect(store.pendingDialogs("dialog-session")).toHaveLength(1);
      expect(service.activeCount()).toBe(1);

      const dialogId = store.pendingDialogs("dialog-session")[0]?.dialogId ?? "";
      await service.answerDialog(sessionRef("dialog-session"), dialogId, "b");
      await expect(selection).resolves.toBe("b");

      // Answered and idle again: the next sweep reaps it.
      await vi.advanceTimersByTimeAsync(6_000);
      expect(service.activeCount()).toBe(0);
    } finally {
      await service.dispose();
    }
  });

  // closeActive drops an open ask outright ("no one is left to receive the
  // answers"), so reaping would discard the question the human is answering.
  it("does not reap a session with an open ask_user question", async () => {
    vi.useFakeTimers();
    const store = new PendingAskStore({ now: () => new Date("2026-02-01T10:00:00.000Z") });
    const { service } = reapingService("ask-session", { pendingAskStore: store, askUserEnabled: true });
    try {
      await service.status(sessionRef("ask-session"));
      const { ask } = await service.openAsk({
        sessionId: "ask-session",
        questions: [{ id: "db", question: "Which database?", options: [{ value: "pg", label: "Postgres" }] }],
      });

      await vi.advanceTimersByTimeAsync(30_000);

      expect(service.activeCount()).toBe(1);

      await service.submitAsk(sessionRef("ask-session"), ask.askId, { answers: [{ id: "db", values: ["pg"] }] });

      await vi.advanceTimersByTimeAsync(6_000);
      expect(service.activeCount()).toBe(0);
    } finally {
      await service.dispose();
    }
  });

  it("keeps every session in memory when reaping is disabled", async () => {
    vi.useFakeTimers();
    const { service, fake } = reapingService("pinned-session", { idleSessionTimeoutMs: 0 });
    try {
      await service.status(sessionRef("pinned-session"));

      await vi.advanceTimersByTimeAsync(600_000);

      expect(service.activeCount()).toBe(1);
      expect(fake.calls.dispose).toBe(0);
    } finally {
      await service.dispose();
    }
  });
});
