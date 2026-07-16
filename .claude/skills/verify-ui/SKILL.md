---
name: verify-ui
description: Verify pi-web UI changes in a real browser with Playwright against an isolated stack. Use after changing client code (src/client/**), when asked to "verify the UI", "screenshot the UI", or to reproduce/confirm a UI bug. Replaces the old fork-capture-screenshots.mjs workflow.
---

# Verify pi-web UI changes

Two paths. Prefer Path A (scripted spec) — it is deterministic and leaves artifacts. Use Path B when you need to browse around manually or record locators.

**Prereq (once per machine):** if Chromium is missing, run `npx playwright install chromium`.

## Path A (default): throwaway spec in e2e/scratch/

Write a spec under `e2e/scratch/` (gitignored) importing the project fixtures. The fixture boots a full isolated stack per worker — sessiond + API + Vite on free ports, a synthetic git fixture project, seeded sessions — and sets `baseURL`, so no servers need to be running.

```ts
// e2e/scratch/check-my-change.spec.ts
import { expect, test } from "../support/fixtures";

test("my change renders", async ({ page, stack }) => {
  await page.goto(stack.appUrl({ session: stack.demoSessionId, view: "chat" }));
  await expect(page.locator("chat-view").getByText("Showing messages").first()).toBeVisible();
  await page.screenshot({ path: "test-results/my-change.png" });
});
```

Run it:

```sh
npx playwright test e2e/scratch/check-my-change.spec.ts --reporter=list   # add --headed to watch
```

Screenshots and failure traces land in `test-results/` (gitignored). Read screenshots to visually confirm; on failure read `test-results/<test>/error-context.md` (page snapshot) or the trace.

What the `stack` fixture gives you:

- `stack.appUrl(params)` — app URL with `project`/`workspace` preselected; add `{ session, view, settings }` as needed. `view` accepts `"chat"`, `"files"`, or qualified ids like `"core:workspace.terminal"`.
- `stack.demoSessionId` — pristine seeded transcript ("Screenshot pi-web.dev"); keep read-only.
- `stack.scratchSessionId` — near-empty session for mutating flows (prompts, etc.).
- `stack.projectDir` — the fixture repo on disk (README.md, src/hello.ts, docs/assets/…); write files here to test the Files panel.
- `stack.seedSession(id, entries)` / `demoTranscriptEntries(id, cwd)` from `e2e/support/stack` — seed custom transcripts.
- `stack.readLog("api" | "sessiond" | "vite")` — server logs for debugging.

## Path B: persistent stack for manual driving

```sh
npm run e2e:stack                      # fixture project; --project clone for a pi-web checkout; --keep-temp to keep the dir
```

Prints the app/api URLs, seeded session ids, and a ready-to-open session URL, then waits for Ctrl+C (which tears down and removes the temp dir). Server logs are at `<tempRoot>/logs/`. Useful with `npx playwright codegen <baseUrl>` to discover locators.

## Locator guidance

All shadow roots are open — Playwright locators pierce them. Scope through host elements to disambiguate, then prefer role/label:

- Hosts: `pi-web-app`, `chat-view`, `prompt-editor`, `workspace-panel`, `workspace-files-panel`, `terminal-panel`, `settings-dialog`, `project-list`, `workspace-list`, `session-list`, `app-mobile-main-tabs`.
- Known names: prompt input `getByLabel("Message pi")` (CodeMirror — click it, then `page.keyboard.type(...)`), `getByRole("button", { name: "Send message" })`, terminal `+ Shell`, settings dialog `getByRole("dialog", { name: "PI WEB settings" })` with nav `"Settings sections"` and `"Close settings"`, workspace tool tabs `Files`/`Git`/`Terminal`.
- Desktop gotcha: the workspace panel starts collapsed and URL-restored `?view=` does not expand it. Open tools like a user: `getByRole("button", { name: "Expand workspace panel" })`, then click the tool tab. (On mobile viewports use the `app-mobile-main-tabs` buttons instead.)
- Transcript paging banner: `chat-view` → text "Showing messages".

## Rules

- Scratch specs are throwaway and gitignored; delete them when done. Promote one to `e2e/` only if it earns a place in the smoke suite and passes `npm run verify && npm run test:e2e`.
- The stack strips provider API keys from the environment (`e2e/support/stack.ts` `sanitizeEnv`): sending a prompt errors by design ("No API key found…"). Never work around this by injecting real credentials.
- Don't reuse the old pattern of forking `scripts/capture-screenshots.mjs` — it's gone; the stack module is the supported entry point.
