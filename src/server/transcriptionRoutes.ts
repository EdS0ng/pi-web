import { join } from "node:path";
import { readStoredCredential } from "@earendil-works/pi-coding-agent";
import type { FastifyInstance } from "fastify";

/** Codex/ChatGPT subscription provider id in ~/.pi/agent/auth.json. */
const CODEX_PROVIDER = "openai-codex";

/** JWT claim namespace that carries the ChatGPT account id (matches the SDK's extractAccountId). */
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

const DEFAULT_TRANSCRIBE_URL = "https://chatgpt.com/backend-api/transcribe";

// The /transcribe surface (unlike /backend-api/codex/*) sits behind Cloudflare bot
// management that 403s the SDK's `pi (...)` User-Agent. A real browser UA passes
// reliably. Proven by scripts/transcribe-spike.ts against pi-web's own token.
const DEFAULT_ORIGINATOR = "pi";
const DEFAULT_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// The endpoint infers the format from the bytes, but we still advertise an honest
// mime and filename extension. The spike confirmed webm/opus, wav, mp4 and m4a.
const AUDIO_MIME_BY_EXT: Record<string, string> = {
  webm: "audio/webm",
  wav: "audio/wav",
  mp4: "audio/mp4",
  m4a: "audio/mp4",
};
const DEFAULT_EXT = "webm";

const SIGN_IN_MESSAGE = "Sign in to ChatGPT (Codex Subscription) to use voice transcription.";
const SESSION_EXPIRED_MESSAGE = "Your ChatGPT (Codex Subscription) session expired. Sign in again.";
const SESSION_INVALID_MESSAGE = "Your ChatGPT (Codex Subscription) session is invalid. Sign in again.";
const UPSTREAM_FAILED_MESSAGE = "Transcription failed. Please try again.";
const UPSTREAM_UNREACHABLE_MESSAGE = "Transcription service is unreachable. Please try again.";

export interface CodexAuthProvider {
  /** The current Codex access token, or undefined when the user is not signed in. */
  getAccessToken(): Promise<string | undefined>;
}

