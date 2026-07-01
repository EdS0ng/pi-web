import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionUiEvent } from "../../shared/apiTypes.js";
import { WebExtensionUiService } from "./webExtensionUiService.js";

afterEach(() => {
  vi.useRealTimers();
});

interface RecordedEvent {
  sessionId: string;
  event: SessionUiEvent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function dataOf(event: SessionUiEvent): Record<string, unknown> {
  if (event.type !== "pi.event" || !isRecord(event.data)) throw new Error("expected pi.event with object data");
  return event.data;
}

function stringField(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== "string") throw new Error(`expected string field ${key}`);
  return value;
}

function recordingHub() {
  const events: RecordedEvent[] = [];
  const dataFor = (eventType: string): Record<string, unknown>[] =>
    events.filter((entry) => entry.event.type === "pi.event" && entry.event.eventType === eventType).map((entry) => dataOf(entry.event));
  return {
    events,
    publish(sessionId: string, event: SessionUiEvent): void { events.push({ sessionId, event }); },
    requestDatas: (): Record<string, unknown>[] => dataFor("ui.request"),
    cancelIds: (): string[] => dataFor("ui.cancel").map((data) => stringField(data, "requestId")),
    notifyDatas: (): Record<string, unknown>[] => dataFor("ui.notify"),
  };
}

function requestDataAt(datas: Record<string, unknown>[], index: number): Record<string, unknown> {
  const data = datas[index];
  if (data === undefined) throw new Error(`no request at index ${String(index)}`);
  return data;
}

describe("WebExtensionUiService", () => {
  it("publishes a ui.request and resolves select on respond", async () => {
    const hub = recordingHub();
    const service = new WebExtensionUiService(hub, { requestTtlMs: 0 });
    const ui = service.contextFor("session-1");

    const pending = ui.select("Pick one", ["a", "b"]);
    const datas = hub.requestDatas();
    expect(datas).toHaveLength(1);
    const request = requestDataAt(datas, 0);
    expect(request).toMatchObject({ kind: "select", title: "Pick one", options: [{ value: "a", label: "a" }, { value: "b", label: "b" }] });
    expect(hub.events[0]?.sessionId).toBe("session-1");

    service.respond("session-1", stringField(request, "requestId"), "b");
    await expect(pending).resolves.toBe("b");
  });

  it("resolves input on respond and rejects empty values", async () => {
    const hub = recordingHub();
    const service = new WebExtensionUiService(hub, { requestTtlMs: 0 });
    const ui = service.contextFor("s");

    const pending = ui.input("Name", "type here");
    const request = requestDataAt(hub.requestDatas(), 0);
    expect(request).toMatchObject({ kind: "input", title: "Name", placeholder: "type here", allowEmpty: false });
    const requestId = stringField(request, "requestId");

    expect(() => { service.respond("s", requestId, "   "); }).toThrow("A value is required");
    service.respond("s", requestId, "Ada");
    await expect(pending).resolves.toBe("Ada");
  });

  it("maps confirm yes to true and anything else to false", async () => {
    const hub = recordingHub();
    const service = new WebExtensionUiService(hub, { requestTtlMs: 0 });
    const ui = service.contextFor("s");

    const yes = ui.confirm("Delete?", "This cannot be undone");
    const yesRequest = requestDataAt(hub.requestDatas(), 0);
    expect(yesRequest).toMatchObject({ kind: "confirm", message: "This cannot be undone" });
    service.respond("s", stringField(yesRequest, "requestId"), "yes");
    await expect(yes).resolves.toBe(true);

    const no = ui.confirm("Delete?", "Sure?");
    const noRequest = requestDataAt(hub.requestDatas(), 1);
    service.respond("s", stringField(noRequest, "requestId"), "no");
    await expect(no).resolves.toBe(false);
  });

  it("throws for unknown, wrong-session, or already-answered requests", async () => {
    const hub = recordingHub();
    const service = new WebExtensionUiService(hub, { requestTtlMs: 0 });
    const ui = service.contextFor("s");

    const pending = ui.select("Pick", ["a"]);
    const requestId = stringField(requestDataAt(hub.requestDatas(), 0), "requestId");

    expect(() => { service.respond("s", "missing", "a"); }).toThrow("UI request expired");
    expect(() => { service.respond("other-session", requestId, "a"); }).toThrow("UI request expired");

    service.respond("s", requestId, "a");
    await expect(pending).resolves.toBe("a");
    expect(() => { service.respond("s", requestId, "a"); }).toThrow("UI request expired");
  });

  it("broadcasts a ui.cancel when a request settles so other tabs close", async () => {
    const hub = recordingHub();
    const service = new WebExtensionUiService(hub, { requestTtlMs: 0 });
    const ui = service.contextFor("s");

    const pending = ui.select("Pick", ["a"]);
    const requestId = stringField(requestDataAt(hub.requestDatas(), 0), "requestId");
    service.respond("s", requestId, "a");
    await pending;

    expect(hub.cancelIds()).toEqual([requestId]);
  });

  it("resolves to undefined on cancel", async () => {
    const hub = recordingHub();
    const service = new WebExtensionUiService(hub, { requestTtlMs: 0 });
    const ui = service.contextFor("s");

    const pending = ui.input("Name");
    const requestId = stringField(requestDataAt(hub.requestDatas(), 0), "requestId");
    service.cancel("s", requestId);
    await expect(pending).resolves.toBeUndefined();
  });

  it("resolves all pending requests for a session to undefined on teardown", async () => {
    const hub = recordingHub();
    const service = new WebExtensionUiService(hub, { requestTtlMs: 0 });
    const ui = service.contextFor("s");

    const first = ui.select("One", ["a"]);
    const second = ui.input("Two");
    service.rejectPendingForSession("s");

    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
  });

  it("publishes notify without parking a pending request", () => {
    const hub = recordingHub();
    const service = new WebExtensionUiService(hub, { requestTtlMs: 0 });
    const ui = service.contextFor("s");

    ui.notify("Heads up", "warning");

    expect(hub.requestDatas()).toHaveLength(0);
    expect(hub.notifyDatas()).toEqual([{ message: "Heads up", type: "warning" }]);
  });

  it("resolves to undefined when the abort signal fires", async () => {
    const hub = recordingHub();
    const service = new WebExtensionUiService(hub, { requestTtlMs: 0 });
    const ui = service.contextFor("s");
    const controller = new AbortController();

    const pending = ui.select("Pick", ["a"], { signal: controller.signal });
    controller.abort();
    await expect(pending).resolves.toBeUndefined();
  });

  it("resolves to undefined when an already-aborted signal is supplied and shows no UI", async () => {
    const hub = recordingHub();
    const service = new WebExtensionUiService(hub, { requestTtlMs: 0 });
    const ui = service.contextFor("s");
    const controller = new AbortController();
    controller.abort();

    await expect(ui.select("Pick", ["a"], { signal: controller.signal })).resolves.toBeUndefined();
    expect(hub.requestDatas()).toHaveLength(0);
  });

  it("resolves to undefined when the request times out", async () => {
    vi.useFakeTimers();
    const hub = recordingHub();
    const service = new WebExtensionUiService(hub, { requestTtlMs: 0 });
    const ui = service.contextFor("s");

    const pending = ui.input("Name", undefined, { timeout: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toBeUndefined();
  });
});
