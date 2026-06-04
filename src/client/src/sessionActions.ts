import type { SessionInfo, SessionStatus } from "./api";
import { isCachedNewSessionInfo } from "./cachedNewSessions";
import { isSessionActive } from "../../shared/activity";

export type SessionPrimaryAction =
  | { kind: "archive"; enabled: boolean; title: string }
  | { kind: "delete"; enabled: boolean; title: string }
  | { kind: "restore"; enabled: boolean; title: string };

export function primarySessionAction(session: SessionInfo, status?: SessionStatus): SessionPrimaryAction {
  const persistence = status?.persistence ?? session.persistence;
  const actions = status?.actions ?? session.actions;

  if (session.archived === true || persistence === "archived") {
    return { kind: "restore", enabled: actions?.restore ?? true, title: "Restore session" };
  }

  if (persistence === "ephemeral" || (persistence === undefined && isCachedNewSessionInfo(session))) {
    return { kind: "delete", enabled: actions?.discard ?? true, title: "Delete new session" };
  }

  const active = status !== undefined && isSessionActive(status);
  return {
    kind: "archive",
    enabled: actions?.archive ?? !active,
    title: active ? "Stop current session activity before archiving" : "Archive session",
  };
}

export function canArchiveSession(session: SessionInfo | undefined, status?: SessionStatus): boolean {
  if (session === undefined) return false;
  const action = primarySessionAction(session, status);
  return action.kind === "archive" && action.enabled;
}

export function canDeleteSession(session: SessionInfo | undefined, status?: SessionStatus): boolean {
  if (session === undefined) return false;
  const action = primarySessionAction(session, status);
  return action.kind === "delete" && action.enabled;
}

export function isEphemeralSession(session: SessionInfo | undefined, status?: SessionStatus): boolean {
  if (session === undefined) return false;
  const persistence = status?.persistence ?? session.persistence;
  return persistence === "ephemeral" || (persistence === undefined && isCachedNewSessionInfo(session));
}
