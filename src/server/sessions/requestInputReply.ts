/**
 * Pure helpers for delivering asynchronous `request_input` replies into a
 * session. The reply arrives from an external inbox server (via the pi-web
 * webhook) long after the requesting agent run ended; it is injected as a
 * plain user message whose first line doubles as the durable dedupe marker —
 * a rescan of the session file finds it even after sessiond restarts.
 */

export const REQUEST_INPUT_REPLY_MARKER_PREFIX = "[request_input reply requestId=";

export interface RequestInputReply {
  requestId: string;
  answer: string;
  answeredBy?: string;
}

export type RequestInputReplyStatus = "delivered" | "queued" | "duplicate";

/** The user message injected into the session for a reply. */
export function formatReplyMessage(reply: RequestInputReply): string {
  const from = reply.answeredBy === undefined || reply.answeredBy === "" ? "user" : reply.answeredBy;
  return `${REQUEST_INPUT_REPLY_MARKER_PREFIX}${reply.requestId} from=${from}]\n${reply.answer}`;
}

/**
 * Whole-file scan for a previously injected reply to `requestId`. Looks at
 * persisted user messages only — the marker line is always the start of the
 * injected message text.
 */
export function hasReplyMarker(entries: readonly unknown[], requestId: string): boolean {
  const marker = `${REQUEST_INPUT_REPLY_MARKER_PREFIX}${requestId} `;
  for (const entry of entries) {
    if (userMessageText(entry)?.startsWith(marker) === true) return true;
  }
  return false;
}

/**
 * Validate a reply payload (the inbox webhook body). Unknown fields are
 * ignored so contract additions stay backward-compatible. Throws on anything
 * unusable — callers map that to HTTP 400.
 */
export function parseReplyBody(body: Record<string, unknown>): RequestInputReply {
  const requestId = body["requestId"];
  if (typeof requestId !== "string" || requestId === "") throw new Error("requestId field must be a non-empty string");
  const answer = body["answer"];
  if (typeof answer !== "string" || answer === "") throw new Error("answer field must be a non-empty string");
  const answeredBy = body["answeredBy"];
  if (answeredBy !== undefined && typeof answeredBy !== "string") throw new Error("answeredBy field must be a string");
  return { requestId, answer, ...(answeredBy === undefined || answeredBy === "" ? {} : { answeredBy }) };
}

/** Text of a persisted user-message session entry, or undefined for anything else. */
function userMessageText(entry: unknown): string | undefined {
  if (!isRecord(entry) || entry["type"] !== "message") return undefined;
  const message = entry["message"];
  if (!isRecord(message) || message["role"] !== "user") return undefined;
  const content = message["content"];
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  for (const part of content) {
    if (isRecord(part) && part["type"] === "text" && typeof part["text"] === "string") return part["text"];
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
