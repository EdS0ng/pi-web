import { LitElement, html, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { GridLayout, WidgetPlacement } from "../../pagedefs/types";

/**
 * Fork-owned, full-viewport **layout engine**. It is intentionally ignorant of
 * how widgets render: PiWebApp passes a `renderWidget` callback so all private
 * wiring (chat callbacks, navigation panel, the region-widget pool) stays in
 * PiWebApp. `<page-host>` only maps a `GridLayout` + placements onto a CSS grid.
 *
 * Renders into the **light DOM** so that (a) the grid/cell rules in
 * `styles/fork.ts` reach its children and (b) PiWebApp's element queries
 * (`@query("chat-view")`, `@query("prompt-editor")`) keep resolving widgets
 * hosted on a page, exactly as they do in the default shell.
 */
@customElement("page-host")
export class PageHost extends LitElement {
  @property({ attribute: false }) layout: GridLayout | undefined;
  @property({ attribute: false }) placements: WidgetPlacement[] = [];
  @property({ attribute: false }) renderWidget: (placement: WidgetPlacement) => TemplateResult = () => html``;

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render(): TemplateResult {
    const layout = this.layout;
    if (layout === undefined) return html``;
    const areas = layout.areas.map((row) => `"${row}"`).join(" ");
    const gridStyle = `grid-template-columns:${layout.columns};grid-template-rows:${layout.rows};grid-template-areas:${areas};`;
    return html`
      <div class="page-grid" style=${gridStyle}>
        ${this.placements.map((placement) => html`<div class="page-cell" style="grid-area:${placement.area};">${this.renderWidget(placement)}</div>`)}
      </div>
    `;
  }
}
