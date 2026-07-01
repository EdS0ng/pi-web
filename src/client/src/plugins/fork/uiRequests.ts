import type { SessionUiEvent } from "../../sessionSocket";
import type { UiNotifyPayload, UiRequestPayload } from "../../../../shared/forkUiRequest";

/**
 * Fork-owned interpreter for the agent→user question channel that rides the
 * `pi.event` envelope (`ui.request` / `ui.cancel` / `ui.notify`). Pure functions
 * so the only PiWebApp wiring is a thin dispatch hop; all parsing lives here.
 */

/** The effect a `pi.event` UI envelope has on app state, or `undefined` for no change. */
export type ForkUiEffect =
  | { type: "setDialog"; dialog: UiRequestPayload | undefined }
  | { type: "notify"; payload: UiNotifyPayload };

/**
 * Reduce a session event into a UI effect.
 *
 * `current` is the dialog already shown (if any). A `ui.request` for the same
 * `requestId` is deduped so a re-delivered event never reopens an open dialog.
 * Live requests are always surfaced regardless of `isCatchup`: an event flagged
 * catch-up here may still be a genuine, unanswered question buffered during a
 * reconnect, and dropping it would hang the agent — dedupe alone guards against
 * the only real double-open (the same request arriving twice).
 */
export function reduceForkUiEvent(event: SessionUiEvent, _isCatchup: boolean, current: UiRequestPayload | undefined): ForkUiEffect | undefined {
  if (event.type !== "pi.event") return undefined;
  if (event.eventType === "ui.request") {
    const request = parseUiRequestPayload(event.data);
    if (request === undefined || current?.requestId === request.requestId) return undefined;
    return { type: "setDialog", dialog: request };
  }
  if (event.eventType === "ui.cancel") {
    const requestId = parseRequestId(event.data);
    if (requestId === undefined || current?.requestId !== requestId) return undefined;
    return { type: "setDialog", dialog: undefined };
  }
  if (event.eventType === "ui.notify") {
    const payload = parseUiNotifyPayload(event.data);
    return payload === undefined ? undefined : { type: "notify", payload };
  }
  return undefined;
}

export function parseUiRequestPayload(data: unknown): UiRequestPayload | undefined {
  if (!isRecord(data)) return undefined;
  const { requestId, kind, title } = data;
  if (typeof requestId !== "string" || typeof title !== "string") return undefined;
  if (kind !== "select" && kind !== "input" && kind !== "confirm") return undefined;
  return {
    requestId,
    kind,
    title,
    ...(typeof data["message"] === "string" ? { message: data["message"] } : {}),
    ...(typeof data["placeholder"] === "string" ? { placeholder: data["placeholder"] } : {}),
    ...(Array.isArray(data["options"]) ? { options: parseOptions(data["options"]) } : {}),
    ...(typeof data["allowEmpty"] === "boolean" ? { allowEmpty: data["allowEmpty"] } : {}),
  };
}

function parseUiNotifyPayload(data: unknown): UiNotifyPayload | undefined {
  if (!isRecord(data) || typeof data["message"] !== "string") return undefined;
  const type = data["type"];
  return {
    message: data["message"],
    ...(type === "info" || type === "warning" || type === "error" ? { type } : {}),
  };
}

function parseRequestId(data: unknown): string | undefined {
  if (!isRecord(data) || typeof data["requestId"] !== "string") return undefined;
  return data["requestId"];
}

function parseOptions(value: unknown[]): NonNullable<UiRequestPayload["options"]> {
  const options: NonNullable<UiRequestPayload["options"]> = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry["value"] !== "string" || typeof entry["label"] !== "string") continue;
    options.push({
      value: entry["value"],
      label: entry["label"],
      ...(typeof entry["description"] === "string" ? { description: entry["description"] } : {}),
    });
  }
  return options;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
