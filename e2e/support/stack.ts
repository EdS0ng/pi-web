import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Workspace-relative image the demo transcript references and the Files panel previews. */
export const DEMO_FILE = "docs/assets/pi-web-dev-screenshot.png";

const DEMO_SESSION_ID = "019ef4c0-0000-7000-8000-000000000001";
const SCRATCH_SESSION_ID = "019ef4c0-0000-7000-8000-000000000002";

/** 1×1 RGBA PNG used to seed the fixture project's previewable image. */
const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/**
 * Provider credentials are stripped from the child environment so tests can
 * never reach a real LLM: prompting from a test intentionally fails with a
 * session error instead of spending tokens.
 */
const CREDENTIAL_ENV_PATTERNS = [
  /_API_KEY$/,
  /^ANTHROPIC_/,
  /^OPENAI_/,
  /^GOOGLE_API_KEY$/,
  /^GEMINI_/,
  /^OPENROUTER_/,
  /^XAI_/,
  /^GROQ_/,
  /^MISTRAL_/,
  /^DEEPSEEK_/,
];

interface TextContent {
  type: "text";
  text: string;
}

interface ToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

interface UserMessage {
  role: "user";
  content: TextContent[];
  timestamp: number;
}

interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ToolCallContent)[];
  api: string;
  provider: string;
  model: string;
  usage: TokenUsage;
  stopReason: string;
  timestamp: number;
}

interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: TextContent[];
  isError: boolean;
  timestamp: number;
}

interface SessionHeaderEntry {
  type: "session";
  version: 3;
  id: string;
  timestamp: string;
  cwd: string;
}

interface ModelChangeEntry {
  type: "model_change";
  id: string;
  parentId: string | null;
  timestamp: string;
  provider: string;
  modelId: string;
}

interface ThinkingLevelChangeEntry {
  type: "thinking_level_change";
  id: string;
  parentId: string | null;
  timestamp: string;
  thinkingLevel: string;
}

interface SessionInfoEntry {
  type: "session_info";
  id: string;
  parentId: string | null;
  timestamp: string;
  name: string;
}

interface MessageEntry {
  type: "message";
  id: string;
  parentId: string | null;
  timestamp: string;
  message: UserMessage | AssistantMessage | ToolResultMessage;
}

export type SessionEntry = SessionHeaderEntry | ModelChangeEntry | ThinkingLevelChangeEntry | SessionInfoEntry | MessageEntry;

export interface StartPiWebStackOptions {
  /**
   * "fixture" (default) seeds a tiny synthetic git repo; "clone" clones this
   * repository like the screenshot script always has.
   */
  project?: "fixture" | "clone";
  /** Keep the temporary workspace on dispose (for debugging). */
  keepTemp?: boolean;
  /** Extra environment variables for the spawned servers (applied last). */
  env?: Record<string, string>;
}

export interface PiWebStack {
  /** Vite client origin, e.g. http://127.0.0.1:PORT/ — navigate the browser here. */
  baseUrl: string;
  /** Fastify API origin (the Vite server proxies /api here). */
  apiUrl: string;
  tempRoot: string;
  projectId: string;
  workspaceId: string;
  projectDir: string;
  /** Pristine seeded session with a full demo transcript; keep read-only. */
  demoSessionId: string;
  /**
   * Near-empty seeded session for tests that mutate state (prompts, etc.).
   * Only seeded for "fixture" projects.
   */
  scratchSessionId: string;
  /** App URL with project/workspace preselected; pass e.g. { session, view }. */
  appUrl(params?: Record<string, string>): string;
  /** Seed an additional session JSONL (header entry carries the session id). */
  seedSession(sessionId: string, entries: SessionEntry[]): Promise<void>;
  /** Read a child-process log ("sessiond" | "api" | "vite"); "" if missing. */
  readLog(name: string): Promise<string>;
  dispose(): Promise<void>;
}

interface ManagedChild {
  name: string;
  child: ChildProcess;
  recentChunks: Buffer[];
}

