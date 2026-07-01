import type { LocalContributionId, PluginId, QualifiedContributionId } from "../ids";
import { validateLocalId } from "../ids";
import type { RegistryExtension } from "../registry";
import type { PluginContributions } from "../types";
import type { QualifiedRegionWidget, RegionWidgetContribution, SessionEventListener } from "./contributions";
import { FORK_NAMESPACE } from "../../pagedefs/builtinWidgets";
import { DEFAULT_PAGES } from "../../pagedefs/defaultPages";
import type { PageDefinition, QualifiedPage } from "../../pagedefs/types";

interface RegisteredSessionEventListener extends SessionEventListener {
  pluginId: PluginId;
}

/**
 * Fork-owned registry collector. Plugged into the upstream `PluginRegistry` via
 * its single generic `RegistryExtension` seam, so every fork contribution kind
 * (Layers 1–3) is gathered here with no further upstream registry edits. The
 * upstream registry never learns about these contribution kinds; PiWebApp queries
 * this instance directly.
 */
export class ForkRegistry implements RegistryExtension {
  private readonly sessionEventListeners: RegisteredSessionEventListener[] = [];
  private readonly mainViewWidgets: QualifiedRegionWidget[] = [];
  private readonly navWidgets: QualifiedRegionWidget[] = [];
  private readonly pages: QualifiedPage[] = [];
  /** Tracks qualified ids to reject collisions, mirroring `PluginRegistry`. */
  private readonly qualifiedIds = new Set<QualifiedContributionId>();
  // Sorted-view caches; invalidated on `collect`, since contributions only
  // change at plugin-registration time and the getters run on every render.
  private mainViewSorted: QualifiedRegionWidget[] | undefined;
  private navSorted: QualifiedRegionWidget[] | undefined;
  private pagesSorted: QualifiedPage[] | undefined;

  constructor() {
    // Seed the built-in pages so they exist with no plugin needed; a plugin can
    // contribute further pages via `collect`.
    for (const page of DEFAULT_PAGES) this.pages.push(this.qualifyPage(FORK_NAMESPACE, page));
  }

  collect(pluginId: string, contributions: PluginContributions): void {
    for (const listener of contributions.sessionEventListeners ?? []) {
      this.sessionEventListeners.push({ ...listener, pluginId });
    }
    for (const widget of contributions.mainViewWidgets ?? []) {
      this.mainViewWidgets.push(this.qualifyRegionWidget(pluginId, widget));
    }
    for (const widget of contributions.navWidgets ?? []) {
      this.navWidgets.push(this.qualifyRegionWidget(pluginId, widget));
    }
    for (const page of contributions.pages ?? []) {
      this.pages.push(this.qualifyPage(pluginId, page));
    }
    this.mainViewSorted = undefined;
    this.navSorted = undefined;
    this.pagesSorted = undefined;
  }

  getSessionEventListeners(): readonly RegisteredSessionEventListener[] {
    return this.sessionEventListeners;
  }

  getMainViewWidgets(): QualifiedRegionWidget[] {
    return (this.mainViewSorted ??= this.sortWidgets(this.mainViewWidgets));
  }

  getNavWidgets(): QualifiedRegionWidget[] {
    return (this.navSorted ??= this.sortWidgets(this.navWidgets));
  }

  getPages(): QualifiedPage[] {
    return (this.pagesSorted ??= [...this.pages].sort((left, right) => left.title.localeCompare(right.title)));
  }

  /**
   * Resolves a plugin-contributed region widget by qualified id, searching the
   * main-view and navigation pools, so the PiWebApp page dispatcher can render a
   * region widget placed on a page.
   */
  findRegionWidget(id: QualifiedContributionId): QualifiedRegionWidget | undefined {
    return this.mainViewWidgets.find((widget) => widget.id === id) ?? this.navWidgets.find((widget) => widget.id === id);
  }

  private qualifyRegionWidget(pluginId: string, widget: RegionWidgetContribution): QualifiedRegionWidget {
    return { ...widget, id: this.qualify(pluginId, widget.id), pluginId, localId: widget.id };
  }

  private qualifyPage(pluginId: string, page: PageDefinition): QualifiedPage {
    return { ...page, id: this.qualify(pluginId, page.id) };
  }

  private qualify(pluginId: string, localId: LocalContributionId): QualifiedContributionId {
    validateLocalId(localId);
    const qualified: QualifiedContributionId = `${pluginId}:${localId}`;
    if (this.qualifiedIds.has(qualified)) throw new Error(`Duplicate contribution id: ${qualified}`);
    this.qualifiedIds.add(qualified);
    return qualified;
  }

  private sortWidgets(widgets: QualifiedRegionWidget[]): QualifiedRegionWidget[] {
    return [...widgets].sort((left, right) => (left.order ?? 1000) - (right.order ?? 1000) || left.title.localeCompare(right.title));
  }
}

/** Creates the fork registry collector that PiWebApp owns and queries. */
export function createForkRegistry(): ForkRegistry {
  return new ForkRegistry();
}
