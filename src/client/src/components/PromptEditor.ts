import { defaultKeymap, history, historyKeymap, indentWithTab, insertNewlineAndIndent } from "@codemirror/commands";
import { markdown, deleteMarkupBackward, insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { defaultHighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { LitElement, html, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { api, type FileSuggestion, type PromptAttachment, type SessionStatus, type SlashCommand } from "../api";
import type { PromptAttachmentDelivery } from "../../../shared/apiTypes";
import { captureImageAttachments } from "../promptAttachmentCapture";
import { inputModeForDraft } from "../inputModes";
import { machineSessionKey } from "../machineKeys";
import { detectPromptCompletionTrigger, fileCompletionInsertText, type PromptCompletionTrigger } from "../promptCompletions";
import { clearDraft, loadDraft, saveDraft } from "../promptDraftStorage";
import { loadAttachmentDelivery, saveAttachmentDelivery } from "../attachmentPreferences";
import { promptEditorStyles, type CompletionItem } from "./shared";
import { renderAttachIcon, renderMicIcon, renderSendIcon, renderQueueIcon, renderSteerIcon, renderStopIcon, renderThinkingGauge } from "./promptEditorIcons";
import { createRecorder, type Recorder } from "../audio/recorder";
import { thinkingGauge, thinkingLevelLabel } from "../../../shared/thinkingLevels";
import "./AutocompleteMenu";

interface PendingAttachment {
  id: string;
  name: string;
  mimeType: string;
  /** Base64 payload without the data: URL prefix. */
  data: string;
  size: number;
}

@customElement("prompt-editor")
export class PromptEditor extends LitElement {
  @property({ type: Boolean }) disabled = false;
  @property() sessionId?: string;
  @property() cwd?: string;
  @property() machineId = "local";
  @property() projectId?: string;
  @property() workspaceId?: string;
  @property({ type: Boolean }) workspaceScopedFileSuggestions = false;
  @property({ type: Boolean }) canSteer = false;
  @property({ type: Boolean }) isCompacting = false;
  @property({ type: Boolean }) canStop = false;
  @property({ attribute: false }) status?: SessionStatus;
  @property({ type: Boolean }) sending = false;
  @property({ attribute: false }) onSend?: (text: string, streamingBehavior?: "steer" | "followUp", attachments?: PromptAttachment[], delivery?: PromptAttachmentDelivery) => void | Promise<void>;
  @property({ attribute: false }) onStop?: () => void;
  @property({ attribute: false }) onSelectModel?: () => void;
  @property({ attribute: false }) onSelectThinking?: () => void;
  @property({ attribute: false }) availableThinkingLevels: readonly string[] = [];
  @query(".markdown-editor") private editorHost?: HTMLDivElement;
  @query(".attachment-input") private attachmentInput?: HTMLInputElement;
  @state() private draft = "";
  @state() private completions: CompletionItem[] = [];
  @state() private selectedIndex = 0;
  @state() private attachments: PendingAttachment[] = [];
  @state() private attachmentDelivery: PromptAttachmentDelivery = loadAttachmentDelivery();
  @state() private attachmentError: string | undefined = undefined;
  @state() private recordingState: "idle" | "requesting" | "recording" | "transcribing" = "idle";
  @state() private transcriptionError: string | undefined = undefined;
  private recorder: Recorder | undefined;
  private attachmentSeq = 0;
  private requestVersion = 0;
  private editor: EditorView | undefined;
  private readonly editableCompartment = new Compartment();
  private readonly readOnlyCompartment = new Compartment();

  protected override willUpdate(changed: PropertyValues<this>) {
    if (!changed.has("sessionId") && !changed.has("machineId")) return;
    const previousSessionId = changed.has("sessionId") ? changed.get("sessionId") : this.sessionId;
    const previousMachineId = changed.has("machineId") ? changed.get("machineId") : this.machineId;
    const previousKey = draftStorageKey(previousMachineId, previousSessionId);
    if (previousKey !== undefined) saveDraft(previousKey, this.draft);
    const currentKey = draftStorageKey(this.machineId, this.sessionId);
    this.draft = currentKey !== undefined ? loadDraft(currentKey) : "";
    this.completions = [];
    this.selectedIndex = 0;
  }

  override firstUpdated(): void {
    this.createEditor();
  }

  protected override updated(changed: PropertyValues) {
    if (changed.has("disabled")) this.updateEditorDisabledState();
    if (changed.has("draft") || changed.has("sessionId") || changed.has("machineId")) this.syncEditorDoc();
  }

  override disconnectedCallback(): void {
    this.recorder?.cancel();
    this.recorder = undefined;
    this.editor?.destroy();
    this.editor = undefined;
    super.disconnectedCallback();
  }

  override render() {
    const inputMode = inputModeForDraft(this.draft);
    const shellMode = inputMode.kind === "shell";
    const queuesInput = this.canSteer || this.isCompacting;
    const transcribing = this.recordingState === "transcribing";
    const busy = this.disabled || this.sending || transcribing;
    const recording = this.recordingState === "recording";
    const micClass = `icon-button mic-button${recording ? " recording" : ""}${transcribing ? " transcribing" : ""}`;
    const micLabel = micButtonLabel(this.recordingState);
    return html`
      <footer class=${shellMode ? "shell-mode" : ""} @paste=${(event: ClipboardEvent) => { void this.handlePaste(event); }} @dragover=${(event: DragEvent) => { this.handleDragOver(event); }} @drop=${(event: DragEvent) => { void this.handleDrop(event); }}>
        <div class="editor-wrap">
          <div class=${`markdown-editor${this.disabled ? " markdown-editor-disabled" : ""}`} aria-label="Message pi" aria-disabled=${this.disabled ? "true" : "false"}></div>
          <input class="attachment-input" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden @change=${(event: Event) => { void this.handleFileInput(event); }} />
          <button class="editor-attach icon-button" ?disabled=${busy} title="Attach images" aria-label="Attach images" @click=${() => { this.attachmentInput?.click(); }}>${renderAttachIcon()}</button>
          ${shellMode ? html`<div class="mode-hint">Shell command${inputMode.excludeFromContext ? " · excluded from context" : ""}</div>` : null}
          ${this.isCompacting && !shellMode ? html`<div class="mode-hint">Compacting history · message will be queued</div>` : null}
          ${this.renderAttachments()}
          ${this.transcriptionError !== undefined ? html`<div class="attachments" role="alert"><div class="attachment-error">${this.transcriptionError}</div></div>` : null}
          <autocomplete-menu .items=${this.completions} .selectedIndex=${this.selectedIndex} .onPick=${(item: CompletionItem) => { this.pick(item); }}></autocomplete-menu>
        </div>
        <div class="actions">
          ${this.renderCompactStatus()}
          <button class=${micClass} ?disabled=${this.disabled || this.recordingState === "requesting" || transcribing} title=${micLabel} aria-label=${micLabel} @click=${() => { void this.toggleRecording(); }}>${recording ? renderStopIcon() : renderMicIcon()}</button>
          <button class="icon-button send-button" ?disabled=${busy} title=${queuesInput ? "Queue until the current activity finishes" : "Send message"} aria-label=${queuesInput ? "Queue message" : "Send message"} @click=${() => { this.send("followUp"); }}>${queuesInput ? renderQueueIcon() : renderSendIcon()}</button>
          ${this.canSteer && !this.isCompacting ? html`<button class="icon-button steer-button" ?disabled=${busy} title="Steer the current response before the next model call" aria-label="Steer current response" @click=${() => { this.send("steer"); }}>${renderSteerIcon()}</button>` : null}
          <button class="icon-button stop-button" ?disabled=${this.disabled || !this.canStop} title=${this.canStop ? "Stop current work and clear queued messages" : "Nothing running"} aria-label="Stop current work" @click=${() => this.onStop?.()}>${renderStopIcon()}</button>
        </div>
      </footer>
    `;
  }

  focusInput() {
    this.editor?.focus();
  }

  /** Get the underlying CM6 EditorView, or undefined if not yet mounted. */
  get view(): EditorView | undefined {
    return this.editor;
  }

  private renderCompactStatus() {
    const status = this.status;
    if (status === undefined) return null;
    const model = status.model?.id ?? "no model";
    const provider = status.model?.provider !== undefined && status.model.provider !== "" ? `${status.model.provider}/` : "";
    return html`
      <div class="compact-status" aria-label="Session status">
        <button class="select-model" title="Select model" @click=${() => this.onSelectModel?.()}>${provider}${model}</button>
        <button class="select-thinking icon-button" title=${`Thinking level: ${thinkingLevelLabel(status.thinkingLevel)}`} aria-label=${`Thinking level: ${thinkingLevelLabel(status.thinkingLevel)}`} @click=${() => this.onSelectThinking?.()}>${renderThinkingGauge(thinkingGauge(status.thinkingLevel, this.availableThinkingLevels))}</button>
      </div>
    `;
  }

  private renderAttachments() {
    if (this.attachments.length === 0 && this.attachmentError === undefined) return null;
    return html`
      <div class="attachments" aria-label="Pending attachments">
        ${this.attachments.map((attachment) => html`
          <div class="attachment-chip" title=${attachment.name}>
            <img src=${`data:${attachment.mimeType};base64,${attachment.data}`} alt=${attachment.name} />
            <button type="button" class="attachment-remove" title="Remove attachment" aria-label=${`Remove ${attachment.name}`} @click=${() => { this.removeAttachment(attachment.id); }}>×</button>
          </div>
        `)}
        ${this.attachments.length > 0 ? html`
          <label class="attachment-delivery" title="How attachments are delivered to the agent">
            <select .value=${this.attachmentDelivery} @change=${(event: Event) => { this.changeDelivery(event); }}>
              <option value="inline">Attach to message</option>
              <option value="folder">Save to .pi-web/attachments</option>
            </select>
          </label>
        ` : null}
        ${this.attachmentError !== undefined ? html`<div class="attachment-error">${this.attachmentError}</div>` : null}
      </div>
    `;
  }

  private changeDelivery(event: Event) {
    if (!(event.target instanceof HTMLSelectElement)) return;
    this.attachmentDelivery = event.target.value === "folder" ? "folder" : "inline";
    saveAttachmentDelivery(this.attachmentDelivery);
  }

  private removeAttachment(id: string) {
    this.attachments = this.attachments.filter((attachment) => attachment.id !== id);
  }

  private async handlePaste(event: ClipboardEvent) {
    const files = imageFilesFromDataTransfer(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    await this.addAttachmentFiles(files);
  }

  private handleDragOver(event: DragEvent) {
    if (event.dataTransfer === null) return;
    if (Array.from(event.dataTransfer.items).some((item) => item.kind === "file" && item.type.startsWith("image/"))) {
      event.preventDefault();
    }
  }

  private async handleDrop(event: DragEvent) {
    const files = imageFilesFromDataTransfer(event.dataTransfer);
    if (files.length === 0) return;
    event.preventDefault();
    await this.addAttachmentFiles(files);
  }

  private async handleFileInput(event: Event) {
    if (!(event.target instanceof HTMLInputElement) || event.target.files === null) return;
    const files = Array.from(event.target.files);
    event.target.value = "";
    await this.addAttachmentFiles(files);
  }

  private async addAttachmentFiles(files: File[]) {
    this.attachmentError = undefined;
    const { attachments, error } = await captureImageAttachments(files, readFileAsBase64);
    if (attachments.length > 0) {
      this.attachments = [...this.attachments, ...attachments.map((attachment) => ({ id: `attachment-${String(++this.attachmentSeq)}`, ...attachment }))];
    }
    if (error !== undefined) this.attachmentError = error;
  }

  private currentAttachments(): PromptAttachment[] {
    return this.attachments.map((attachment) => ({
      kind: "image",
      mimeType: attachment.mimeType,
      data: attachment.data,
      name: attachment.name,
    }));
  }

  private createEditor() {
    if (!this.editorHost || this.editor !== undefined) return;
    this.editor = new EditorView({
      parent: this.editorHost,
      state: EditorState.create({
        doc: this.draft,
        extensions: [
          history(),
          markdown(),
          indentOnInput(),
          indentUnit.of("  "),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of((view) => inputAssistanceContentAttributes(view.state.sliceDoc(0, view.state.selection.main.head))),
          placeholder("Message pi... Use / for commands, @ for tracked files, @ space for all files"),
          this.editableCompartment.of(EditorView.editable.of(!this.disabled)),
          this.readOnlyCompartment.of(EditorState.readOnly.of(this.disabled)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) this.updateDraft(update.state.doc.toString());
          }),
          keymap.of([
            { key: "ArrowDown", run: () => this.moveCompletion(1) },
            { key: "ArrowUp", run: () => this.moveCompletion(-1) },
            { key: "Escape", run: () => this.closeCompletions() },
            { key: "Enter", run: () => this.handleEditorEnter() },
            { key: "Shift-Enter", run: (view) => insertNewlineContinueMarkup(view) || insertNewlineAndIndent(view) },
            { key: "Tab", run: (view) => this.handleEditorTab(view) },
            { key: "Shift-Tab", run: (view) => indentWithTab.shift?.(view) ?? false },
            { key: "Backspace", run: (view) => deleteMarkupBackward(view) },
            ...historyKeymap,
            ...defaultKeymap,
          ]),
        ],
      }),
    });
  }

  private syncEditorDoc() {
    const editor = this.editor;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current === this.draft) return;
    editor.dispatch({
      changes: { from: 0, to: current.length, insert: this.draft },
      selection: EditorSelection.cursor(this.draft.length),
    });
  }

  private updateEditorDisabledState() {
    this.editor?.dispatch({
      effects: [
        this.editableCompartment.reconfigure(EditorView.editable.of(!this.disabled)),
        this.readOnlyCompartment.reconfigure(EditorState.readOnly.of(this.disabled)),
      ],
    });
  }

  private updateDraft(value: string) {
    this.draft = value;
    const key = draftStorageKey(this.machineId, this.sessionId);
    if (key !== undefined) saveDraft(key, this.draft);
    void this.refreshCompletions();
  }

  private async refreshCompletions() {
    const trigger = this.currentTrigger();
    const version = ++this.requestVersion;
    this.selectedIndex = 0;
    if (trigger === undefined) {
      this.completions = [];
      return;
    }
    if (trigger.kind === "command" && this.sessionId !== undefined && this.sessionId !== "" && this.cwd !== undefined && this.cwd !== "") {
      const commands = await api.commands({ id: this.sessionId, cwd: this.cwd }, this.machineId).catch(emptySlashCommands);
      if (version !== this.requestVersion) return;
      this.completions = commands
        .filter((command) => command.name.toLowerCase().includes(trigger.query.toLowerCase()))
        .slice(0, 12)
        .map((command) => ({
          kind: "command",
          replaceFrom: trigger.from,
          replaceTo: trigger.to,
          insertText: `/${command.name}`,
          detail: command.source,
          ...(command.description === undefined ? {} : { description: command.description }),
        }));
    } else if (trigger.kind === "file" && this.cwd !== undefined && this.cwd !== "") {
      const files = await api.files(this.cwd, trigger.query, { scope: trigger.fileScope, machineId: this.machineId, projectId: this.projectId, workspaceId: this.workspaceId, workspaceScoped: this.workspaceScopedFileSuggestions }).catch(emptyFileSuggestions);
      if (version !== this.requestVersion) return;
      this.completions = files
        .slice(0, 12)
        .map((file) => {
          const insertText = fileCompletionInsertText(file.path, trigger.quoted === true, file.path.endsWith("/") ? trigger.allPrefix : undefined);
          return {
            kind: "file",
            replaceFrom: trigger.from,
            replaceTo: trigger.to,
            insertText,
            detail: file.kind,
            ...(file.path.endsWith("/") && insertText.endsWith("\"") ? { cursorOffset: insertText.length - 1 } : {}),
          };
        });
    }
  }

  private currentTrigger(): PromptCompletionTrigger | undefined {
    return detectPromptCompletionTrigger(this.draft, this.editor?.state.selection.main.head ?? this.draft.length);
  }

  private moveCompletion(delta: number): boolean {
    if (!this.completions.length) return false;
    this.selectedIndex = (this.selectedIndex + delta + this.completions.length) % this.completions.length;
    return true;
  }

  private closeCompletions(): boolean {
    if (!this.completions.length) return false;
    this.completions = [];
    return true;
  }

  private handleEditorEnter(): boolean {
    if (this.completions.length) {
      const completion = this.completions[this.selectedIndex];
      if (completion !== undefined) this.pick(completion);
      return true;
    }
    this.send(this.canSteer || this.isCompacting ? "followUp" : undefined);
    return true;
  }

  private handleEditorTab(view: EditorView): boolean {
    if (this.completions.length) {
      const completion = this.completions[this.selectedIndex];
      if (completion !== undefined) this.pick(completion);
      return true;
    }
    const trigger = this.currentTrigger();
    if (trigger?.kind === "file") {
      void this.refreshCompletions();
      return true;
    }
    return indentWithTab.run?.(view) ?? false;
  }

  private pick(item: CompletionItem) {
    const editor = this.editor;
    if (!editor) return;
    const suffix = item.kind === "file" && (item.insertText.endsWith("/") || item.cursorOffset !== undefined) ? "" : " ";
    const cursor = item.replaceFrom + (item.cursorOffset ?? item.insertText.length) + suffix.length;
    const replaceTo = item.insertText.endsWith("\"") && this.draft.slice(item.replaceTo).startsWith("\"") ? item.replaceTo + 1 : item.replaceTo;
    editor.dispatch({
      changes: { from: item.replaceFrom, to: replaceTo, insert: `${item.insertText}${suffix}` },
      selection: EditorSelection.cursor(cursor),
      scrollIntoView: true,
    });
    this.completions = [];
  }

  private send(streamingBehavior?: "steer" | "followUp") {
    if (this.disabled || this.sending) return;
    const text = this.draft.trim();
    const pending = this.attachments;
    if (text === "" && pending.length === 0) return;
    const behavior = this.canSteer || this.isCompacting ? streamingBehavior : undefined;
    const attachments = pending.length > 0 ? this.currentAttachments() : undefined;
    const delivery = this.attachmentDelivery;
    this.resetComposer();
    // Sending is owned by the controller (it drives the chat activity dock and,
    // for folder mode, orchestrates the upload + reference rewrite), so this is
    // fire-and-forget here.
    void this.onSend?.(text, behavior, attachments, attachments === undefined ? undefined : delivery);
  }

  private resetComposer() {
    this.draft = "";
    const key = draftStorageKey(this.machineId, this.sessionId);
    if (key !== undefined) clearDraft(key);
    this.completions = [];
    this.attachments = [];
    this.attachmentError = undefined;
  }

  private async toggleRecording() {
    if (this.disabled) return;
    if (this.recordingState === "recording") { await this.finishRecording(); return; }
    if (this.recordingState !== "idle") return;
    this.transcriptionError = undefined;
    this.recordingState = "requesting";
    const recorder = createRecorder();
    try {
      await recorder.start();
      this.recorder = recorder;
      this.recordingState = "recording";
    } catch (error) {
      recorder.cancel();
      this.recorder = undefined;
      this.recordingState = "idle";
      this.transcriptionError = micErrorMessage(error);
    }
  }

  private async finishRecording() {
    const recorder = this.recorder;
    if (recorder === undefined || this.recordingState !== "recording") return;
    this.recordingState = "transcribing";
    try {
      const { blob, ext } = await recorder.stop();
      const { text } = await api.transcribe(blob, ext);
      this.insertTranscript(text);
    } catch (error) {
      this.transcriptionError = error instanceof Error && error.message !== "" ? error.message : "Transcription failed. Please try again.";
    } finally {
      this.recorder = undefined;
      this.recordingState = "idle";
    }
  }

  private insertTranscript(text: string) {
    const trimmed = text.trim();
    if (trimmed === "") return;
    const editor = this.editor;
    if (editor === undefined) {
      // No mounted view (e.g. disconnected); fall back to appending to the draft.
      const needsSpace = this.draft.length > 0 && !/\s$/u.test(this.draft);
      this.updateDraft(`${this.draft}${needsSpace ? " " : ""}${trimmed}`);
      return;
    }
    const selection = editor.state.selection.main;
    const before = selection.from > 0 ? editor.state.sliceDoc(selection.from - 1, selection.from) : "";
    const after = editor.state.sliceDoc(selection.to, selection.to + 1);
    const lead = before !== "" && !/\s/u.test(before) ? " " : "";
    const trail = after !== "" && !/\s/u.test(after) ? " " : "";
    const insert = `${lead}${trimmed}${trail}`;
    // Cursor lands just after the inserted words (before any trailing pad space).
    const cursor = selection.from + lead.length + trimmed.length;
    // The CM update listener fires updateDraft() on docChanged, so draft + persistence update automatically.
    editor.dispatch({
      changes: { from: selection.from, to: selection.to, insert },
      selection: EditorSelection.cursor(cursor),
      scrollIntoView: true,
    });
    editor.focus();
  }

  static override styles = promptEditorStyles;
}

function draftStorageKey(machineId: unknown, sessionId: unknown): string | undefined {
  if (typeof machineId !== "string" || machineId === "") return undefined;
  if (typeof sessionId !== "string" || sessionId === "") return undefined;
  return machineSessionKey(machineId, sessionId);
}

function micButtonLabel(state: "idle" | "requesting" | "recording" | "transcribing"): string {
  switch (state) {
    case "idle": return "Record a voice message";
    case "requesting": return "Starting microphone…";
    case "recording": return "Stop recording and transcribe";
    case "transcribing": return "Transcribing…";
  }
}

function micErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Microphone access was denied. Allow it in your browser settings to use voice input.";
    }
    if (error.name === "NotFoundError") return "No microphone was found.";
  }
  return error instanceof Error && error.message !== "" ? error.message : "Could not start recording.";
}

