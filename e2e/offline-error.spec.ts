import { expect, test } from "./support/fixtures";

test("prompting without credentials surfaces a system error in the transcript", async ({ page, stack }) => {
  test.setTimeout(45_000);
  await page.goto(stack.appUrl({ session: stack.scratchSessionId, view: "chat" }));

  const promptEditor = page.locator("prompt-editor");
  await promptEditor.getByLabel("Message pi").click();
  await page.keyboard.type("hello from the offline smoke test");
  await promptEditor.getByRole("button", { name: "Send message" }).click();

  const chat = page.locator("chat-view");
  await expect(chat.getByText("hello from the offline smoke test").first()).toBeVisible({ timeout: 15_000 });

  // The stack strips provider credentials (stack.ts sanitizeEnv), so the
  // runtime deterministically fails the model call and the transcript renders
  // a SYSTEM message (observed: "No API key found for the selected model").
  await expect(chat.getByText("SYSTEM").first()).toBeVisible({ timeout: 30_000 });
  await expect(chat.getByText("No API key found").first()).toBeVisible();
});
