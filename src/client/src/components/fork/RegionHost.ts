import { LitElement, html, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { QualifiedRegionWidget, RegionWidgetContext } from "../../plugins/fork/contributions";
import type { QualifiedContributionId } from "../../plugins/types";
import { workspacePanelStyles } from "../shared";

/**
 * Fork-owned generalized widget host. A region/context-agnostic sibling of
 * `WorkspacePanel`: renders a list of region widgets as tabs, then renders the
 * selected widget. Reuses `workspacePanelStyles` verbatim so tabs look identical
 * to the right-panel host.
 *
 * Selection is controlled when an `active` id is supplied (the main column drives
 * it from `state.mainView`) and uncontrolled otherwise (the left navigation keeps
 * its own selection without needing app state).
 */
@customElement("region-host")
export class RegionHost extends LitElement {
  @property({ attribute: false }) widgets: QualifiedRegionWidget[] = [];
  @property() active: QualifiedContributionId | undefined;
  @property({ attribute: false }) context: RegionWidgetContext | undefined;
  @property({ type: Boolean }) hideTabs = false;
  @property({ attribute: false }) onSelect: (id: QualifiedContributionId) => void = () => undefined;
  @state() private internalActive: QualifiedContributionId | undefined;

  override render(): TemplateResult {
    const context = this.context;
    const widgets = this.widgets;
    if (context === undefined || widgets.length === 0) return html``;
    const selected = widgets.find((widget) => widget.id === this.selectedId()) ?? widgets[0];
    return html`
      ${this.hideTabs || widgets.length <= 1 ? null : html`
        <header>
          <div class="workspace-header-scroll-frame">
            <div class="workspace-header-strip">
              <div class="tabs">
                ${widgets.map((widget) => {
                  const isSelected = selected?.id === widget.id;
                  return html`
                    <button class=${this.tabClass(widget, isSelected)} title=${widget.title} aria-label=${widget.title} aria-pressed=${String(isSelected)} @click=${() => { this.select(widget.id); }}>
                      ${widget.icon === undefined ? null : html`<span class="tab-custom-icon" aria-hidden="true">${widget.icon}</span>`}
                      <span class="tab-label">${widget.title}</span>
                    </button>
                  `;
                })}
              </div>
            </div>
          </div>
        </header>
      `}
      ${selected === undefined ? null : html`<div class="panel-content">${selected.render(context)}</div>`}
    `;
  }

  private selectedId(): QualifiedContributionId | undefined {
    return this.active ?? this.internalActive;
  }

  private select(id: QualifiedContributionId): void {
    if (this.active === undefined) this.internalActive = id;
    this.onSelect(id);
  }

  private tabClass(widget: QualifiedRegionWidget, selected: boolean): string {
    return [
      ...(widget.icon === undefined ? [] : ["icon-tab"]),
      ...(selected ? ["selected"] : []),
    ].join(" ");
  }

  static override styles = workspacePanelStyles;
}