export async function startPiWebStack(options: StartPiWebStackOptions = {}): Promise<PiWebStack> {
  const project = options.project ?? "fixture";
  const keepTemp = options.keepTemp ?? false;
  // macOS $TMPDIR paths are long enough to overflow the ~104-char unix socket
  // path limit, so prefer the short /tmp root (realpath'd past the symlink).
  const tmpBase = process.platform === "darwin" ? await realpath("/tmp") : tmpdir();
  const tempRoot = await mkdtemp(join(tmpBase, "pi-web-e2e-"));

  const logsDir = join(tempRoot, "logs");
  const dataDir = join(tempRoot, "pi-web-data");
  const configPath = join(tempRoot, "config.json");
  const sessionDir = join(tempRoot, "sessions");
  const agentDir = join(tempRoot, "pi-agent");
  const projectDir = join(tempRoot, project === "clone" ? "pi-web" : "fixture-project");
  const projectsFile = join(dataDir, "projects.json");
  const socketPath = join(dataDir, "sessiond.sock");
  await Promise.all([
    mkdir(logsDir, { recursive: true }),
    mkdir(sessionDir, { recursive: true }),
    mkdir(agentDir, { recursive: true }),
    mkdir(dataDir, { recursive: true }),
  ]);

  const children = new Set<ManagedChild>();
  let disposed = false;
  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    await Promise.all([...children].map(async ({ child }) => terminate(child)));
    if (!keepTemp) await rm(tempRoot, { recursive: true, force: true });
  };

  try {
    if (project === "clone") {
      cloneRepo(projectDir);
      await removeLegacyDemoMedia(projectDir);
    } else {
      await createFixtureProject(projectDir);
    }

    const projectId = project === "clone" ? "pi-web-demo" : "fixture";
    const projectName = project === "clone" ? "pi-web" : "fixture-project";
    const workspaceId = createHash("sha1").update(`${projectId}:${projectDir}`).digest("hex").slice(0, 12);
    await writeJson(projectsFile, {
      projects: [{ id: projectId, name: projectName, path: projectDir, createdAt: new Date().toISOString() }],
    });
    await writeJson(configPath, { host: "127.0.0.1", allowedHosts: true });

    const seedSession = async (sessionId: string, entries: SessionEntry[]): Promise<void> => {
      const timestamp = new Date().toISOString().replaceAll(":", "-");
      const file = join(sessionDir, `${timestamp}_${sessionId}.jsonl`);
      await writeFile(file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
    };
    await seedSession(DEMO_SESSION_ID, demoTranscriptEntries(DEMO_SESSION_ID, projectDir));
    // The scratch session is test plumbing; keep it out of "clone" stacks so
    // docs screenshots show only the demo session.
    if (project === "fixture") await seedSession(SCRATCH_SESSION_ID, scratchSessionEntries(SCRATCH_SESSION_ID, projectDir));

    const apiPort = await getFreePort();
    const clientPort = await getFreePort();
    const env: Record<string, string> = {
      ...sanitizeEnv(process.env),
      PI_WEB_DATA_DIR: dataDir,
      PI_WEB_CONFIG: configPath,
      PI_WEB_PROJECTS_FILE: projectsFile,
      PI_WEB_SESSIOND_SOCKET: socketPath,
      PI_WEB_HOST: "127.0.0.1",
      PI_WEB_PORT: String(apiPort),
      PI_WEB_ALLOWED_HOSTS: "true",
      PI_CODING_AGENT_DIR: agentDir,
      PI_CODING_AGENT_SESSION_DIR: sessionDir,
      PI_OFFLINE: "1",
      NO_COLOR: "1",
      ...(options.env ?? {}),
    };

    const tsxBin = join(REPO_ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
    const viteBin = join(REPO_ROOT, "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite");
    assertExecutable(tsxBin, "Run npm install before starting the PI WEB test stack.");
    assertExecutable(viteBin, "Run npm install before starting the PI WEB test stack.");

    const spawnOptions = { env, cwd: REPO_ROOT, logsDir, children, isDisposing: () => disposed };
    startChild("sessiond", tsxBin, ["src/server/sessiond.ts"], spawnOptions);
    await withLogTails(children, waitForFile(socketPath, 10_000));
    startChild("api", tsxBin, ["src/server/index.ts"], spawnOptions);
    await withLogTails(children, waitForHttp(`http://127.0.0.1:${String(apiPort)}/api/projects`, 15_000));
    startChild("vite", viteBin, ["--host", "127.0.0.1", "--port", String(clientPort), "--strictPort", "true"], spawnOptions);
    await withLogTails(children, waitForHttp(`http://127.0.0.1:${String(clientPort)}/`, 30_000));

    const baseUrl = `http://127.0.0.1:${String(clientPort)}/`;
    return {
      baseUrl,
      apiUrl: `http://127.0.0.1:${String(apiPort)}`,
      tempRoot,
      projectId,
      workspaceId,
      projectDir,
      demoSessionId: DEMO_SESSION_ID,
      scratchSessionId: SCRATCH_SESSION_ID,
      appUrl(params = {}) {
        const url = new URL(baseUrl);
        url.searchParams.set("project", projectId);
        url.searchParams.set("workspace", workspaceId);
        for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
        return url.href;
      },
      seedSession,
      async readLog(name) {
        try {
          return await readFile(join(logsDir, `${name}.log`), "utf8");
        } catch {
          return "";
        }
      },
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}

/** The transcript the screenshot script has always seeded, parameterized. */
export function demoTranscriptEntries(sessionId: string, cwd: string): SessionEntry[] {
  const now = new Date();
  const timestamp = now.toISOString();
  const ms = now.getTime();
  return [
    { type: "session", version: 3, id: sessionId, timestamp, cwd },
    { type: "model_change", id: "10000001", parentId: null, timestamp: iso(ms + 100), provider: "openai-codex", modelId: "gpt-5.5" },
    { type: "thinking_level_change", id: "10000002", parentId: "10000001", timestamp: iso(ms + 200), thinkingLevel: "off" },
    {
      type: "message",
      id: "10000003",
      parentId: "10000002",
      timestamp: iso(ms + 1000),
      message: {
        role: "user",
        content: [{ type: "text", text: "Take a screenshot of https://pi-web.dev, save it under docs/assets, and tell me where I can preview it." }],
        timestamp: ms + 1000,
      },
    },
    { type: "session_info", id: "10000004", parentId: "10000003", timestamp: iso(ms + 1100), name: "Screenshot pi-web.dev" },
    {
      type: "message",
      id: "10000005",
      parentId: "10000004",
      timestamp: iso(ms + 2000),
      message: {
        role: "assistant",
        content: [{
          type: "toolCall",
          id: "call_demo_screenshot",
          name: "bash",
          arguments: { command: `capture-browser-screenshot https://pi-web.dev ${DEMO_FILE}` },
        }],
        api: "openai-codex-responses",
        provider: "openai-codex",
        model: "gpt-5.5",
        usage: zeroUsage(),
        stopReason: "toolUse",
        timestamp: ms + 2000,
      },
    },
    {
      type: "message",
      id: "10000006",
      parentId: "10000005",
      timestamp: iso(ms + 3000),
      message: {
        role: "toolResult",
        toolCallId: "call_demo_screenshot",
        toolName: "bash",
        content: [{ type: "text", text: `Saved screenshot to ${DEMO_FILE}` }],
        isError: false,
        timestamp: ms + 3000,
      },
    },
    {
      type: "message",
      id: "10000007",
      parentId: "10000006",
      timestamp: iso(ms + 4000),
      message: {
        role: "assistant",
        content: [{ type: "text", text: `Done — I saved the screenshot at \`${DEMO_FILE}\`. Open the Files panel to preview it.` }],
        api: "openai-codex-responses",
        provider: "openai-codex",
        model: "gpt-5.5",
        usage: zeroUsage(),
        stopReason: "stop",
        timestamp: ms + 4000,
      },
    },
  ];
}

function scratchSessionEntries(sessionId: string, cwd: string): SessionEntry[] {
  const now = new Date();
  return [
    { type: "session", version: 3, id: sessionId, timestamp: now.toISOString(), cwd },
    { type: "session_info", id: "20000001", parentId: null, timestamp: iso(now.getTime() + 100), name: "Scratch session" },
  ];
}

function sanitizeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (CREDENTIAL_ENV_PATTERNS.some((pattern) => pattern.test(key))) continue;
    sanitized[key] = value;
  }
  return sanitized;
}

function cloneRepo(target: string): void {
  const result = spawnSync("git", ["clone", "--quiet", "--local", "--no-hardlinks", REPO_ROOT, target], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`git clone failed:\n${result.stderr || result.stdout}`);
}

async function removeLegacyDemoMedia(projectRoot: string): Promise<void> {
  await Promise.all([
    rm(join(projectRoot, "docs", "assets", "pi-web-demo.gif"), { force: true }),
    rm(join(projectRoot, "docs", "assets", "pi-web-demo-flow.gif"), { force: true }),
    rm(join(projectRoot, "docs", "assets", "pi-web-demo.webm"), { force: true }),
  ]);
}

async function createFixtureProject(dir: string): Promise<void> {
  await mkdir(join(dir, "src"), { recursive: true });
  await mkdir(join(dir, "docs", "assets"), { recursive: true });
  await writeFile(join(dir, "README.md"), "# Fixture project\n\nSynthetic workspace for PI WEB browser tests.\n", "utf8");
  await writeFile(join(dir, "src", "hello.ts"), 'export function hello(): string {\n  return "hello from the fixture project";\n}\n', "utf8");
  await writeFile(join(dir, DEMO_FILE), Buffer.from(TINY_PNG_BASE64, "base64"));
  runGit(dir, "init", "--quiet");
  runGit(dir, "add", "-A");
  runGit(dir, "-c", "user.name=pi-web-e2e", "-c", "user.email=e2e@pi-web.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture project");
}

function runGit(cwd: string, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
}

interface StartChildOptions {
  env: Record<string, string>;
  cwd: string;
  logsDir: string;
  children: Set<ManagedChild>;
  isDisposing: () => boolean;
}

function startChild(name: string, command: string, args: string[], { env, cwd, logsDir, children, isDisposing }: StartChildOptions): void {
  const logPath = join(logsDir, `${name}.log`);
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  const managed: ManagedChild = { name, child, recentChunks: [] };
  children.add(managed);
  const collect = (chunk: Buffer): void => {
    managed.recentChunks.push(chunk);
    if (managed.recentChunks.length > 120) managed.recentChunks.shift();
    appendLog(logPath, chunk);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  child.once("exit", (code, signal) => {
    children.delete(managed);
    if (!isDisposing() && code !== null && code !== 0 && signal === null) {
      console.error(`[pi-web stack] ${name} exited with code ${String(code)}. Recent log:\n${recentOutput(managed)}`);
    }
  });
}

function recentOutput(managed: ManagedChild): string {
  return Buffer.concat(managed.recentChunks).toString("utf8").trim();
}

function appendLog(path: string, chunk: Buffer): void {
  void mkdir(dirname(path), { recursive: true })
    .then(async () => writeFile(path, chunk, { flag: "a" }))
    .catch(() => undefined);
}

/** Rethrow wait failures with the tail of every child log for diagnosis. */
async function withLogTails(children: Set<ManagedChild>, wait: Promise<void>): Promise<void> {
  try {
    await wait;
  } catch (error) {
    const tails = [...children]
      .map((managed) => `--- ${managed.name} ---\n${recentOutput(managed)}`)
      .join("\n");
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\n${tails}`, { cause: error });
  }
}

async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    sleep(2500).then(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }),
  ]);
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`${String(response.status)} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function waitForFile(path: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(path)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : undefined;
      server.close(() => {
        if (port === undefined) reject(new Error("Unable to allocate a port"));
        else resolvePort(port);
      });
    });
    server.on("error", reject);
  });
}

function assertExecutable(path: string, message: string): void {
  if (!existsSync(path)) throw new Error(`${path} was not found. ${message}`);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function zeroUsage(): TokenUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