function emptySlashCommands(): SlashCommand[] {
  return [];
}

function emptyFileSuggestions(): FileSuggestion[] {
  return [];
}

function imageFilesFromDataTransfer(data: DataTransfer | null): File[] {
  if (data === null) return [];
  return Array.from(data.files).filter((file) => file.type.startsWith("image/"));
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => { reject(reader.error ?? new Error("Failed to read file")); };
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") { reject(new Error("Unexpected file reader result")); return; }
      const commaIndex = result.indexOf(",");
      resolve(commaIndex === -1 ? result : result.slice(commaIndex + 1));
    };
    reader.readAsDataURL(file);
  });
}

const proseInputAssistanceAttributes: Record<string, string> = {
  spellcheck: "true",
  autocorrect: "on",
  autocapitalize: "sentences",
  writingsuggestions: "true",
};

const codeLikeInputAssistanceAttributes: Record<string, string> = {
  spellcheck: "false",
  autocorrect: "off",
  autocapitalize: "off",
  writingsuggestions: "false",
};

function inputAssistanceContentAttributes(draftBeforeCursor: string): Record<string, string> {
  // CodeMirror is optimized for code and disables these by default, but the chat prompt is usually prose.
  return inputModeForDraft(draftBeforeCursor).kind === "normal" ? proseInputAssistanceAttributes : codeLikeInputAssistanceAttributes;
}

