import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MAX_UPLOAD_BYTES, DEFAULT_UPLOADS_FOLDER, effectivePiWebConfig, loadPiWebConfig, maxUploadBytes, requestInputWebhookSecret, savePiWebConfig, sessionIdleTimeoutMs, spawnSessionsEnabled, subsessionsEnabled } from "./config.js";

let tempDir: string;
let configPath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pi-web-config-test-"));
  configPath = join(tempDir, "config.json");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("PI WEB config persistence", () => {
  it("writes and reads the configured PI WEB config path", () => {
    const saved = savePiWebConfig({ host: "0.0.0.0", port: 9000, allowedHosts: ["example.local"], shortcuts: { "core:view.chat": "mod+1", "core:session.stop": null }, plugins: { "workspace-tasks": { enabled: false, settings: { configPath: ".pi-web/tasks.json" } } }, pathAccess: { allowedPaths: ["/tmp", "~/SDKs"] }, uploads: { defaultFolder: "manual\\incoming" } }, testOptions());

    expect(saved).toEqual({ path: configPath, exists: true, config: { host: "0.0.0.0", port: 9000, allowedHosts: ["example.local"], shortcuts: { "core:view.chat": "mod+1", "core:session.stop": null }, plugins: { "workspace-tasks": { enabled: false, settings: { configPath: ".pi-web/tasks.json" } } }, pathAccess: { allowedPaths: ["/tmp", "~/SDKs"] }, uploads: { defaultFolder: "manual/incoming" } } });
    expect(loadPiWebConfig(testOptions())).toEqual(saved);
  });

  it("preserves unrelated config keys while replacing managed keys", async () => {
    await writeFile(configPath, `${JSON.stringify({ host: "old", port: 8504, allowedHosts: true, plugins: { info: { enabled: false } }, pathAccess: { allowedPaths: ["/old"] }, uploads: { defaultFolder: "old" }, future: { enabled: true } }, null, 2)}\n`, "utf8");

    savePiWebConfig({ port: 9000, allowedHosts: [], pathAccess: { allowedPaths: ["/new"] }, uploads: { defaultFolder: "new" } }, testOptions());

    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({ future: { enabled: true }, port: 9000, allowedHosts: [], pathAccess: { allowedPaths: ["/new"] }, uploads: { defaultFolder: "new" } });
  });

  it("rejects invalid plugin config", async () => {
    await writeFile(configPath, `${JSON.stringify({ plugins: { info: { enabled: "no" } } }, null, 2)}\n`, "utf8");

    expect(() => loadPiWebConfig(testOptions())).toThrow("PI WEB config plugin enabled values must be booleans");
  });

  it("rejects invalid path access config", async () => {
    await writeFile(configPath, `${JSON.stringify({ pathAccess: { allowedPaths: [""] } }, null, 2)}\n`, "utf8");

    expect(() => loadPiWebConfig(testOptions())).toThrow("PI WEB config pathAccess.allowedPaths must be an array of non-empty strings");
  });

  it("persists and reads maxUploadBytes", () => {
    savePiWebConfig({ maxUploadBytes: 1234 }, testOptions());
    expect(loadPiWebConfig(testOptions()).config.maxUploadBytes).toBe(1234);
  });

  it("persists and reads sessionIdleTimeoutMs", () => {
    savePiWebConfig({ sessionIdleTimeoutMs: 60_000 }, testOptions());
    expect(loadPiWebConfig(testOptions()).config.sessionIdleTimeoutMs).toBe(60_000);
  });

  it("rejects a negative sessionIdleTimeoutMs", async () => {
    await writeFile(configPath, `${JSON.stringify({ sessionIdleTimeoutMs: -1 }, null, 2)}\n`, "utf8");

    expect(() => loadPiWebConfig(testOptions())).toThrow("PI WEB config sessionIdleTimeoutMs must be a non-negative integer");
  });

  it("reads and rejects requestInput webhook config", async () => {
    await writeFile(configPath, `${JSON.stringify({ requestInput: { webhookSecret: "shh" } }, null, 2)}\n`, "utf8");
    expect(loadPiWebConfig(testOptions()).config.requestInput).toEqual({ webhookSecret: "shh" });

    await writeFile(configPath, `${JSON.stringify({ requestInput: { webhookSecret: "" } }, null, 2)}\n`, "utf8");
    expect(() => loadPiWebConfig(testOptions())).toThrow("PI WEB config requestInput.webhookSecret must be a non-empty string");
  });

  it("exposes the default upload folder in the effective config", () => {
    expect(effectivePiWebConfig(testOptions()).config.uploads).toEqual({ defaultFolder: DEFAULT_UPLOADS_FOLDER });
  });

  it("rejects upload defaults that are not workspace-relative", async () => {
    await writeFile(configPath, `${JSON.stringify({ uploads: { defaultFolder: "../outside" } }, null, 2)}\n`, "utf8");

    expect(() => loadPiWebConfig(testOptions())).toThrow("PI WEB config uploads.defaultFolder must not contain path traversal");
  });
});

