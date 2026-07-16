import { expect, test } from "./support/fixtures";

test("app boots and renders the project navigation without page errors", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.goto("/");

  await expect(page.locator("project-list").getByText("fixture-project").first()).toBeVisible();
  expect(pageErrors).toEqual([]);
});
