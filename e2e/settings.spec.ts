import { expect, test } from "./support/fixtures";

test("settings dialog opens from the URL, switches sections, and closes", async ({ page, stack }) => {
  await page.goto(stack.appUrl({ settings: "general" }));

  const dialog = page.getByRole("dialog", { name: "PI WEB settings" });
  await expect(dialog).toBeVisible();

  await dialog.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Session daemon" }).click();
  await expect(dialog.locator("settings-sessiond-panel")).toBeVisible();

  await dialog.getByRole("button", { name: "Close settings" }).click();
  await expect(dialog).not.toBeVisible();
});
