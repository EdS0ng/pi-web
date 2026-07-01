import type { QualifiedContributionId } from "../plugins/types";

/**
 * Reserved fork built-in widget ids. These are deliberately **not** registry
 * contributions: PiWebApp's page-widget dispatcher renders them directly because
 * they need the private chat / navigation callbacks that only PiWebApp holds.
 * Named constants keep these ids out of pagedefs and the dispatcher as magic
 * strings.
 */

/** Namespace under which fork built-in widgets and built-in pages are qualified. */
export const FORK_NAMESPACE = "fork";

/** The built-in conversation viewer, hostable on any page. */
export const FORK_CONVERSATION: QualifiedContributionId = `${FORK_NAMESPACE}:conversation`;

/** The built-in left-navigation panel, hostable on any page. */
export const FORK_NAVIGATION: QualifiedContributionId = `${FORK_NAMESPACE}:navigation`;