export interface TranscriptionRouteDependencies {
  codexAuth: CodexAuthProvider;
  /** Overrides for testing / tuning; defaults are the spike-blessed values. */
  originator?: string;
  userAgent?: string;
  transcribeUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface CodexAuthProviderOptions {
  /**
   * Resolves the Pi-compatible agent profile directory holding `auth.json`.
   * Omitted or resolving to undefined falls back to the SDK's own default path.
   */
  agentDir?: () => Promise<string | undefined>;
}

/**
 * Auth provider over the agent profile's `auth.json`. Reads through on every
 * call — via the same one-off `readStoredCredential` the session service uses —
 * so a token the session daemon refreshed on disk is picked up without
 * restarting the web process, and nothing is touched until a transcription
 * actually happens (app startup stays hermetic).
 */
export function createCodexAuthProvider(options: CodexAuthProviderOptions = {}): CodexAuthProvider {
  return {
    async getAccessToken(): Promise<string | undefined> {
      const dir = await options.agentDir?.();
      const credential = readStoredCredential(CODEX_PROVIDER, dir === undefined ? undefined : join(dir, "auth.json"));
      if (credential === undefined) return undefined;
      // Codex signs in through OAuth; the api-key branch is only for a
      // hand-written auth.json entry.
      const token = credential.type === "oauth" ? credential.access : credential.key;
      return token === undefined || token === "" ? undefined : token;
    },
  };
}

/**
 * Extract the ChatGPT account id from a Codex access token by base64url-decoding
 * the JWT payload and reading `["https://api.openai.com/auth"].chatgpt_account_id`.
 * Throws on a malformed token or a missing claim.
 */
export function extractCodexAccountId(accessToken: string): string {
  const parts = accessToken.split(".");
  const payloadSegment = parts[1];
  if (parts.length !== 3 || payloadSegment === undefined) {
    throw new Error("Invalid Codex access token: expected a JWT with three segments");
  }
  let payload: unknown;
  try {
    const json = Buffer.from(base64UrlToBase64(payloadSegment), "base64").toString("utf8");
    payload = JSON.parse(json);
  } catch {
    throw new Error("Invalid Codex access token: payload is not valid JSON");
  }
  const auth = isRecord(payload) ? payload[JWT_CLAIM_PATH] : undefined;
  const accountId = isRecord(auth) ? auth["chatgpt_account_id"] : undefined;
  if (typeof accountId !== "string" || accountId === "") {
    throw new Error("Codex access token is missing a chatgpt_account_id claim");
  }
  return accountId;
}

export function registerTranscriptionRoutes(app: FastifyInstance, deps: TranscriptionRouteDependencies): void {
  registerAudioBodyParser(app);

  const transcribeUrl = deps.transcribeUrl ?? DEFAULT_TRANSCRIBE_URL;
  const originator = deps.originator ?? DEFAULT_ORIGINATOR;
  const userAgent = deps.userAgent ?? DEFAULT_USER_AGENT;
  const fetchImpl = deps.fetchImpl ?? fetch;

  app.post<{ Body: Buffer; Querystring: { ext?: string } }>("/api/transcribe", async (request, reply) => {
    const body = request.body;
    if (!Buffer.isBuffer(body) || body.byteLength === 0) {
      return reply.code(400).send({ error: "No audio was uploaded." });
    }

    const token = await deps.codexAuth.getAccessToken();
    if (token === undefined) {
      return reply.code(401).send({ error: SIGN_IN_MESSAGE });
    }

    let accountId: string;
    try {
      accountId = extractCodexAccountId(token);
    } catch {
      return reply.code(401).send({ error: SESSION_INVALID_MESSAGE });
    }

    const ext = normalizeExt(request.query.ext);
    const form = new FormData();
    // A single part named `file` — no model/response_format/language; the server infers everything.
    form.append("file", new Blob([new Uint8Array(body)], { type: audioMime(ext) }), `audio.${ext}`);

    let response: Response;
    try {
      response = await fetchImpl(transcribeUrl, {
        method: "POST",
        // Deliberately no Content-Type — fetch derives the multipart boundary from FormData.
        headers: {
          Authorization: `Bearer ${token}`,
          "ChatGPT-Account-Id": accountId,
          originator,
          "User-Agent": userAgent,
          Accept: "application/json",
        },
        body: form,
      });
    } catch (error) {
      app.log.warn({ err: error }, "transcription upstream request failed");
      return reply.code(502).send({ error: UPSTREAM_UNREACHABLE_MESSAGE });
    }

    if (response.status === 401) {
      return reply.code(401).send({ error: SESSION_EXPIRED_MESSAGE });
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      app.log.warn({ status: response.status, detail: detail.slice(0, 500) }, "transcription upstream returned an error");
      return reply.code(502).send({ error: UPSTREAM_FAILED_MESSAGE });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return reply.code(502).send({ error: UPSTREAM_FAILED_MESSAGE });
    }
    const text = isRecord(payload) ? payload["text"] : undefined;
    if (typeof text !== "string") {
      app.log.warn("transcription upstream response had no text field");
      return reply.code(502).send({ error: UPSTREAM_FAILED_MESSAGE });
    }
    return { text };
  });
}

function registerAudioBodyParser(app: FastifyInstance): void {
  // The browser posts the audio Blob as application/octet-stream (the uploadWorkspaceFile
  // precedent). Tolerate a repeat registration since other route modules add the same parser.
  try {
    app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, body, done) => { done(null, body); });
  } catch { /* already registered */ }
}

function normalizeExt(ext: string | undefined): string {
  const cleaned = (ext ?? "").toLowerCase().replace(/[^a-z0-9]/gu, "");
  return AUDIO_MIME_BY_EXT[cleaned] === undefined ? DEFAULT_EXT : cleaned;
}

function audioMime(ext: string): string {
  return AUDIO_MIME_BY_EXT[ext] ?? AUDIO_MIME_BY_EXT[DEFAULT_EXT] ?? "application/octet-stream";
}

function base64UrlToBase64(input: string): string {
  return input.replace(/-/gu, "+").replace(/_/gu, "/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
