import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { Project } from "../types.js";
import { WorkspaceService } from "./workspaceService.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

async function tempDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-web-workspace-"));
  roots.push(root);
  return realpath(root);
}

async function initRepo(root: string): Promise<void> {
  await execFileAsync("git", ["-C", root, "init", "-q", "-b", "main"]);
  await writeFile(join(root, "README.md"), "readme");
  await execFileAsync("git", ["-C", root, "add", "-A"]);
  await execFileAsync("git", ["-C", root, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "init"]);
}

function projectAt(path: string, name: string): Project {
  return { id: "p1", name, path, createdAt: "2026-07-28T00:00:00.000Z" };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("WorkspaceService.list", () => {
  it("returns a single non-git workspace for a plain directory", async () => {
    const root = await tempDir();

    const workspaces = await new WorkspaceService().list(projectAt(root, "plain"));

    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]).toMatchObject({ path: root, label: "plain", isMain: true, isGitRepo: false, isGitWorktree: false });
  });

  it("discovers worktrees when the project is the repo root", async () => {
    const root = await tempDir();
    await initRepo(root);

    const workspaces = await new WorkspaceService().list(projectAt(root, "repo"));

    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]).toMatchObject({ path: root, label: "main", branch: "main", isMain: true, isGitRepo: true, isGitWorktree: true });
  });

  it("keeps a project nested below the repo root scoped to its own directory", async () => {
    const root = await tempDir();
    await initRepo(root);
    const nested = join(root, "subproject");
    await mkdir(nested);

    const workspaces = await new WorkspaceService().list(projectAt(nested, "subproject"));

    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]).toMatchObject({ path: nested, label: "subproject", isMain: true, isGitRepo: true, isGitWorktree: false });
    expect(workspaces[0]?.path).not.toBe(root);
    expect(workspaces[0]?.branch).toBeUndefined();
  });

  it("treats a nested directory with its own repo as its own root", async () => {
    const root = await tempDir();
    await initRepo(root);
    const nested = join(root, "inner");
    await mkdir(nested);
    await initRepo(nested);

    const workspaces = await new WorkspaceService().list(projectAt(nested, "inner"));

    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]).toMatchObject({ path: nested, isMain: true, isGitRepo: true, isGitWorktree: true });
  });
});
