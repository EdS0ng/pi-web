export type PluginId = string;
export type LocalContributionId = string;
export type QualifiedContributionId = `${PluginId}:${LocalContributionId}`;

const localIdPattern = /^[a-z][a-z0-9.-]*$/u;

/**
 * Shared contribution-id validator. Used by both the upstream `PluginRegistry`
 * and the fork registry so the two never diverge on what a valid local id is.
 */
export function validateLocalId(localId: LocalContributionId): void {
  if (!localIdPattern.test(localId)) throw new Error(`Invalid contribution id: ${localId}`);
}
