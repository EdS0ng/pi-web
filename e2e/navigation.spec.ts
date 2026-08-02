import { expect, test } from "./support/fixtures";

test("navigating project → workspace → session opens the transcript", async ({ page }) => {
  await page.goto("/");

  await page.locator("project-list").getByText("fixture-project").first().click();
  await page.locator("workspace-list").locator(".workspace-row").first().click();
  await page.locator("session-list").getByText("Screenshot pi-web.dev").first().click();

  await expect(page.locator("chat-view").getByText("Done — I saved the screenshot").first()).toBeVisible();
});
