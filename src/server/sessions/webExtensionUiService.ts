import crypto from "node:crypto";
import type { ExtensionUIContext, ExtensionUIDialogOptions } from "@earendil-works/pi-coding-agent";
import type { CommandOption, SessionUiEvent } from "../../shared/apiTypes.js";
import type { UiCancelPayload, UiNotifyPayload, UiRequestPayload } from "../../shared/forkUiRequest.js";

type TimerHandle = ReturnType<typeof setTimeout>;
type UiRequestKind = UiRequestPayload["kind"];

/**
 * The slice of {@link SessionEventHub} this service needs. Keeping it structural
 * lets tests inject a fake hub and assert the published `pi.event` payloads.
 */
export interface WebExtensionUiEvents {
  publish(sessionId: string, event: SessionUiEvent): void;
}

export interface WebExtensionUiServiceOptions {
  /**
   * Time-to-live for a pending request when the extension supplies no explicit
   * `timeout`. Guards against leaks if a tab vanishes without answering or
   * cancelling. Set to 0 to disable. Mirrors the OAuth login flow's TTL.
   */
  requestTtlMs?: number;
}

interface PendingUiRequest {
  sessionId: string;
  kind: UiRequestKind;
  allowEmpty: boolean;
  resolve: (value: string | undefined) => void;
  timer?: TimerHandle;
  cleanup?: () => void;
}

interface AskPayload {
  kind: UiRequestKind;
  title: string;
  message?: string;
  placeholder?: string;
  options?: CommandOption[];
  allowEmpty?: boolean;
}

const DEFAULT_REQUEST_TTL_MS = 30 * 60 * 1000;

/**
 * Browser-backed {@link ExtensionUIContext}. When an extension calls
 * `ctx.ui.select/input/confirm`, this service mints a request id, parks a Promise
 * resolver, and pushes a `pi.event`/`ui.request` to the session's browser
 * sockets. The user answers in a modal; the answer is POSTed back and routed to
 * {@link respond}, which resolves the parked Promise so the agent turn continues.
 *
 * Structurally and operationally mirrors `OAuthLoginFlowService`: a pending map
 * keyed by request id, abort/timeout wiring, and resolve-undefined (never throw)
 * on cancel/timeout/teardown so the extension sees the SDK's "dismissed" value
 * rather than an exception.
 */
export class WebExtensionUiService {
  private readonly pending = new Map<string, PendingUiRequest>();
  private readonly requestTtlMs: number;

  constructor(private readonly events: WebExtensionUiEvents, options: WebExtensionUiServiceOptions = {}) {
    this.requestTtlMs = options.requestTtlMs ?? DEFAULT_REQUEST_TTL_MS;
  }

  /**
   * Build the `ExtensionUIContext` bound to a single session. Only `select`,
   * `input`, `confirm`, and `notify` are wired; the remaining TUI-only members
   * are no-op stubs (they are never exercised in rpc mode). There is no exported
   * no-op base to spread, so the stubs are assembled behind a single localized
   * assertion in {@link noopUiContextStubs}.
   */
  contextFor(sessionId: string): ExtensionUIContext {
    const select = (title: string, options: string[], opts?: ExtensionUIDialogOptions): Promise<string | undefined> =>
      this.ask(sessionId, { kind: "select", title, options: options.map((option) => ({ value: option, label: option })), allowEmpty: true }, opts);
    const input = (title: string, placeholder?: string, opts?: ExtensionUIDialogOptions): Promise<string | undefined> =>
      this.ask(sessionId, { kind: "input", title, ...(placeholder === undefined ? {} : { placeholder }), allowEmpty: false }, opts);
    const confirm = (title: string, message: string, opts?: ExtensionUIDialogOptions): Promise<boolean> =>
      this.ask(sessionId, { kind: "confirm", title, message, allowEmpty: true }, opts).then((value) => value === "yes");
    const notify = (message: string, type?: "info" | "warning" | "error"): void => {
      const data: UiNotifyPayload = { message, ...(type === undefined ? {} : { type }) };
      this.events.publish(sessionId, { type: "pi.event", eventType: "ui.notify", data });
    };
    return { select, input, confirm, notify, ...noopUiContextStubs() };
  }

  /** Resolve a pending request with the user's answer. Throws if it is unknown/expired or the value is required. */
  respond(sessionId: string, requestId: string, value: string): void {
    const pending = this.pending.get(requestId);
    if (pending?.sessionId !== sessionId) throw new Error("UI request expired");
    if (!pending.allowEmpty && value.trim() === "") throw new Error("A value is required");
    this.settle(requestId, value);
  }

