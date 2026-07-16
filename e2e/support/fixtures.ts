import { test as base } from "@playwright/test";
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

export { expect } from "@playwright/test";
