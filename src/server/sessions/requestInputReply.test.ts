import { describe, expect, it } from "vitest";
import { formatReplyMessage, hasReplyMarker, parseReplyBody } from "./requestInputReply.js";

function userEntry(content: unknown) {
  return { type: "message", id: "e1", parentId: null, timestamp: "2026-07-17T00:00:00.000Z", message: { role: "user", content } };
}

describe("formatReplyMessage", () => {
  it("tags the answer with requestId and answeredBy", () => {
    expect(formatReplyMessage({ requestId: "req-1", answer: "yes, proceed", answeredBy: "supervisor" }))
      .toBe("[request_input reply requestId=req-1 from=supervisor]\nyes, proceed");
  });

  it("defaults answeredBy to user (also for empty string)", () => {
    expect(formatReplyMessage({ requestId: "req-1", answer: "ok" })).toBe("[request_input reply requestId=req-1 from=user]\nok");
    expect(formatReplyMessage({ requestId: "req-1", answer: "ok", answeredBy: "" })).toBe("[request_input reply requestId=req-1 from=user]\nok");
  });
});

describe("hasReplyMarker", () => {
  const marker = formatReplyMessage({ requestId: "req-1", answer: "ok" });

  it("finds the marker in string-content user messages", () => {
    expect(hasReplyMarker([userEntry("unrelated"), userEntry(marker)], "req-1")).toBe(true);
  });

  it("finds the marker in block-content user messages", () => {
    expect(hasReplyMarker([userEntry([{ type: "text", text: marker }])], "req-1")).toBe(true);
  });

  it("does not match other requestIds, including prefixes", () => {
    expect(hasReplyMarker([userEntry(marker)], "req-2")).toBe(false);
    expect(hasReplyMarker([userEntry(marker)], "req")).toBe(false);
  });

  it("ignores non-user, non-message, and malformed entries", () => {
    const assistantEntry = { type: "message", message: { role: "assistant", content: marker } };
    const customEntry = { type: "custom", customType: "x", data: { text: marker } };
    expect(hasReplyMarker([assistantEntry, customEntry, null, "junk", userEntry(42)], "req-1")).toBe(false);
  });

  it("ignores user messages that merely mention the marker mid-text", () => {
    expect(hasReplyMarker([userEntry(`context: ${marker}`)], "req-1")).toBe(false);
  });
});

describe("parseReplyBody", () => {
  it("accepts a full inbox webhook body and keeps only the reply fields", () => {
    expect(parseReplyBody({
      kind: "request_input.reply",
      version: 1,
      requestId: "req-1",
      sessionId: "sess-1",
      answer: "yes",
      answeredBy: "user",
      answeredAt: "2026-07-17T00:00:00.000Z",
    })).toEqual({ requestId: "req-1", answer: "yes", answeredBy: "user" });
  });

  it("omits answeredBy when absent or empty", () => {
    expect(parseReplyBody({ requestId: "req-1", answer: "yes" })).toEqual({ requestId: "req-1", answer: "yes" });
    expect(parseReplyBody({ requestId: "req-1", answer: "yes", answeredBy: "" })).toEqual({ requestId: "req-1", answer: "yes" });
  });

  it("rejects missing or empty requestId/answer and non-string answeredBy", () => {
    expect(() => parseReplyBody({ answer: "yes" })).toThrow("requestId field must be a non-empty string");
    expect(() => parseReplyBody({ requestId: "", answer: "yes" })).toThrow("requestId field must be a non-empty string");
    expect(() => parseReplyBody({ requestId: "req-1" })).toThrow("answer field must be a non-empty string");
    expect(() => parseReplyBody({ requestId: "req-1", answer: "" })).toThrow("answer field must be a non-empty string");
    expect(() => parseReplyBody({ requestId: "req-1", answer: "yes", answeredBy: 7 })).toThrow("answeredBy field must be a string");
  });
});
