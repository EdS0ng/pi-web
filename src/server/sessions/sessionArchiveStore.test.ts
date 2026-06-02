import { constants, type PathLike } from "node:fs";
import { access, copyFile, mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionArchiveStore } from "./sessionArchiveStore.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    copyFile: vi.fn(() => Promise.reject(Object.assign(new Error("copyfile denied"), { code: "EPERM" }))),
    rename: vi.fn((oldPath: PathLike, newPath: PathLike) => actual.rename(oldPath, newPath)),
  };
});

const tempRoots: string[] = [];

describe("SessionArchiveStore", () => {
  afterEach(async () => {
    vi.mocked(copyFile).mockClear();
    await resetRenameMock();
    await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("archives and restores through the stream-copy path when copyFile would fail with EPERM", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-archive-"));
    tempRoots.push(root);
    const activeDir = join(root, "active");
    await mkdir(activeDir, { recursive: true });
    const sourcePath = join(activeDir, "2026-01-01_s1.jsonl");
    await writeFile(sourcePath, "session contents\n", "utf8");

    const store = new SessionArchiveStore(join(root, "archived-sessions.json"), join(root, "archived-files"));
    const record = await store.archive(archiveInput(sourcePath));

    expect(await exists(sourcePath)).toBe(false);
    expect(record.originalPath).toBe(sourcePath);
    expect(record.archivePath).toBeDefined();
    if (record.archivePath === undefined) throw new Error("Expected archive path");
    expect(await readFile(record.archivePath, "utf8")).toBe("session contents\n");
    await expect(store.list()).resolves.toMatchObject([{ sessionId: "s1", originalPath: sourcePath, archivePath: record.archivePath, messageCount: 2 }]);

    await store.restore("s1");

    expect(await readFile(sourcePath, "utf8")).toBe("session contents\n");
    expect(await exists(record.archivePath)).toBe(false);
    await expect(store.list()).resolves.toEqual([]);
    expect(copyFile).not.toHaveBeenCalled();
  });

  it("restores with a streamed copy fallback when rename reports EXDEV", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-archive-"));
    tempRoots.push(root);
    const activeDir = join(root, "active");
    await mkdir(activeDir, { recursive: true });
    const sourcePath = join(activeDir, "2026-01-01_s1.jsonl");
    await writeFile(sourcePath, "session contents\n", "utf8");

    const store = new SessionArchiveStore(join(root, "archived-sessions.json"), join(root, "archived-files"));
    const record = await store.archive(archiveInput(sourcePath));
    if (record.archivePath === undefined) throw new Error("Expected archive path");
    vi.mocked(rename).mockClear();
    vi.mocked(copyFile).mockClear();
    vi.mocked(rename).mockImplementationOnce(() => Promise.reject(nodeError("EXDEV")));

    await store.restore("s1");

    expect(rename).toHaveBeenNthCalledWith(1, record.archivePath, sourcePath);
    expect(await readFile(sourcePath, "utf8")).toBe("session contents\n");
    expect(await exists(record.archivePath)).toBe(false);
    await expect(store.list()).resolves.toEqual([]);
    expect(copyFile).not.toHaveBeenCalled();
  });

  it("does not leave the final archive path behind when a streamed copy fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-archive-"));
    tempRoots.push(root);
    const activeDir = join(root, "active");
    await mkdir(activeDir, { recursive: true });
    const sourcePath = join(activeDir, "2026-01-01_s1.jsonl");
    await mkdir(sourcePath, { recursive: true });
    const archiveDir = join(root, "archived-files");
    const archivePath = join(archiveDir, "2026-01-01_s1.jsonl");

    const store = new SessionArchiveStore(join(root, "archived-sessions.json"), archiveDir);

    await expect(store.archive(archiveInput(sourcePath))).rejects.toThrow();

    expect(await exists(archivePath)).toBe(false);
    await expect(readdir(archiveDir)).resolves.toEqual([]);
  });
});

function archiveInput(sourcePath: string) {
  return {
    sessionId: "s1",
    cwd: "/workspace",
    path: sourcePath,
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:01:00.000Z",
    messageCount: 2,
    firstMessage: "hello",
  };
}

async function resetRenameMock(): Promise<void> {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.mocked(rename).mockReset();
  vi.mocked(rename).mockImplementation((oldPath: PathLike, newPath: PathLike) => actual.rename(oldPath, newPath));
}

function nodeError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
