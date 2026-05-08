import { describe, expect, it, vi } from "vitest";
import { createAppActions } from "./appActions";
import { initialAppState, type AppState } from "./appState";

function createContext(statePatch: Partial<AppState> = {}) {
  const calls: string[] = [];
  const context = {
    state: { ...initialAppState(), ...statePatch },
    openActionPalette: vi.fn(() => { calls.push("openActionPalette"); }),
    focusPrompt: vi.fn(() => { calls.push("focusPrompt"); }),
    addProject: vi.fn(() => { calls.push("addProject"); }),
    selectMainView: vi.fn((view: AppState["mainView"]) => { calls.push(`selectMainView:${view}`); }),
    refreshFiles: vi.fn(() => { calls.push("refreshFiles"); }),
    refreshGit: vi.fn(() => { calls.push("refreshGit"); }),
    startSession: vi.fn(() => { calls.push("startSession"); }),
    stopActiveWork: vi.fn(() => { calls.push("stopActiveWork"); }),
  };
  return { context, calls };
}

describe("createAppActions", () => {
  it("disables workspace and session actions when no workspace/session is selected", () => {
    const { context } = createContext();
    const actions = createAppActions(context);

    expect(actions.find((action) => action.id === "view.files")?.enabled).toBe(false);
    expect(actions.find((action) => action.id === "session.start")?.enabled).toBe(false);
    expect(actions.find((action) => action.id === "session.stop")?.enabled).toBe(false);
    expect(actions.find((action) => action.id === "actions.show")?.enabled).toBeUndefined();
  });

  it("enables workspace actions when a workspace is selected", () => {
    const { context } = createContext({ selectedWorkspace: testWorkspace() });
    const actions = createAppActions(context);

    expect(actions.find((action) => action.id === "view.files")?.enabled).toBe(true);
    expect(actions.find((action) => action.id === "session.start")?.enabled).toBe(true);
  });

  it("routes refresh current to the active workspace tool", () => {
    const { context, calls } = createContext({
      selectedWorkspace: testWorkspace(),
      workspaceTool: "git",
    });
    const action = createAppActions(context).find((candidate) => candidate.id === "workspace.refresh-current");

    if (action !== undefined) void action.run();

    expect(calls).toEqual(["refreshGit"]);
  });

  it("only enables stop while a session is actively working", () => {
    const selectedSession = testSession();
    const inactive = createAppActions(createContext({ selectedSession }).context);
    const active = createAppActions(createContext({ selectedSession, status: testStatus({ isStreaming: true }) }).context);

    expect(inactive.find((action) => action.id === "session.stop")?.enabled).toBe(false);
    expect(active.find((action) => action.id === "session.stop")?.enabled).toBe(true);
  });
});

function testWorkspace(): AppState["selectedWorkspace"] {
  return { id: "w1", projectId: "p1", path: "/tmp/project", label: "main", isMain: true, isGitWorktree: false };
}

function testSession(): AppState["selectedSession"] {
  return { id: "s1", path: "/tmp/project/.pi/sessions/s1", cwd: "/tmp/project", created: "now", modified: "now", messageCount: 0, firstMessage: "" };
}

function testStatus(patch: Partial<NonNullable<AppState["status"]>> = {}): AppState["status"] {
  return {
    sessionId: "s1",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    ...patch,
  };
}
