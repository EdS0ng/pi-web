import { expect, type Locator, type Page, test as base } from "@playwright/test";
import { startPiWebStack, type PiWebStack } from "./stack";

/**
 * Playwright test with an isolated PI WEB stack per worker: sessiond + API +
 * Vite on free ports, a synthetic fixture project, and seeded demo/scratch
 * sessions. `baseURL` points at the stack, so `page.goto("/")` works.
 */
export const test = base.extend<object, { stack: PiWebStack }>({
  stack: [
    // eslint-disable-next-line no-empty-pattern -- Playwright fixtures require destructuring.
    async ({}, use) => {
      const stack = await startPiWebStack({ project: "fixture" });
      try {
        await use(stack);
      } finally {
        await stack.dispose();
      }
    },
    { scope: "worker" },
  ],
  baseURL: async ({ stack }, use) => {
    await use(stack.baseUrl);
  },
});

/**
 * Open a workspace-panel tool the way a user would, and return the panel.
 *
 * The panel's default collapse state is not stable across upstream releases or
 * viewports (it started collapsed on desktop, then stopped), so expand only
 * when the edge control is actually offering to expand.
 */
export async function openWorkspaceTool(page: Page, tool: string): Promise<Locator> {
  const expand = page.getByRole("button", { name: "Expand workspace panel" });
  const panel = page.locator("workspace-panel");
  const toolButton = panel.getByRole("button", { name: tool });
  await expect(expand.or(toolButton).first()).toBeVisible();
  if (await expand.isVisible()) await expand.click();
  await toolButton.click();
  return panel;
}

export { expect } from "@playwright/test";
