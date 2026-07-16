import { expect, test } from "./support/fixtures";

test("seeded demo session renders its transcript read-only", async ({ page, stack }) => {
  await page.goto(stack.appUrl({ session: stack.demoSessionId, view: "chat" }));

  const chat = page.locator("chat-view");
  await expect(chat.getByText("Take a screenshot of").first()).toBeVisible();
  await expect(chat.getByText("Done — I saved the screenshot").first()).toBeVisible();
  await expect(chat.getByText("Showing messages").first()).toBeVisible();
});
