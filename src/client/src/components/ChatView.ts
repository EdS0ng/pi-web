import { LitElement, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ChatLine, ChatPart } from "./shared";
import { chatStyles } from "./shared";
import "./FormattedText";

@customElement("chat-view")
export class ChatView extends LitElement {
  @property({ attribute: false }) messages: ChatLine[] = [];
  @query(".chat") private chat?: HTMLDivElement;
  @state() private pinnedToBottom = true;

  protected willUpdate(): void {
    this.pinnedToBottom = this.isNearBottom();
  }

  protected updated(): void {
    if (this.pinnedToBottom) this.scrollToBottom();
  }

  render() {
    return html`
      <div class="chat" @scroll=${this.onScroll}>
        ${this.messages.map((message) => html`
          <article class="msg ${message.role}">
            <b class="label">${message.role}</b>
            ${message.parts.map((part) => this.renderPart(part))}
          </article>
        `)}
      </div>
    `;
  }

  private renderPart(part: ChatPart) {
    if (part.type === "text") return html`<formatted-text class="part" .text=${part.text}></formatted-text>`;
    if (part.type === "thinking") return html`<details class="part"><summary>thinking</summary><formatted-text .text=${part.text}></formatted-text></details>`;
    if (part.type === "toolCall") return html`<div class="part tool-line">▶ ${part.toolName}<span class="summary">${part.summary}</span></div>`;
    if (part.type === "toolResult") return html`
      <details class="part" ?open=${part.isError}>
        <summary>${part.isError ? "✖" : "✓"} ${part.toolName} result</summary>
        <formatted-text .text=${part.text}></formatted-text>
      </details>
    `;
    return null;
  }

  private onScroll() {
    this.pinnedToBottom = this.isNearBottom();
  }

  private isNearBottom(): boolean {
    const chat = this.chat;
    if (!chat) return true;
    return chat.scrollHeight - chat.scrollTop - chat.clientHeight < 48;
  }

  private scrollToBottom() {
    const chat = this.chat;
    if (chat) chat.scrollTop = chat.scrollHeight;
  }

  static styles = chatStyles;
}
