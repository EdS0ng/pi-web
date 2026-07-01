import type { TemplateResult } from "lit";
import type { Workspace } from "../../api";
import type { AppState } from "../../appState";
import type { SessionUiEvent } from "../../sessionSocket";
import type { LocalContributionId, PluginId, QualifiedContributionId } from "../ids";
import type { WorkspacePanelContext } from "../types";
import type { PageDefinition } from "../../pagedefs/types";

/**
 * Fork-owned plugin contribution kinds.
 *
 * These augment the upstream `PluginContributions` interface via TypeScript
 * declaration merging (see the `declare module` block at the bottom) so plugins
 * can declare them without any edit to the shared upstream `plugins/types.ts`.
 * Everything in this file is new fork code and therefore carries zero upstream
 * merge risk.
 */

// --- Layer 1: live agent -> browser event stream -----------------------------

/** Context handed to a session event listener alongside each event. */
export interface SessionEventContext {
  state: AppState;
  /**
   * `true` when the event is a reconnect catch-up replay the UI is suppressing
   * as already-seen. Stateful listeners (e.g. accumulating from `pi.event`)
   * should skip these to avoid double-counting; pure observers can ignore it.
   */
  isCatchup: boolean;
}

/**
 * Subscribes to the live, unfiltered session event stream. The listener fires
 * for every `SessionUiEvent` — `assistant.delta`, `tool.*`, `status.update`,
 * and crucially `pi.event` (the agent's arbitrary structured-data channel).
 * Listeners are read-only observers; throwing never breaks the stream.
 */
export interface SessionEventListener {
  id: LocalContributionId;
  onEvent: (event: SessionUiEvent, ctx: SessionEventContext) => void;
}

// --- Layer 2: region widgets (main column, left navigation) -------------------

/** Context handed to a region widget's `render`/`visible` callbacks. */
export interface RegionWidgetContext {
  state: AppState;
  workspace: Workspace | undefined;
  /**
   * The full workspace-panel context when a workspace is selected, so that the
   * built-in workspace tools (files/git/terminal) can be re-hosted verbatim in
   * any region. `undefined` when no workspace is selected.
   */
  workspacePanelContext: WorkspacePanelContext | undefined;
}

/**
 * A widget hostable in a generalized region (the main conversation column or the
 * left navigation). Structurally mirrors `WorkspacePanelContribution` so authors
 * reuse a familiar shape.
 */
export interface RegionWidgetContribution {
  id: LocalContributionId;
  title: string;
  icon?: TemplateResult;
  order?: number;
  visible?: (ctx: RegionWidgetContext) => boolean;
  render: (ctx: RegionWidgetContext) => TemplateResult;
}

/** A region widget after the fork registry has qualified its id. */
export interface QualifiedRegionWidget extends RegionWidgetContribution {
  id: QualifiedContributionId;
  pluginId: PluginId;
  localId: LocalContributionId;
}

declare module "../types" {
  interface PluginContributions {
    /** Layer 1 — live session event-stream subscribers. */
    sessionEventListeners?: SessionEventListener[];
    /** Layer 2 — widgets contributed to the main conversation column. */
    mainViewWidgets?: RegionWidgetContribution[];
    /** Layer 2 — widgets contributed to the left navigation. */
    navWidgets?: RegionWidgetContribution[];
    /** Layer 3 — full-viewport page definitions. */
    pages?: PageDefinition[];
  }
}
