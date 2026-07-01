import type { GlobalSessionEvent, RealtimeEvent, SessionUiEvent } from "../../shared/apiTypes.js";

export interface RealtimeSocket {
  readonly OPEN: number;
  readyState: number;
  send(payload: string): void;
  on(event: "close", listener: () => void): unknown;
}

export class SessionEventHub {
  private readonly socketsBySession = new Map<string, Set<RealtimeSocket>>();
  private readonly globalSockets = new Set<RealtimeSocket>();

  add(sessionId: string, socket: RealtimeSocket): void {
    let sockets = this.socketsBySession.get(sessionId);
    if (!sockets) {
      sockets = new Set();
      this.socketsBySession.set(sessionId, sockets);
    }
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  }

  addGlobal(socket: RealtimeSocket): void {
    this.globalSockets.add(socket);
    socket.on("close", () => this.globalSockets.delete(socket));
  }

  publish(sessionId: string, event: SessionUiEvent): void {
    const payload = serializeEvent(event);
    if (payload === undefined) return;
    for (const socket of this.socketsBySession.get(sessionId) ?? []) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }

  publishGlobal(event: GlobalSessionEvent): void {
    this.publishRealtime(event);
  }

  publishRealtime(event: RealtimeEvent): void {
    const payload = serializeEvent(event);
    if (payload === undefined) return;
    for (const socket of this.globalSockets) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  }
}

/**
 * Serialize an event for the wire, returning `undefined` if it can't be
 * serialized. `pi.event.data` carries arbitrary plugin-pushed payloads, so a
 * circular reference or other non-serializable value must drop that one event
 * rather than throw and break delivery for the whole session.
 */
function serializeEvent(event: RealtimeEvent | SessionUiEvent): string | undefined {
  try {
    return JSON.stringify(event);
  } catch (error) {
    console.warn("sessionEventHub: dropping non-serializable event", error);
    return undefined;
  }
}
