# @jmfederico/pi-web

## 1.202605.9

### Patch Changes

- 9c028a7: Move archived session files out of active Pi session directories so normal session lists no longer scan archived histories.
- 1d8dba9: Fix the homepage Keep control card icon so it renders clearly across browsers.
- c5dc655: Replace the chat history banner with a count-based conversation position meter that shows approximate message position without extra requests.
- 6f7713f: Contain long edit diff lines inside the diff viewer so they scroll horizontally within the tool card instead of widening the chat transcript.
- ee6f60f: Improve Pi Web tool cards for edit operations with live preview updates, paired call/result display, and rendered diffs that match the TUI more closely.
- 545499a: Add friendlier rotating in-progress response notices when opening a chat mid-reply.
- 71ce2fb: Make workspace navigation bars horizontally scrollable on desktop and mobile, with side shadows showing when more items are available.
- 547b6e6: Expand the live trailing events group while a session is active, then collapse it again once readable conversation output appears.
- e89441f: Make the mobile navigation panel sections collapsible so projects, workspaces, and sessions can each use more screen space.
- babb802: Add a beta-labeled Pi Web status panel with update instructions tailored to global npm, Pi package, or local installs. The panel appears for update/restart messages and stays visible for local or unknown installs, while keeping the bundled Info plugin as the minimal documented plugin example.
- 6f7713f: Keep chat bubble and event group headers sticky while scrolling so long messages remain easier to orient within the transcript.
- b51d56c: Add theme tokens, a theme picker, and built-in current/docs-inspired themes for the Pi Web UI.

## 1.202605.8

### Patch Changes

- c77c47c: Document the Pi Web CalVer release rule so releases use the release month, increment the patch component for additional releases in the same month, and require explicit user confirmation before any breaking major release.
- 3099579: Document and tighten the Pi Web plugin API around explicit `piWeb.plugins` metadata, versioned browser modules, AI-oriented local plugin development, website plugin docs on pi-web.dev, feedback guidance, and resilient discovery that skips invalid plugins without hiding valid ones.

## 1.202605.7

### Patch Changes

- aab9ffb: Preserve newly started empty sessions and their prompt drafts across browser reloads until the user deletes them.
- c5bc855: Improve `pi-web doctor` and `pi-web install` to use the detected bash, zsh, or fish login shell, verify the systemd user service context can find required commands before installation, and print shell-specific PATH setup advice without persisting transient PATH values.
- 9b1b1bb: Fix the docs mobile navigation so FAQ pages no longer overflow and compact the GitHub/theme controls on small screens.
- 0aa0a13: Fix chat history reloads so previously displayed messages are not duplicated from the browser cache.
- 42cad58: Add remote-first development positioning to the website and docs, including a philosophy page and laptop-versus-server FAQ guidance.
- c66d834: Add a static Pi Web website with installation docs, troubleshooting FAQ, and GitHub Pages deployment.
- 6a8f8b6: Add global web UI `/login` and `/logout` flows for configuring API key and subscription provider authentication.

## 1.202605.6

### Patch Changes

- 559436c: Install Pi Web services from the Pi extension using the normal login-shell command shims instead of hardcoded Node paths, so sessions use the same PATH for node and npm.
- c547478: Keep mobile workspace selection in the Sessions view so users can confirm the remembered session before opening chat, and restore mobile URLs without an explicit view back to Sessions.
- 42b9c53: Remove unsupported direct GitHub install instructions from the README.

## 1.202605.5

### Patch Changes

- a807569: Fix browser terminal sizing so progress/status lines update in place instead of wrapping when the PTY size has not caught up with the visible terminal.
- d064c4e: Improve package gallery discoverability for remote web UI and browser control plane searches.

## 1.202605.4

### Patch Changes

- 7a9e7db: Copying selected rendered chat markdown now places the raw markdown source on the clipboard.
- cf43c95: Formalize release notes with Changesets and project-local skills for changelog and npm publishing workflows.
- e12382c: Keep a new prompt separate from the stopped prompt after aborting a session turn.
