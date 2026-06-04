import { describe, expect, it } from "vitest";
import type { SessionInfo, SessionStatus } from "./api";
import { markCachedNewSessionInfo } from "./cachedNewSessions";
import { canArchiveSession, canDeleteSession, primarySessionAction } from "./sessionActions";

const session: SessionInfo = {
  id: "s1",
  path: "/tmp/s1.jsonl",
  cwd: "/repo",
  created: "2026-06-01T00:00:00.000Z",
  modified: "2026-06-01T00:00:00.000Z",
  messageCount: 0,
  firstMessage: "",
};

function status(patch: Partial<SessionStatus> = {}): SessionStatus {
  return {
    sessionId: session.id,
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    ...patch,
  };
}

describe("session actions", () => {
  it("uses server persistence to keep ephemeral sessions discardable", () => {
    expect(primarySessionAction(markCachedNewSessionInfo(session), status({ persistence: "ephemeral", actions: { archive: false, discard: true, restore: false } }))).toMatchObject({ kind: "delete", enabled: true });
    expect(canDeleteSession(markCachedNewSessionInfo(session), status({ persistence: "ephemeral", actions: { archive: false, discard: true, restore: false } }))).toBe(true);
  });

  it("prefers server-confirmed persistence over the browser cache marker", () => {
    const persisted = status({ persistence: "persisted", actions: { archive: true, discard: false, restore: false } });

    expect(primarySessionAction(markCachedNewSessionInfo(session), persisted)).toMatchObject({ kind: "archive", enabled: true });
    expect(canArchiveSession(markCachedNewSessionInfo(session), persisted)).toBe(true);
  });

  it("keeps persisted active sessions on archive but disabled", () => {
    expect(primarySessionAction({ ...session, persistence: "persisted" }, status({ isBashRunning: true, persistence: "persisted", actions: { archive: false, discard: false, restore: false } }))).toMatchObject({ kind: "archive", enabled: false });
  });

  it("restores archived sessions", () => {
    expect(primarySessionAction({ ...session, archived: true, persistence: "archived" })).toMatchObject({ kind: "restore", enabled: true });
  });
});
