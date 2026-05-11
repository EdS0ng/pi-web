import { describe, expect, it } from "vitest";
import { textMessage } from "./chatMessages";
import { applyTranscriptEvent } from "./chatTranscript";
import type { ChatLine } from "./components/shared";

const finalAssistant = {
  role: "assistant",
  content: [
    { type: "thinking", thinking: "plan" },
    { type: "text", text: "answer" },
  ],
  timestamp: "2026-05-09T12:00:00.000Z",
  provider: "test",
  model: "model",
};

describe("applyTranscriptEvent", () => {
  it("streams thinking and text into one assistant message", () => {
    let messages: ChatLine[] = [];
    messages = applyTranscriptEvent(messages, { type: "assistant.thinking.delta", text: "pla" }) ?? messages;
    messages = applyTranscriptEvent(messages, { type: "assistant.thinking.delta", text: "n" }) ?? messages;
    messages = applyTranscriptEvent(messages, { type: "assistant.delta", text: "answer" }) ?? messages;

    expect(messages).toEqual([
      { role: "assistant", parts: [{ type: "thinking", text: "plan" }, { type: "text", text: "answer" }] },
    ]);
  });

  it("replaces the streamed assistant message with the finalized history shape", () => {
    const streamed: ChatLine[] = [
      textMessage("user", "question"),
      { role: "assistant", parts: [{ type: "thinking", text: "partial" }, { type: "text", text: "partial answer" }] },
    ];

    expect(applyTranscriptEvent(streamed, { type: "message.end", message: finalAssistant })).toEqual([
      textMessage("user", "question"),
      {
        role: "assistant",
        parts: [{ type: "thinking", text: "plan" }, { type: "text", text: "answer" }],
        meta: { timestamp: "2026-05-09T12:00:00.000Z", model: { provider: "test", id: "model" } },
      },
    ]);
  });

  it("replaces streamed skill reads when the finalized assistant tool call arrives after the tool result", () => {
    const streamed: ChatLine[] = [
      { role: "skill", parts: [{ type: "skillRead", name: "playwright", path: "/skills/playwright/SKILL.md" }] },
      { role: "tool", parts: [{ type: "toolResult", toolName: "read", text: "skill content", isError: false }] },
    ];

    expect(applyTranscriptEvent(streamed, {
      type: "message.end",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", name: "read", arguments: { path: "/skills/playwright/SKILL.md" } }],
        timestamp: "2026-05-09T12:00:00.000Z",
      },
    })).toEqual([
      { role: "skill", parts: [{ type: "skillRead", name: "playwright", path: "/skills/playwright/SKILL.md" }], meta: { timestamp: "2026-05-09T12:00:00.000Z" } },
      { role: "tool", parts: [{ type: "toolResult", toolName: "read", text: "skill content", isError: false }] },
    ]);
  });

  it("does not merge different finalized user messages", () => {
    const messages = [textMessage("user", "first queued prompt")];

    expect(applyTranscriptEvent(messages, { type: "message.end", message: { role: "user", content: "second queued prompt" } })).toEqual([
      textMessage("user", "first queued prompt"),
      textMessage("user", "second queued prompt"),
    ]);
  });

  it("replaces an optimistic user message when the finalized text matches", () => {
    const messages = [textMessage("user", "sent prompt")];

    expect(applyTranscriptEvent(messages, { type: "message.end", message: { role: "user", content: "sent prompt", timestamp: "2026-05-09T12:00:00.000Z" } })).toEqual([
      { ...textMessage("user", "sent prompt"), meta: { timestamp: "2026-05-09T12:00:00.000Z" } },
    ]);
  });
});
