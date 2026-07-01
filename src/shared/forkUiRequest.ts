import type { CommandOption } from "./apiTypes.js";

/**
 * Fork-owned payloads for the agent → user question loop.
 *
 * These ride the existing `pi.event` envelope (`SessionUiEvent`'s
 * `{ type: "pi.event"; eventType: string; data?: unknown }` variant) rather than
 * extending the shared `SessionUiEvent` union, so the transport carries zero
 * upstream merge risk. Server (`webExtensionUiService`) and client
 * (`plugins/fork/uiRequests`, `components/fork/UiRequestDialog`) agree on these
 * shapes for the `data` field.
 */

/** `eventType: "ui.request"` — an extension is asking the user a question. */
export interface UiRequestPayload {
  requestId: string;
  kind: "select" | "input" | "confirm";
  title: string;
  /** Body text shown for `confirm`. */
  message?: string;
  /** Placeholder shown for `input`. */
  placeholder?: string;
  /** Choices shown for `select`. */
  options?: CommandOption[];
  /** When false (the default for `input`), an empty answer is rejected. */
  allowEmpty?: boolean;
}

/** `eventType: "ui.cancel"` — a pending request was resolved/dismissed; close any open dialog for it. */
export interface UiCancelPayload {
  requestId: string;
}

/** `eventType: "ui.notify"` — a fire-and-forget message to surface to the user. */
export interface UiNotifyPayload {
  message: string;
  type?: "info" | "warning" | "error";
}
