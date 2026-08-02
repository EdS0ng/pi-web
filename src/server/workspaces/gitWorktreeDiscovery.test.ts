import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { gitToplevel, parseGitWorktreeList } from "./gitWorktreeDiscovery.js";

const execFileAsync = promisify(execFile);

// Fixtures below are verbatim `git worktree list --porcelain` output captured from real git.
const mainAndLinked = [
  "worktree /repo",
  "HEAD ad580ab86e1eba35a121fa6b9e8be1126aaf18de",
  "branch refs/heads/main",
  "",
  "worktree /repo-worktrees/feature",
  "HEAD ad580ab86e1eba35a121fa6b9e8be1126aaf18de",
  "branch refs/heads/feat/thing",
  "",
].join("\n");

const removedAndLocked = [
  "worktree /repo",
  "HEAD ad580ab86e1eba35a121fa6b9e8be1126aaf18de",
  "branch refs/heads/main",
  "",
  "worktree /repo-worktrees/gone",
  "HEAD ad580ab86e1eba35a121fa6b9e8be1126aaf18de",
  "branch refs/heads/gone",
  "prunable gitdir file points to non-existent location",
  "",
  "worktree /repo-worktrees/kept",
  "HEAD ad580ab86e1eba35a121fa6b9e8be1126aaf18de",
  "branch refs/heads/kept",
  "locked keep me",
  "",
].join("\n");

describe("parseGitWorktreeList", () => {
  it("reads paths and short branch names for the main and linked worktrees", () => {
    expect(parseGitWorktreeList(mainAndLinked)).toEqual([
      { path: "/repo", branch: "main" },
      { path: "/repo-worktrees/feature", branch: "feat/thing" },
    ]);
  });

  it("reports prunable, and leaves a locked worktree looking like the usable checkout it is", () => {
    expect(parseGitWorktreeList(removedAndLocked)).toEqual([
      { path: "/repo", branch: "main" },
      { path: "/repo-worktrees/gone", branch: "gone", prunable: true },
      // `locked` is ignored: a locked worktree is a real checkout and stays a usable
      // workspace, so nothing downstream needs to distinguish it.
      { path: "/repo-worktrees/kept", branch: "kept" },
    ]);

    const bareLocked = ["worktree /repo-worktrees/kept", "HEAD abc", "detached", "locked", ""].join("\n");
    expect(parseGitWorktreeList(bareLocked)).toEqual([{ path: "/repo-worktrees/kept", detached: true }]);
  });

  it("reads bare repositories and ignores chunks without a worktree path", () => {
    const bare = ["worktree /repo.git", "bare", "", "HEAD abc", ""].join("\n");
    expect(parseGitWorktreeList(bare)).toEqual([{ path: "/repo.git", bare: true }]);
  });

  it("returns nothing for empty output", () => {
    expect(parseGitWorktreeList("\n")).toEqual([]);
  });
});

// Real git, because the whole point of gitToplevel is what `rev-parse --show-toplevel` reports
// from a directory that is inside a work tree but is not its root.
describe("gitToplevel", () => {
  const roots: string[] = [];

  async function tempDir(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "pi-web-git-toplevel-"));
    roots.push(root);
    // macOS hands out /var/... symlinks for temp dirs; git reports the resolved path.
    return realpath(root);
  }

  async function initRepo(root: string): Promise<void> {
    await execFileAsync("git", ["-C", root, "init", "-q", "-b", "main"]);
    await writeFile(join(root, "README.md"), "readme");
    await execFileAsync("git", ["-C", root, "add", "-A"]);
    await execFileAsync("git", ["-C", root, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "init"]);
  }

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("returns undefined for a directory that is not inside a work tree", async () => {
    await expect(gitToplevel(await tempDir())).resolves.toBeUndefined();
  });

  it("returns the repo root for the root itself", async () => {
    const root = await tempDir();
    await initRepo(root);

    await expect(gitToplevel(root)).resolves.toBe(root);
  });

  it("returns the enclosing repo root — not the directory — for a nested subdirectory", async () => {
    const root = await tempDir();
    await initRepo(root);
    const nested = join(root, "subproject");
    await mkdir(nested);

    await expect(gitToplevel(nested)).resolves.toBe(root);
  });

  it("returns the nested repo's own root when the subdirectory is itself a repo", async () => {
    const root = await tempDir();
    await initRepo(root);
    const nested = join(root, "inner");
    await mkdir(nested);
    await initRepo(nested);

    await expect(gitToplevel(nested)).resolves.toBe(nested);
  });
});
