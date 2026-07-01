import type { QualifiedContributionId } from "../plugins/types";
import type { LocalContributionId } from "../plugins/ids";

/**
 * Layer 3 — page definitions: a named, full-viewport grid of widgets that
 * replaces the whole shell. All new fork code, so zero upstream merge risk.
 */

/** A CSS-grid layout, expressed in raw grid-template values. */
export interface GridLayout {
  /** `grid-template-columns` value (e.g. `"1fr"` or `"320px 1fr"`). */
  columns: string;
  /** `grid-template-rows` value (e.g. `"1fr"`). */
  rows: string;
  /** Each entry is one row of `grid-template-areas` (space-separated area names). */
  areas: string[];
}

/** Binds a widget to a named grid area within a page's layout. */
export interface WidgetPlacement {
  /** A `grid-area` name; must appear in `layout.areas`. */
  area: string;
  /** A built-in (`fork:*`) or plugin-contributed widget id. */
  widget: QualifiedContributionId;
}

/** A page definition as authored, before the fork registry qualifies its id. */
export interface PageDefinition {
  /** Qualified by `ForkRegistry`, like region widgets. */
  id: LocalContributionId;
  title: string;
  layout: GridLayout;
  widgets: WidgetPlacement[];
}

/** A page definition after the fork registry has qualified its id. */
export interface QualifiedPage extends Omit<PageDefinition, "id"> {
  id: QualifiedContributionId;
}
