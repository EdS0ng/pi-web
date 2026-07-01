import type { QualifiedContributionId } from "../plugins/types";
import { FORK_CONVERSATION, FORK_NAMESPACE } from "./builtinWidgets";
import type { PageDefinition } from "./types";

/**
 * v1 built-in page: a single, full-viewport conversation. Adding a second area
 * (e.g. `areas: ["nav chat"]`, `columns: "320px 1fr"`, plus a `FORK_NAVIGATION`
 * placement) is a one-line change — it demonstrates the grid without committing
 * to multi-pane layouts in v1.
 */
export const FOCUS_PAGE: PageDefinition = {
  id: "focus",
  title: "Focused conversation",
  layout: { columns: "1fr", rows: "1fr", areas: ["chat"] },
  widgets: [{ area: "chat", widget: FORK_CONVERSATION }],
};

/** Built-in pages seeded into the fork registry (qualified under `fork:`). */
export const DEFAULT_PAGES: PageDefinition[] = [FOCUS_PAGE];

/** The qualified id of {@link FOCUS_PAGE}, used by the discoverable toggle action. */
export const FORK_FOCUS_PAGE_ID: QualifiedContributionId = `${FORK_NAMESPACE}:${FOCUS_PAGE.id}`;
