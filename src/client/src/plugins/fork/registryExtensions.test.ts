import { html } from "lit";
import { describe, expect, it } from "vitest";
import { createForkRegistry } from "./registryExtensions";
import type { PluginContributions } from "../types";
import { FORK_FOCUS_PAGE_ID } from "../../pagedefs/defaultPages";

describe("ForkRegistry pages", () => {
  it("seeds the built-in focus page qualified under fork:", () => {
    const registry = createForkRegistry();
    const pages = registry.getPages();
    const focus = pages.find((page) => page.id === FORK_FOCUS_PAGE_ID);
    expect(focus).toBeDefined();
    expect(focus?.id).toBe("fork:focus");
    expect(focus?.widgets).toEqual([{ area: "chat", widget: "fork:conversation" }]);
  });

  it("collects and qualifies plugin-contributed pages, sorted by title", () => {
    const registry = createForkRegistry();
    const contributions: PluginContributions = {
      pages: [{
        id: "audit",
        title: "Audit board",
        layout: { columns: "1fr", rows: "1fr", areas: ["main"] },
        widgets: [{ area: "main", widget: "fork:conversation" }],
      }],
    };
    registry.collect("acme", contributions);
    const titles = registry.getPages().map((page) => page.title);
    expect(titles).toEqual(["Audit board", "Focused conversation"]);
    const audit = registry.getPages().find((page) => page.title === "Audit board");
    expect(audit?.id).toBe("acme:audit");
  });

  it("resolves region widgets placed on a page across main-view and nav pools", () => {
    const registry = createForkRegistry();
    registry.collect("acme", {
      mainViewWidgets: [{ id: "board", title: "Board", render: () => html`` }],
      navWidgets: [{ id: "tree", title: "Tree", render: () => html`` }],
    });
    expect(registry.findRegionWidget("acme:board")?.title).toBe("Board");
    expect(registry.findRegionWidget("acme:tree")?.title).toBe("Tree");
    expect(registry.findRegionWidget("acme:missing")).toBeUndefined();
  });
});
