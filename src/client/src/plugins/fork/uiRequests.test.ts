import { describe, expect, it } from "vitest";
import type { SessionUiEvent } from "../../sessionSocket";
import type { UiRequestPayload } from "../../../../shared/forkUiRequest";
import { parseUiRequestPayload, reduceForkUiEvent } from "./uiRequests";

function piEvent(eventType: string, data: unknown): SessionUiEvent {
  return { type: "pi.event", eventType, data };
}

const selectRequest: UiRequestPayload = {
  requestId: "r1",
  kind: "select",
  title: "Pick one",
  options: [{ value: "a", label: "Option A" }, { value: "b", label: "Option B", description: "second" }],
};

describe("reduceForkUiEvent", () => {
  it("opens a dialog for a ui.request", () => {
    const effect = reduceForkUiEvent(piEvent("ui.request", selectRequest), false, undefined);
    expect(effect).toEqual({ type: "setDialog", dialog: selectRequest });
  });

  it("dedupes a ui.request that matches the currently shown request", () => {
    expect(reduceForkUiEvent(piEvent("ui.request", selectRequest), false, selectRequest)).toBeUndefined();
  });

  it("still surfaces a live request flagged as catch-up", () => {
    const effect = reduceForkUiEvent(piEvent("ui.request", selectRequest), true, undefined);
    expect(effect).toEqual({ type: "setDialog", dialog: selectRequest });
  });

  it("ignores a malformed ui.request", () => {
    expect(reduceForkUiEvent(piEvent("ui.request", { requestId: "r1" }), false, undefined)).toBeUndefined();
    expect(reduceForkUiEvent(piEvent("ui.request", { requestId: "r1", kind: "bogus", title: "t" }), false, undefined)).toBeUndefined();
  });

  it("closes the dialog on a matching ui.cancel", () => {
    expect(reduceForkUiEvent(piEvent("ui.cancel", { requestId: "r1" }), false, selectRequest)).toEqual({ type: "setDialog", dialog: undefined });
  });

  it("ignores a ui.cancel for a different request", () => {
    expect(reduceForkUiEvent(piEvent("ui.cancel", { requestId: "other" }), false, selectRequest)).toBeUndefined();
  });

  it("surfaces a ui.notify", () => {
    expect(reduceForkUiEvent(piEvent("ui.notify", { message: "hi", type: "error" }), false, undefined)).toEqual({ type: "notify", payload: { message: "hi", type: "error" } });
  });

  it("ignores non-pi.event and unknown pi.event types", () => {
    expect(reduceForkUiEvent({ type: "agent.start" }, false, undefined)).toBeUndefined();
    expect(reduceForkUiEvent(piEvent("ui.unknown", {}), false, undefined)).toBeUndefined();
  });
});

describe("parseUiRequestPayload", () => {
  it("parses a select request including option descriptions", () => {
    expect(parseUiRequestPayload(selectRequest)).toEqual(selectRequest);
  });

  it("drops invalid options and non-string fields", () => {
    const parsed = parseUiRequestPayload({
      requestId: "r1",
      kind: "select",
      title: "t",
      message: 5,
      options: [{ value: "a", label: "A" }, { value: 1, label: "bad" }, "nope"],
    });
    expect(parsed).toEqual({ requestId: "r1", kind: "select", title: "t", options: [{ value: "a", label: "A" }] });
  });

  it("keeps allowEmpty and placeholder for input requests", () => {
    expect(parseUiRequestPayload({ requestId: "r1", kind: "input", title: "Name", placeholder: "type", allowEmpty: true }))
      .toEqual({ requestId: "r1", kind: "input", title: "Name", placeholder: "type", allowEmpty: true });
  });

  it("returns undefined for non-objects and missing fields", () => {
    expect(parseUiRequestPayload(undefined)).toBeUndefined();
    expect(parseUiRequestPayload({ kind: "input", title: "t" })).toBeUndefined();
  });
});
