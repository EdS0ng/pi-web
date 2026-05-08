import type { CommandResult, FileContentResponse, FileTreeEntry, GitDiffResponse, GitStatusResponse, Project, SessionActivity, SessionInfo, SessionStatus, Workspace } from "./api";
import type { ChatLine } from "./components/shared";

export interface AppState {
  projects: Project[];
  workspaces: Workspace[];
  sessions: SessionInfo[];
  messages: ChatLine[];
  messagePageStart: number;
  messagePageTotal: number;
  isLoadingEarlierMessages: boolean;
  selectedProject: Project | undefined;
  selectedWorkspace: Workspace | undefined;
  selectedSession: SessionInfo | undefined;
  status: SessionStatus | undefined;
  activity: SessionActivity | undefined;
  sessionStatuses: Record<string, SessionStatus>;
  sessionActivities: Record<string, SessionActivity>;
  commandDialog: Extract<CommandResult, { type: "select" }> | undefined;
  actionPaletteOpen: boolean;
  workspaceTool: "files" | "git";
  mainView: "chat" | "files" | "git";
  fileTree: FileTreeEntry[];
  expandedDirs: Record<string, FileTreeEntry[]>;
  selectedFilePath: string | undefined;
  selectedFileContent: FileContentResponse | undefined;
  fileTreeStale: boolean;
  gitStatus: GitStatusResponse | undefined;
  selectedDiffPath: string | undefined;
  selectedDiff: GitDiffResponse | undefined;
  gitStale: boolean;
  error: string;
}

export function initialAppState(): AppState {
  return {
    projects: [],
    workspaces: [],
    sessions: [],
    messages: [],
    messagePageStart: 0,
    messagePageTotal: 0,
    isLoadingEarlierMessages: false,
    selectedProject: undefined,
    selectedWorkspace: undefined,
    selectedSession: undefined,
    status: undefined,
    activity: undefined,
    sessionStatuses: {},
    sessionActivities: {},
    commandDialog: undefined,
    actionPaletteOpen: false,
    workspaceTool: "files",
    mainView: "chat",
    fileTree: [],
    expandedDirs: {},
    selectedFilePath: undefined,
    selectedFileContent: undefined,
    fileTreeStale: false,
    gitStatus: undefined,
    selectedDiffPath: undefined,
    selectedDiff: undefined,
    gitStale: false,
    error: "",
  };
}