  /** Dismiss a pending request (user closed the dialog). Resolves to `undefined`; unknown ids are ignored. */
  cancel(sessionId: string, requestId: string): void {
    const pending = this.pending.get(requestId);
    if (pending?.sessionId !== sessionId) return;
    this.settle(requestId, undefined);
  }

  /** Resolve every pending request for a session to `undefined`, used on teardown. */
  rejectPendingForSession(sessionId: string): void {
    for (const [requestId, pending] of this.pending) {
      if (pending.sessionId === sessionId) this.settle(requestId, undefined);
    }
  }

  private ask(sessionId: string, payload: AskPayload, opts?: ExtensionUIDialogOptions): Promise<string | undefined> {
    return new Promise((resolve) => {
      // Already-aborted signal: resolve immediately without ever showing UI.
      if (opts?.signal?.aborted === true) {
        resolve(undefined);
        return;
      }
      const requestId = crypto.randomUUID();
      const pending: PendingUiRequest = { sessionId, kind: payload.kind, allowEmpty: payload.allowEmpty === true, resolve };
      this.pending.set(requestId, pending);

      const signal = opts?.signal;
      if (signal !== undefined) {
        const onAbort = (): void => { this.settle(requestId, undefined); };
        signal.addEventListener("abort", onAbort, { once: true });
        pending.cleanup = () => { signal.removeEventListener("abort", onAbort); };
      }

      const timeoutMs = opts?.timeout !== undefined && opts.timeout > 0 ? opts.timeout : this.requestTtlMs;
      if (timeoutMs > 0) {
        pending.timer = setTimeout(() => { this.settle(requestId, undefined); }, timeoutMs);
        unrefTimer(pending.timer);
      }

      const data: UiRequestPayload = {
        requestId,
        kind: payload.kind,
        title: payload.title,
        ...(payload.message === undefined ? {} : { message: payload.message }),
        ...(payload.placeholder === undefined ? {} : { placeholder: payload.placeholder }),
        ...(payload.options === undefined ? {} : { options: payload.options }),
        ...(payload.allowEmpty === undefined ? {} : { allowEmpty: payload.allowEmpty }),
      };
      this.events.publish(sessionId, { type: "pi.event", eventType: "ui.request", data });
    });
  }

  private settle(requestId: string, value: string | undefined): void {
    const pending = this.pending.get(requestId);
    if (pending === undefined) return;
    this.pending.delete(requestId);
    if (pending.timer !== undefined) clearTimeout(pending.timer);
    pending.cleanup?.();
    // Broadcast so any other tab still showing this question auto-closes it; the
    // first responder wins and the rest would otherwise hit "UI request expired".
    const cancel: UiCancelPayload = { requestId };
    this.events.publish(pending.sessionId, { type: "pi.event", eventType: "ui.cancel", data: cancel });
    pending.resolve(value);
  }
}

/**
 * No-op stubs for the TUI-only `ExtensionUIContext` members. These require
 * pi-tui types (Theme, component factories) never exercised in rpc mode; rather
 * than import them, the whole object is asserted once here.
 */
function noopUiContextStubs(): Omit<ExtensionUIContext, "select" | "input" | "confirm" | "notify"> {
  const noop = (): void => undefined;
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- TUI-only members (theme/component factories) need pi-tui types never exercised in rpc mode; the no-op shapes are runtime-safe but not structurally typeable without importing them.
  return {
    onTerminalInput: () => noop,
    setStatus: noop,
    setWorkingMessage: noop,
    setWorkingVisible: noop,
    setWorkingIndicator: noop,
    setHiddenThinkingLabel: noop,
    setWidget: noop,
    setFooter: noop,
    setHeader: noop,
    setTitle: noop,
    custom: () => Promise.resolve(undefined),
    pasteToEditor: noop,
    setEditorText: noop,
    getEditorText: () => "",
    editor: () => Promise.resolve(undefined),
    addAutocompleteProvider: noop,
    setEditorComponent: noop,
    getEditorComponent: () => undefined,
    theme: {},
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false }),
    getToolsExpanded: () => false,
    setToolsExpanded: noop,
  } as unknown as Omit<ExtensionUIContext, "select" | "input" | "confirm" | "notify">;
}

function unrefTimer(timer: TimerHandle): void {
  if (typeof timer !== "object" || !("unref" in timer) || typeof timer.unref !== "function") return;
  timer.unref();
}