describe("maxUploadBytes", () => {
  it("defaults when nothing is configured", () => {
    expect(maxUploadBytes({}, {})).toBe(DEFAULT_MAX_UPLOAD_BYTES);
  });

  it("prefers the env override over config", () => {
    expect(maxUploadBytes({ PI_WEB_MAX_UPLOAD_BYTES: "2048" }, { maxUploadBytes: 99 })).toBe(2048);
  });

  it("falls back to config when env is unset or invalid", () => {
    expect(maxUploadBytes({ PI_WEB_MAX_UPLOAD_BYTES: "not-a-number" }, { maxUploadBytes: 555 })).toBe(555);
  });
});

describe("sessionIdleTimeoutMs", () => {
  it("is undefined by default so the session service default applies", () => {
    expect(sessionIdleTimeoutMs({}, {})).toBeUndefined();
  });

  it("prefers the env override over config, including 0 to disable reaping", () => {
    expect(sessionIdleTimeoutMs({ PI_WEB_SESSION_IDLE_TIMEOUT_MS: "60000" }, { sessionIdleTimeoutMs: 99 })).toBe(60_000);
    expect(sessionIdleTimeoutMs({ PI_WEB_SESSION_IDLE_TIMEOUT_MS: "0" }, { sessionIdleTimeoutMs: 99 })).toBe(0);
  });

  it("falls back to config when env is unset or invalid", () => {
    expect(sessionIdleTimeoutMs({ PI_WEB_SESSION_IDLE_TIMEOUT_MS: "not-a-number" }, { sessionIdleTimeoutMs: 555 })).toBe(555);
  });
});

describe("requestInputWebhookSecret", () => {
  it("is undefined by default (webhook disabled)", () => {
    expect(requestInputWebhookSecret({}, {})).toBeUndefined();
  });

  it("prefers the env override over config", () => {
    expect(requestInputWebhookSecret({ PI_WEB_REQUEST_INPUT_SECRET: "env-secret" }, { requestInput: { webhookSecret: "file-secret" } })).toBe("env-secret");
  });

  it("falls back to config when env is unset or empty", () => {
    expect(requestInputWebhookSecret({ PI_WEB_REQUEST_INPUT_SECRET: "" }, { requestInput: { webhookSecret: "file-secret" } })).toBe("file-secret");
    expect(requestInputWebhookSecret({}, { requestInput: {} })).toBeUndefined();
  });
});

describe("spawnSessionsEnabled", () => {
  it("is on by default when nothing is configured", () => {
    expect(spawnSessionsEnabled({}, {})).toBe(true);
  });

  it("honors an explicit config opt-out", () => {
    expect(spawnSessionsEnabled({}, { spawnSessions: false })).toBe(false);
  });

  it("lets the env var override the config in both directions", () => {
    expect(spawnSessionsEnabled({ PI_WEB_SPAWN_SESSIONS: "0" }, { spawnSessions: true })).toBe(false);
    expect(spawnSessionsEnabled({ PI_WEB_SPAWN_SESSIONS: "1" }, { spawnSessions: false })).toBe(true);
  });
});

describe("subsessionsEnabled", () => {
  it("is off by default while the capability is in beta", () => {
    expect(subsessionsEnabled({}, {})).toBe(false);
  });

  it("honors an explicit config opt-in", () => {
    expect(subsessionsEnabled({}, { subsessions: true })).toBe(true);
  });

  it("lets the env var override the config in both directions", () => {
    expect(subsessionsEnabled({ PI_WEB_SUBSESSIONS: "1" }, { subsessions: false })).toBe(true);
    expect(subsessionsEnabled({ PI_WEB_SUBSESSIONS: "0" }, { subsessions: true })).toBe(false);
  });
});

function testOptions(): { env: NodeJS.ProcessEnv } {
  return { env: { PI_WEB_CONFIG: configPath } };
}
