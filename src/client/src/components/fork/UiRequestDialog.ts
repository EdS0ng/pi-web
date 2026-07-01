import { LitElement, css, html, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { UiRequestPayload } from "../../../../shared/forkUiRequest";
import { commandPickerStyles } from "../shared";

/**
 * Fork-owned modal for the agent→user question loop. An extension's
 * `ctx.ui.select/input/confirm` arrives as a `pi.event`/`ui.request`; this dialog
 * collects the answer and `onRespond`s it back so the agent turn continues.
 *
 * Modeled on `AuthDialog` (backdrop + section + per-kind body) and reuses
 * `commandPickerStyles` so it matches the command picker. Cancelling (close,
 * Escape, backdrop) resolves the request to the SDK's "dismissed" value.
 */
@customElement("fork-ui-request-dialog")
export class UiRequestDialog extends LitElement {
  @property({ attribute: false }) request?: UiRequestPayload;
  @property({ type: Boolean }) responding = false;
  @property({ attribute: false }) onRespond?: (value: string) => void;
  @property({ attribute: false }) onCancel?: () => void;
  @state() private inputValue = "";
  private lastRequestId: string | undefined;

  override render(): TemplateResult | null {
    const request = this.request;
    if (request === undefined) return null;
    return html`
      <div class="backdrop" @mousedown=${() => { this.onCancel?.(); }}>
        <section @mousedown=${(event: MouseEvent) => { event.stopPropagation(); }} @keydown=${(event: KeyboardEvent) => { this.handleKeyDown(event); }}>
          <header>
            <strong>${request.title}</strong>
            <button title="Close" @click=${() => { this.onCancel?.(); }}>×</button>
          </header>
          ${this.renderBody(request)}
        </section>
      </div>
    `;
  }

  protected override updated(): void {
    // Reset the text field whenever a new request takes over the dialog, then
    // focus it so input questions are immediately typeable.
    if (this.request?.requestId === this.lastRequestId) return;
    this.lastRequestId = this.request?.requestId;
    this.inputValue = "";
    if (this.request?.kind === "input") this.renderRoot.querySelector<HTMLInputElement>("input")?.focus();
  }

  private renderBody(request: UiRequestPayload): TemplateResult {
    if (request.kind === "select") return this.renderSelect(request);
    if (request.kind === "confirm") return this.renderConfirm(request);
    return this.renderInput(request);
  }

  private renderSelect(request: UiRequestPayload): TemplateResult {
    const options = request.options ?? [];
    return html`
      <div class="options">
        ${options.length === 0 ? html`<div class="empty">No options provided.</div>` : options.map((option) => html`
          <button ?disabled=${this.responding} @click=${() => { this.onRespond?.(option.value); }}>
            <span>${option.label}</span>
            ${option.description !== undefined && option.description !== "" ? html`<small>${option.description}</small>` : null}
          </button>
        `)}
      </div>
    `;
  }

  private renderConfirm(request: UiRequestPayload): TemplateResult {
    return html`
      <div class="form">
        ${request.message !== undefined && request.message !== "" ? html`<p>${request.message}</p>` : null}
        <div class="actions">
          <button ?disabled=${this.responding} @click=${() => { this.onRespond?.("no"); }}>No</button>
          <button class="primary" ?disabled=${this.responding} @click=${() => { this.onRespond?.("yes"); }}>Yes</button>
        </div>
      </div>
    `;
  }

  private renderInput(request: UiRequestPayload): TemplateResult {
    return html`
      <div class="form">
        <input
          .value=${this.inputValue}
          placeholder=${request.placeholder ?? ""}
          @input=${(event: Event) => { if (event.target instanceof HTMLInputElement) this.inputValue = event.target.value; }}
        >
        <div class="actions">
          <button ?disabled=${this.responding} @click=${() => { this.onCancel?.(); }}>Cancel</button>
          <button class="primary" ?disabled=${this.responding || !this.canSubmitInput(request)} @click=${() => { this.submitInput(request); }}>Submit</button>
        </div>
      </div>
    `;
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      this.onCancel?.();
      return;
    }
    if (event.key !== "Enter" || this.request?.kind !== "input") return;
    event.preventDefault();
    this.submitInput(this.request);
  }

  private submitInput(request: UiRequestPayload): void {
    if (this.responding || !this.canSubmitInput(request)) return;
    this.onRespond?.(this.inputValue);
  }

  private canSubmitInput(request: UiRequestPayload): boolean {
    return request.allowEmpty === true || this.inputValue.trim() !== "";
  }

  static override styles = [commandPickerStyles, css`
    .form { display: grid; gap: 12px; padding: 14px; overflow: auto; }
    .form p { margin: 0; color: var(--pi-text-secondary); overflow-wrap: anywhere; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; }
    .actions button { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; }
    .actions button.primary { border-color: var(--pi-success-border); background: var(--pi-success-surface); color: var(--pi-success); }
    .actions button:disabled { opacity: .6; cursor: not-allowed; }
  `];
}
