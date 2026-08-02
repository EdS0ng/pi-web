import { expect, openWorkspaceTool, test } from "./support/fixtures";

test("files panel lists the tree and previews an image", async ({ page, stack }) => {
  await page.goto(stack.appUrl({ view: "chat" }));

  // (Re)click the Files tab so the file tree refreshes.
  await openWorkspaceTool(page, "Files");

  const filesPanel = page.locator("workspace-files-panel");
  await expect(filesPanel.locator("button.row").filter({ hasText: "README.md" })).toBeVisible();

  await filesPanel.locator("button.row").filter({ hasText: "docs" }).first().click();
  await filesPanel.locator("button.row").filter({ hasText: "assets" }).first().click();
  await filesPanel.locator("button.row").filter({ hasText: "pi-web-dev-screenshot.png" }).first().click();

  const image = filesPanel.locator(".image-preview img");
  await expect(image).toBeVisible();
  await expect
    .poll(async () => image.evaluate((element) => (element instanceof HTMLImageElement ? element.naturalWidth : 0)))
    .toBeGreaterThan(0);
});
