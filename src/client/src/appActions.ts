import type { AppAction } from "./actions";
import type { AppState } from "./appState";

export interface AppActionContext {
  state: AppState;
  openActionPalette: () => void;
  focusPrompt: () => void;
  addProject: () => void | Promise<void>;
  selectMainView: (view: AppState["mainView"]) => void;
  refreshFiles: () => void | Promise<void>;
  refreshGit: () => void | Promise<void>;
  startSession: () => void | Promise<void>;
  stopActiveWork: () => void | Promise<void>;
}

export function createAppActions(context: AppActionContext): AppAction[] {
  const hasWorkspace = context.state.selectedWorkspace !== undefined;
  const hasSession = context.state.selectedSession !== undefined;
  const isBusy = isActive(context.state.status);
  return [
    {
      id: "actions.show",
      title: "Show Actions",
      description: "Open the command palette",
      shortcut: "mod+k",
      group: "General",
      run: context.openActionPalette,
    },
    {
      id: "prompt.focus",
      title: "Focus Prompt",
      description: "Move keyboard focus to the message composer",
      group: "General",
      enabled: hasSession,
      run: context.focusPrompt,
    },
    {
      id: "project.add",
      title: "Add Project",
      group: "Project",
      run: context.addProject,
    },
    {
      id: "view.chat",
      title: "Go to Chat",
      shortcut: "mod+1",
      group: "Navigation",
      run: () => { context.selectMainView("chat"); },
    },
    {
      id: "view.files",
      title: "Go to Files",
      shortcut: "mod+2",
      group: "Navigation",
      enabled: hasWorkspace,
      run: () => { context.selectMainView("files"); },
    },
    {
      id: "view.git",
      title: "Go to Git",
      shortcut: "mod+3",
      group: "Navigation",
      enabled: hasWorkspace,
      run: () => { context.selectMainView("git"); },
    },
    {
      id: "workspace.refresh-files",
      title: "Refresh Files",
      shortcut: "mod+shift+f",
      group: "Workspace",
      enabled: hasWorkspace,
      run: context.refreshFiles,
    },
    {
      id: "workspace.refresh-git",
      title: "Refresh Git",
      shortcut: "mod+shift+g",
      group: "Workspace",
      enabled: hasWorkspace,
      run: context.refreshGit,
    },
    {
      id: "workspace.refresh-current",
      title: "Refresh Current Panel",
      shortcut: "mod+shift+r",
      group: "Workspace",
      enabled: hasWorkspace,
      run: () => context.state.workspaceTool === "git" ? context.refreshGit() : context.refreshFiles(),
    },
    {
      id: "session.start",
      title: "Start Session",
      shortcut: "mod+enter",
      group: "Session",
      enabled: hasWorkspace,
      run: context.startSession,
    },
    {
      id: "session.stop",
      title: "Stop Active Work",
      shortcut: "mod+.",
      group: "Session",
      enabled: hasSession && isBusy,
      run: context.stopActiveWork,
    },
  ];
}

function isActive(status: AppState["status"]): boolean {
  return status?.isStreaming === true || status?.isBashRunning === true || status?.isCompacting === true;
}
