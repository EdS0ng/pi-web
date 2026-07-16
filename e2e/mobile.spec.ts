import { expect, test } from "./support/fixtures";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test("mobile layout shows the tab bar and opens the Files view", async ({ page, stack }) => {
  await page.goto(stack.appUrl({ session: stack.demoSessionId, view: "chat" }));

  const tabs = page.locator("app-mobile-main-tabs");
  await expect(tabs).toBeVisible();
  await expect(page.locator("chat-view").getByText("Showing messages").first()).toBeVisible();

  await tabs.getByRole("button", { name: "Files" }).click();
  await expect(page.locator("workspace-files-panel").locator("button.row").filter({ hasText: "README.md" })).toBeVisible();
});
