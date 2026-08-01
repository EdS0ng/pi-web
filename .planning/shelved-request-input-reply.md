# Shelved: async `request_input` reply path

**Status:** shelved 2026-08-01 by the upstream sync (`main` hard-reset to `upstream/main`).
**Recover from:** tag `pre-upstream-sync-2026-08`, commit `65c0ef2`
(`wip: async request_input reply webhook + delivery`).
**Rebuild target:** §8 step 2/3, on top of upstream's `ask_user` tool + extension-dialog stack.

The code is gone from the trunk; this file preserves the parts that were worth more than the
code — the one design idea upstream does *not* have, and the two defects §4 found, recorded here
because the code that carried them is no longer around to carry the bug reports.

---

## 1. The idea worth keeping: durable dedupe via an in-band marker line

Upstream's pending-dialog store (`pendingExtensionDialogStore.ts`) and its waiter registry
(`extensionDialogWaiters.ts`) are **in-memory**. A reply that arrives after a sessiond restart has
nothing to deduplicate against. The shelved design solved that without a database:

The injected reply is a plain user message whose **first line is the dedupe marker**:

```
[request_input reply requestId=<id> from=<answeredBy|user>]
<answer text>
```

with `REQUEST_INPUT_REPLY_MARKER_PREFIX = "[request_input reply requestId="`.

Because the marker rides inside the persisted session transcript, "have I already delivered this
reply?" is answerable by a **whole-file rescan** of session entries — `hasReplyMarker(entries,
requestId)` walks persisted entries, pulls the text of each `type: "message"` / `role: "user"`
entry (string content or the first `text` part of an array content), and matches
`startsWith(prefix + requestId + " ")`. The trailing space matters: it stops `req-1` from matching
`req-12`.

That check survives sessiond restarts, process crashes, and machine failover, because the source of
truth is the session file the agent already writes. **This is the property to carry forward.** An
in-memory `Set` was layered on top only to cover the narrow window where a reply is queued
(followUp / compaction) but not yet persisted.

Two-tier dedupe, in short:

| Tier | Covers | Lifetime |
| --- | --- | --- |
| Marker line in the session transcript | delivered + persisted | durable, survives restart |
| In-memory `Set<"sessionId:requestId">` (capped 1000, insertion-ordered eviction) | queued but not yet written | process |

When rebuilding on `ask_user`: upstream's answer delivery writes a transcript record already, so
check whether that record is greppable by request id. If it is, the marker line is unnecessary and
the rescan can target upstream's own record instead — the *technique* is what transfers, not the
string.

## 2. Defects found in §4 — do not re-introduce

### 2a. Missing `FEDERATED_HTTP_ROUTES` entry (broke remote machines)

`registerSessionRoutes` gained `POST /sessions/:sessionId/request-input/reply`, but
`src/shared/federatedRoutes.ts` was never updated. `FEDERATED_HTTP_ROUTES` is the single list that
`machineProxyRoutes.ts` re-exports as `REMOTE_HTTP_ROUTES`, so an unlisted route is simply **not
proxied to remote machines** — the feature worked on `local` and silently 404'd everywhere else.
`src/client/src/api/federatedRouteContract.test.ts` only asserts that observed *client* calls match
the list, so a server route the client never calls directly (this one is driven by the inbox
webhook) slips through the contract test entirely.

**Rule for the rebuild:** every new `/sessions/:sessionId/*` route added to `registerSessionRoutes`
needs a matching `FEDERATED_HTTP_ROUTES` entry in the same commit. Do not rely on the contract test
to catch it.

### 2b. Dedupe key recorded before `prompt()` runs (lost replies)

In `PiSessionService.deliverRequestInputReply` the order was:

```ts
this.rememberProcessedRequestInputReply(processedKey);   // <- marks as handled
const queued = session.isStreaming || session.isCompacting;
await this.prompt(ref, formatReplyMessage(reply));       // <- may throw
```

If `prompt()` threw (archived mid-flight, agent error, queue rejection), the key stayed in the set
and the message was never persisted, so **no marker line was ever written**. Both dedupe tiers then
reported "already handled" and every inbox retry returned `duplicate` — the reply was permanently
lost, with a success-shaped response.

**Fix for the rebuild:** record the key only after the delivery call resolves, or record it
up-front and remove it in a `catch` before rethrowing. Prefer the former; it keeps the failure path
free of cleanup logic.

## 3. Shape of what was removed (for orientation when rebuilding)

- `src/server/requestInputWebhookRoutes.ts` — `POST /api/request-input/reply` on the **web** server.
  The shared-secret check lives here rather than in sessiond because the daemon proxy does not
  forward headers. Uses a length-hiding constant-time compare (sha256 both sides, then
  `timingSafeEqual`). Status relay is deliberate and part of the inbox contract:
  404 = stop retrying, 409 = archived, 400 = malformed, 502 = daemon unavailable / retry later.
- `src/server/sessions/requestInputReply.ts` — pure helpers: `formatReplyMessage`, `hasReplyMarker`,
  `parseReplyBody` (unknown fields ignored, so contract additions stay backward-compatible).
- `PiSessionService.deliverRequestInputReply` — `assertWritable` → `getOrOpen` → dedupe →
  `prompt()`. Reusing `prompt()` is what made a reply landing mid-stream ride the existing
  followUp/compaction queues for free; keep that.
- Config: `requestInput.webhookSecret` / `PI_WEB_REQUEST_INPUT_SECRET` (env wins), unset disables
  the route with a 404.
- Response body: `{ status: "delivered" | "queued" | "duplicate" }`.
