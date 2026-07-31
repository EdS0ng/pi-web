# PI WEB (EdS0ng fork) — Agentic Coding Control Plane

## What This Is

A fork of [`jmfederico/pi-web`](https://github.com/jmfederico/pi-web) (a web UI for Pi Coding Agent) being built into Edward's single control plane for agentic coding. It runs on always-on machines where the code, tools, and credentials live, keeps Pi sessions alive across disconnects, and exposes one browser surface — desktop and phone as co-equal — for supervising a fleet of agents, dispatching work to them, unblocking them asynchronously, and reviewing what they produced.

Audience: Edward, now. Built for his workflow, without deliberately painting into a corner if it later turns out useful to others.

## Core Value

**One surface where every agent's work is visible, dispatchable, and unblockable — including from a phone.** If everything else fails, the operator must always be able to see what agents are doing and answer whatever is blocking them, from wherever they are.

## Vision

The terminal is retired for agentic work. Pi is the only agent, and PI WEB is the only place Edward touches it.

At full maturity:

- **Fleet supervision.** 5–10+ sessions routinely in flight across repos, worktrees, and federated machines, and the operator can actually keep track of them. One glance answers: who's working, who's stuck, who's waiting on a decision, who's done.
- **Dispatch.** Work enters the system three ways — a task queue/backlog agents drain, scheduled/recurring runs (nightly fixers, dependency bumps, PR babysitting), and direct manual prompts. Launching work is a first-class act in the UI, not just watching work others started.
- **Async notify-and-reply.** Agents run unattended. When one needs a human, it reaches out (phone push first; other channels open), and a short reply from anywhere resumes it. Runs stall on a human for seconds, not hours. Waking up to finished, reviewable work is the normal case.
- **Review and gates.** Agent diffs read and approved without leaving for GitHub; approval checkpoints where the operator says go/no-go; annotations and comments on plans and docs, so directing agents is a conversation on artifacts rather than re-typed prose.
- **Deep single-session work.** Not just a dashboard — when the operator does sit down with one session, the surface beats a terminal: diffs, files, transcript, voice input.
- **Extensible.** Custom UI and custom functionality can be added without fighting the system; bespoke surfaces (a review view, a triage view) are cheap to build.
- **Federated runtime.** Several PI WEB runtimes registered as machines behind one browser-facing instance, so "where the agent runs" is a routing detail, not a context switch.

## Requirements

### Open Questions (deliberately undecided — the reason this document exists)

These are **not** to be settled by default or by inertia. Capturing the vision now is explicitly so these can be re-analyzed from a holistic, big-picture perspective. Current practice is noted, but is not a commitment.

- **Where orchestration lives.** The queue, schedules, dispatch, and dependencies could live in an external server with pi-web as a thin rich UI over its state; in pi-web itself next to sessions and workspaces; or split by concern (external owns durable/unattended/cross-machine concerns, pi-web owns live session state, workspaces, and human interaction). Undecided. Note that a Claude Jobs queue API (jobs, workers, schedules, dispatch, dependencies, approvals, PR linkage) already exists in Edward's toolchain and overlaps this space.
- **How the inbox server relates.** The in-flight `request_input` webhook is written against an **external inbox server that does not exist yet** — pi-web is "just the UI"; the other server owns inboxes. Whether inboxes genuinely warrant their own service, and whether that service is the same thing as the job queue, is open.
- **Extensibility mechanism.** Current path is *plugin API + fork core where needed*. Not a commitment. Cleaner strategies may exist — widening the plugin API itself so features can be plugins, or something not yet considered.

### Out of Scope

- **Multi-user auth / teams / per-user isolation** — single trusted operator on a private network. Accounts, roles, and access control are cost without benefit at this audience size, and they'd constrain every other design decision.
- **Hosted SaaS** — never a service strangers log into. The entire premise is that agents run where the code, tools, credentials, and build caches already live; hosting inverts that.
- **Full IDE / editor** — not competing with VS Code. File viewing and diffs, yes; becoming an editor, no. Editing is what the agents are for.
- **Non-Pi agent backends** (Claude Code, Codex, aider adapters) — Pi is becoming the only agent Edward uses, so an adapter layer would be an abstraction tax paid for a generality he doesn't need. Depth over breadth. *(Note: Claude Code remains the tool used to build this; it is not a thing this tool supervises.)*

## Context

**Provenance.** Fork of `jmfederico/pi-web` (MIT). `origin` = `EdS0ng/pi-web`, `upstream` = `jmfederico/pi-web`. Upstream is an actively developed npm package (`@jmfederico/pi-web`) with its own docs site (pi-web.dev), plugin API, and release process.

**Upstream's core model, inherited:** `Machine` (a local or remote PI WEB runtime) → `Project` (a folder on that machine) → `Workspace` (a git worktree, or the project folder) → `Session` (a Pi Coding Agent chat inside a workspace). Federated machines already exist upstream: one browser-facing instance can proxy projects, files, git state, sessions, terminals, and activity from trusted remote machines.

**Architecture as inherited:** three processes — `pi-web-server` (Fastify web/API, `src/server/`), `pi-web-sessiond` (session daemon owning agent processes and PTYs, `src/server/sessiond/`, `src/sessiond/`), and the Vite/Lit client (`src/client/`). Shared types in `src/shared/`. Plugin system in `pi-web-plugins/` + `plugin-api/` + `plugin-api.d.ts`. Config precedence: defaults → global config file → environment overrides, with project-local overrides for some keys (`docs/config.md`).

**Work already done in the fork:** STT transcription (voice input); inactive session reaping plus a right-panel layout change for more space; a Playwright-based isolated e2e stack (`e2e/support/stack-cli.ts`, `npm run e2e:stack`) with a smoke suite and a `verify-ui` skill replacing the old screenshot script; nested projects scoped to their own directory rather than the repo root; extension path support for custom UI.

**Work in flight (uncommitted):** asynchronous `request_input` reply path. `src/server/requestInputWebhookRoutes.ts` exposes `POST /api/request-input/reply`, authenticated by a shared secret in the `x-request-input-secret` header (checked on the web server because the daemon proxy does not forward headers), forwarding to sessiond's per-session reply route and relaying status verbatim — the inbox server's retry contract is 404 = stop retrying, 409 = archived session, 502 = retry later. Gated by `requestInput.webhookSecret` / `PI_WEB_REQUEST_INPUT_SECRET`; unset disables the route (404). Plus `src/server/sessions/requestInputReply.ts` and tests. This is the first concrete piece of the async notify-and-reply pillar.

**Known environmental issues:** `terminalService.test.ts` fails in the sandbox due to `node-pty`; expected, not a real failure.

## Constraints

- **Tech stack**: Lit web components, Fastify, TypeScript, node-pty, no database, npm-installable CLI — **keep it**. Treated as a constraint rather than an open choice: it avoids a rewrite tax and keeps the fork mergeable with upstream. New UI fits the existing idiom.
- **Upstream posture**: track upstream and stay mergeable **for now**; diverge when staying mergeable blocks something wanted. Implies keeping the diff comprehensible and preferring additive changes while that holds.
- **Runtime**: always-on machine(s) — a server/desktop/VM that stays up — with federated remote machines. Unattended and scheduled runs are only possible because the runtime is not the laptop. The laptop and phone are viewports.
- **Mobile**: phone is a **co-equal surface**, not an afterthought. Triage, unblock, approve, and diff reading must genuinely work on a phone, and design decisions get weighed against that.
- **Security posture**: single trusted operator, private network / SSH tunnel / trusted reverse proxy. Shared-secret auth (as in the request_input webhook) is the appropriate level; no user identity system.
- **Dependency**: async notify-and-reply depends on an external inbox server that does not exist yet. pi-web's side must be built against an interface, and must degrade cleanly when the inbox is absent (the webhook already 404s when unconfigured).
- **Working reality**: solo, with agents doing the building. Plans must be specific enough for an agent with no prior context to execute — vagueness costs compound downstream.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fork pi-web rather than build a control plane from scratch | Persistent sessions, workspaces/worktrees, terminals, git state, federated machines, and a plugin API already work; the gap is orchestration and async reach, not the substrate | — Pending |
| Pi as the only agent backend | Pi is becoming Edward's only agent; a multi-backend abstraction would be a tax on generality he doesn't need | — Pending |
| Keep Lit + Fastify + no-DB stack | Avoids rewrite tax, keeps fork mergeable with upstream while that still holds | — Pending |
| Track upstream, diverge when it blocks | Keeps upstream fixes flowing for now without permanently constraining design | — Pending |
| Phone treated as co-equal surface | The core value is unblocking agents from anywhere; a desktop-only UI would fail the primary use case | — Pending |
| Async `request_input` reply via shared-secret webhook, gated off by default | The daemon proxy does not forward headers, so auth must live on the web server; unset secret disabling the route keeps the feature invisible until an inbox exists | — Pending |
| Orchestration/inbox boundary left open | Deliberate: a job queue (Claude Jobs) already exists and overlaps; committing before a holistic view risks building the wrong half twice | — Pending |
| Extensibility mechanism left open | Current plugin-API-plus-fork path works but may not be the cleanest strategy; re-plan before committing | — Pending |
| Single-operator security model | Removes auth/roles/isolation from scope entirely, freeing every other design decision | — Pending |

*Last updated: 2026-07-31 after initialization*
