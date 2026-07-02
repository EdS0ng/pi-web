/**
 * THROWAWAY SPIKE — Phase 0 of the STT plan. Delete once the transcription
 * route ships.
 *
 * Proves whether pi-web's own `openai-codex` OAuth token (from
 * ~/.pi/agent/auth.json) authenticates against Codex's transcription endpoint
 * `POST https://chatgpt.com/backend-api/transcribe`, and which
 * originator / User-Agent / audio format the endpoint accepts for us.
 *
 * Usage:
 *   npx tsx scripts/transcribe-spike.ts <audiofile> [--originator=pi|codex|<literal>] [--ua=pi|codex|<literal>]
 *
 * Examples:
 *   npx tsx scripts/transcribe-spike.ts /tmp/sample.wav
 *   npx tsx scripts/transcribe-spike.ts /tmp/sample.webm --originator=codex
 *   npx tsx scripts/transcribe-spike.ts /tmp/sample.m4a --originator=pi --ua=codex
 */
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { AuthStorage } from "@earendil-works/pi-coding-agent";

const TRANSCRIBE_URL = "https://chatgpt.com/backend-api/transcribe";
const PROVIDER = "openai-codex";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

// originator presets: "pi" is pi-web's real value; "codex" mirrors the archived
// codex-voice Swift app (Codex Desktop) so we can A/B the header.
const ORIGINATORS: Record<string, string> = {
  pi: "pi",
  codex: "Codex Desktop",
};

const USER_AGENTS: Record<string, string> = {
  // Matches the SDK's buildBaseCodexHeaders(): `pi (<platform> <release>; <arch>)`.
  pi: `pi (${os.platform()} ${os.release()}; ${os.arch()})`,
  // A plausible Codex-desktop-style UA for comparison.
  codex: "Codex Desktop/0.1 (macOS)",
};

// Map file extension -> the audio MIME we advertise on the multipart part.
const MIME_BY_EXT: Record<string, string> = {
  wav: "audio/wav",
  webm: "audio/webm",
  mp4: "audio/mp4",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  aac: "audio/aac",
  ogg: "audio/ogg",
  flac: "audio/flac",
};

function parseArgs(argv: string[]): { file?: string; originator: string; ua: string } {
  let file: string | undefined;
  let originator = "pi";
  let ua = "pi";
  for (const arg of argv) {
    if (arg.startsWith("--originator=")) originator = arg.slice("--originator=".length);
    else if (arg.startsWith("--ua=")) ua = arg.slice("--ua=".length);
    else if (!arg.startsWith("--")) file = arg;
  }
  return { file, originator, ua };
}

/** Same logic the transcription route will use — replicates the SDK's extractAccountId. */
function extractCodexAccountId(token: string): string {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT: expected 3 segments");
  // base64url -> base64 so Buffer/atob can decode `-`/`_` payloads.
  const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const payload = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as Record<string, unknown>;
  const auth = payload[JWT_CLAIM_PATH] as { chatgpt_account_id?: string } | undefined;
  const accountId = auth?.chatgpt_account_id;
  if (!accountId) throw new Error(`No chatgpt_account_id claim under "${JWT_CLAIM_PATH}"`);
  return accountId;
}

function redactToken(token: string): string {
  if (token.length <= 12) return "***";
  return `${token.slice(0, 6)}…${token.slice(-4)} (len=${token.length})`;
}

async function main(): Promise<void> {
  const { file, originator: originatorKey, ua: uaKey } = parseArgs(process.argv.slice(2));
  if (!file) {
    console.error("Usage: npx tsx scripts/transcribe-spike.ts <audiofile> [--originator=pi|codex] [--ua=pi|codex]");
    process.exitCode = 1;
    return;
  }

  const originator = ORIGINATORS[originatorKey] ?? originatorKey;
  const userAgent = USER_AGENTS[uaKey] ?? uaKey;

  console.log("=".repeat(72));
  console.log("pi-web /transcribe spike");
  console.log("=".repeat(72));

  // 1. Load pi-web's own token exactly the way the product route will.
  const auth = AuthStorage.create();
  auth.reload();
  if (!auth.hasAuth(PROVIDER)) {
    console.error(`\n❌ Not signed in to "${PROVIDER}". Run pi-web and sign in to ChatGPT (Codex Subscription) first.`);
    process.exitCode = 1;
    return;
  }
  const token = await auth.getApiKey(PROVIDER);
  if (!token) {
    console.error(`\n❌ getApiKey("${PROVIDER}") returned no token (refresh may have failed).`);
    process.exitCode = 1;
    return;
  }

  // 2. Account id from the JWT.
  let accountId: string;
  try {
    accountId = extractCodexAccountId(token);
  } catch (error) {
    console.error(`\n❌ Failed to extract account id: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  // 3. Read the audio file and build the multipart body.
  const abs = path.resolve(file);
  const bytes = await readFile(abs);
  const ext = path.extname(abs).slice(1).toLowerCase() || "wav";
  const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
  const filename = `audio.${ext}`;

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), filename);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "ChatGPT-Account-Id": accountId,
    originator,
    "User-Agent": userAgent,
    Accept: "application/json",
    // NOTE: no Content-Type — fetch derives the multipart boundary from FormData.
  };

  // 4. Log the request conclusively.
  console.log("\n--- request ---");
  console.log("URL:            ", TRANSCRIBE_URL);
  console.log("method:         ", "POST");
  console.log("file:           ", abs);
  console.log("file size:      ", `${bytes.byteLength} bytes`);
  console.log("part name:      ", "file");
  console.log("part filename:  ", filename);
  console.log("part mime:      ", mime);
  console.log("headers:");
  for (const [k, v] of Object.entries(headers)) {
    console.log(`  ${k}: ${k === "Authorization" ? `Bearer ${redactToken(token)}` : v}`);
  }
  console.log(`  (originator preset: "${originatorKey}", ua preset: "${uaKey}")`);
  console.log("account id:     ", accountId);

  // 5. Fire.
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(TRANSCRIBE_URL, { method: "POST", headers, body: form });
  } catch (error) {
    console.error(`\n❌ Network error after ${Date.now() - startedAt}ms:`, error);
    process.exitCode = 1;
    return;
  }
  const elapsedMs = Date.now() - startedAt;
  const rawBody = await response.text();

  console.log("\n--- response ---");
  console.log("status:         ", `${response.status} ${response.statusText}`);
  console.log("content-type:   ", response.headers.get("content-type"));
  console.log("elapsed:        ", `${elapsedMs}ms`);
  console.log("raw body:");
  console.log(rawBody);

  console.log("\n--- verdict ---");
  if (response.ok) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      parsed = undefined;
    }
    const text = (parsed as { text?: unknown } | undefined)?.text;
    if (typeof text === "string") {
      console.log(`✅ OK — transcribed text: ${JSON.stringify(text)}`);
      const extraKeys = parsed && typeof parsed === "object" ? Object.keys(parsed).filter((k) => k !== "text") : [];
      console.log(extraKeys.length ? `   extra response fields: ${extraKeys.join(", ")}` : "   response is strictly { text }");
    } else {
      console.log("⚠️  2xx but no string `text` field — inspect raw body above.");
    }
  } else if (response.status === 401) {
    console.log("🔒 401 Unauthorized — token/account/originator rejected for this endpoint.");
  } else {
    console.log(`❌ HTTP ${response.status} — see raw body above.`);
  }
  console.log("=".repeat(72));
}

void main();
