import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { ProjectService } from "./projects/projectService.js";
import { ProjectStore } from "./storage/projectStore.js";
import { WorkspaceService } from "./workspaces/workspaceService.js";
import type { Project, Workspace } from "./types.js";

let app: FastifyInstance;
let tempDir: string;
let projectDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pi-web-app-test-"));
  projectDir = join(tempDir, "project");
  app = await buildApp({
    projects: new ProjectService(new ProjectStore(join(tempDir, "projects.json"))),
    workspaces: new WorkspaceService(),
    clientDist: false,
    logger: false,
  });
});

afterEach(async () => {
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("buildApp", () => {
  it("adds, lists, and closes projects through the HTTP contract", async () => {
    const addResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "Example", path: projectDir, create: true },
    });

    expect(addResponse.statusCode).toBe(200);
    const project = addResponse.json<Project>();
    expect(project).toMatchObject({ name: "Example", path: projectDir });
    expect(project.id).not.toBe("");

    const listResponse = await app.inject({ method: "GET", url: "/api/projects" });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json<Project[]>()).toEqual([project]);

    const closeResponse = await app.inject({ method: "DELETE", url: `/api/projects/${project.id}` });
    expect(closeResponse.statusCode).toBe(200);
    expect(closeResponse.json()).toEqual({ closed: true });

    const emptyListResponse = await app.inject({ method: "GET", url: "/api/projects" });
    expect(emptyListResponse.json<Project[]>()).toEqual([]);
  });

  it("returns stable errors for invalid project requests", async () => {
    const addResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "Missing", path: join(tempDir, "missing") },
    });

    expect(addResponse.statusCode).toBe(400);
    expect(addResponse.json()).toHaveProperty("error");

    const closeResponse = await app.inject({ method: "DELETE", url: "/api/projects/does-not-exist" });
    expect(closeResponse.statusCode).toBe(404);
    expect(closeResponse.json()).toEqual({ error: "Project not found" });
  });

  it("lists a non-git project as a single workspace", async () => {
    const addResponse = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "Plain", path: projectDir, create: true },
    });
    const project = addResponse.json<Project>();

    const workspacesResponse = await app.inject({ method: "GET", url: `/api/projects/${project.id}/workspaces` });

    expect(workspacesResponse.statusCode).toBe(200);
    expect(workspacesResponse.json<Workspace[]>()).toEqual([
      expect.objectContaining({
        projectId: project.id,
        path: projectDir,
        label: "Plain",
        isMain: true,
        isGitRepo: false,
        isGitWorktree: false,
      }),
    ]);
  });
});
