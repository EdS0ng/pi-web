import { describe, expect, it, vi } from "vitest";
import type { Project } from "../types.js";
import type { GitWorktreeInfo } from "./gitWorktreeDiscovery.js";
import { WorkspaceService, type WorkspaceGitPort } from "./workspaceService.js";

const project: Project = {
  id: "p1",
  name: "Project",
  path: "/repo",
  createdAt: "2026-05-25T00:00:00.000Z",
};

/** Defaults describe the ordinary case: a git project sitting at its own repo root. */
function serviceFor(worktrees: GitWorktreeInfo[], isGitRepo = true, toplevel: string | undefined = project.path): { service: WorkspaceService; discoverGitWorktrees: ReturnType<typeof vi.fn> } {
  const discoverGitWorktrees = vi.fn(() => Promise.resolve(worktrees));
  const git: WorkspaceGitPort = {
    isGitRepository: () => Promise.resolve(isGitRepo),
    gitToplevel: () => Promise.resolve(toplevel),
    discoverGitWorktrees,
  };
  return { service: new WorkspaceService(git), discoverGitWorktrees };
}

describe("WorkspaceService.list", () => {
  it("hides a linked worktree whose checkout directory was removed outside PI WEB", async () => {
    const { service } = serviceFor([
      { path: "/repo", branch: "main" },
      { path: "/repo-worktrees/gone", branch: "gone", prunable: true },
      { path: "/repo-worktrees/live", branch: "live" },
    ]);

    const workspaces = await service.list(project);

    expect(workspaces.map((workspace) => workspace.path)).toEqual(["/repo", "/repo-worktrees/live"]);
  });

  it("keeps a worktree that is present but not prunable, such as a locked one", async () => {
    const { service } = serviceFor([
      { path: "/repo", branch: "main" },
      { path: "/repo-worktrees/kept", branch: "kept" },
    ]);

    const workspaces = await service.list(project);

    expect(workspaces.map((workspace) => workspace.path)).toEqual(["/repo", "/repo-worktrees/kept"]);
  });

  it("keeps the project's own worktree even if git marks it prunable, so a project is never empty", async () => {
    const { service } = serviceFor([{ path: "/repo", branch: "main", prunable: true }]);

    const workspaces = await service.list(project);

    expect(workspaces).toEqual([expect.objectContaining({ path: "/repo", label: "main", isMain: true, isGitWorktree: true })]);
  });

  it("falls back to the project itself when every linked worktree is filtered away", async () => {
    const { service } = serviceFor([{ path: "/repo-worktrees/gone", branch: "gone", prunable: true }]);

    const workspaces = await service.list(project);

    expect(workspaces).toEqual([expect.objectContaining({ path: "/repo", label: "Project", isMain: true, isGitRepo: true, isGitWorktree: false })]);
  });

  it("labels detached and unnamed worktrees without inventing a branch", async () => {
    const { service } = serviceFor([
      { path: "/repo", branch: "main" },
      { path: "/repo-worktrees/detached", detached: true },
    ]);

    const workspaces = await service.list(project);

    expect(workspaces.map((workspace) => ({ label: workspace.label, branch: workspace.branch }))).toEqual([
      { label: "main", branch: "main" },
      { label: "detached", branch: undefined },
    ]);
  });

  it("returns a single non-git workspace when the project is not a repository", async () => {
    const { service } = serviceFor([], false);

    expect(await service.list(project)).toEqual([expect.objectContaining({ path: "/repo", isGitRepo: false, isGitWorktree: false })]);
  });

  // `git worktree list` always reports the enclosing repo root, so a project registered below that
  // root would otherwise take the root as its workspace path — widening session cwd, terminal cwd,
  // the file tree root, git scope and the path-access boundary to the parent folder.
  it("scopes a project nested below the repo root to its own directory", async () => {
    const { service, discoverGitWorktrees } = serviceFor([{ path: "/enclosing-repo", branch: "main" }], true, "/enclosing-repo");

    const workspaces = await service.list(project);

    expect(workspaces).toEqual([expect.objectContaining({ path: "/repo", label: "Project", isMain: true, isGitRepo: true, isGitWorktree: false })]);
    expect(workspaces[0]?.branch).toBeUndefined();
    expect(discoverGitWorktrees).not.toHaveBeenCalled();
  });

  it("treats a nested directory with its own repo as its own root", async () => {
    const { service, discoverGitWorktrees } = serviceFor([{ path: "/repo", branch: "inner" }], true, "/repo");

    const workspaces = await service.list(project);

    expect(workspaces).toEqual([expect.objectContaining({ path: "/repo", label: "inner", isMain: true, isGitRepo: true, isGitWorktree: true })]);
    expect(discoverGitWorktrees).toHaveBeenCalled();
  });

  it("compares the toplevel tolerantly, so a trailing separator does not look nested", async () => {
    const { service, discoverGitWorktrees } = serviceFor([{ path: "/repo", branch: "main" }], true, "/repo/");

    expect(await service.list(project)).toEqual([expect.objectContaining({ path: "/repo", isGitWorktree: true })]);
    expect(discoverGitWorktrees).toHaveBeenCalled();
  });
});
