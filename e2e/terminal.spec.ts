import { expect, openWorkspaceTool, test } from "./support/fixtures";

test("terminal starts a shell that executes a command", async ({ page, stack }) => {
  await page.goto(stack.appUrl({ view: "chat" }));

  // Open the Terminal tool through the UI like a user would.
  await openWorkspaceTool(page, "Terminal");

  const terminalPanel = page.locator("terminal-panel");
  await terminalPanel.getByRole("button", { name: "+ Shell" }).click();

  const xterm = terminalPanel.locator(".xterm").first();
  await xterm.click();
  // The output ("pw-ok-42") differs from the typed text, proving a real shell
  // evaluated the command rather than the terminal echoing keystrokes.
  await page.keyboard.type("echo pw-ok-$((6*7))");
  await page.keyboard.press("Enter");

  await expect(terminalPanel.getByText("pw-ok-42").first()).toBeVisible({ timeout: 15_000 });
});
