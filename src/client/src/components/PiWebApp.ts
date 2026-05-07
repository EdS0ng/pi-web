import { LitElement, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import type { Project, SessionInfo, Workspace } from "../api";
import { initialAppState, type AppState } from "../appState";
import { ProjectController } from "../controllers/projectController";
import { SessionController } from "../controllers/sessionController";
import { WorkspaceController } from "../controllers/workspaceController";
import { readRoute, writeRoute } from "../route";
import "./ProjectList";
import "./WorkspaceList";
import "./SessionList";
import "./ChatView";
import type { ChatView } from "./ChatView";
import "./PromptEditor";
import type { PromptEditor } from "./PromptEditor";
import "./StatusBar";
import "./CommandPicker";
import { appStyles } from "./shared";

@customElement("pi-web-poc")
export class PiWebApp extends LitElement {
  @state() private state: AppState = initialAppState();
  @query("chat-view") private chatView?: ChatView;
  @query("prompt-editor") private promptEditor?: PromptEditor;

  private readonly sessions = new SessionController(
    () => this.state,
    (patch) => { this.setState(patch); },
    () => { this.updateUrl(); },
  );
  private readonly workspaces = new WorkspaceController(
    () => this.state,
    (patch) => { this.setState(patch); },
    () => { this.updateUrl(); },
    this.sessions,
  );
  private readonly projects = new ProjectController(
    () => this.state,
    (patch) => { this.setState(patch); },
    this.workspaces,
  );
  private readonly onPopState = () => void this.withChatScrollTransition(() => this.restoreRoute(false));

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("popstate", this.onPopState);
    this.sessions.connectStatusUpdates();
    void this.loadProjectsAndRestoreRoute();
  }

  override disconnectedCallback(): void {
    window.removeEventListener("popstate", this.onPopState);
    this.sessions.dispose();
    super.disconnectedCallback();
  }

  private setState(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch };
  }

  private async loadProjectsAndRestoreRoute() {
    await this.projects.loadProjects();
    await this.withChatScrollTransition(() => this.restoreRoute(false));
  }

  private async restoreRoute(updateUrl: boolean) {
    const route = readRoute();
    if (route.projectId === undefined || route.projectId === "") return;
    const project = this.state.projects.find((p) => p.id === route.projectId);
    if (!project) return;
    await this.workspaces.selectProject(project, { workspaceId: route.workspaceId, sessionId: route.sessionId, updateUrl });
  }

  private async withChatScrollTransition(action: () => Promise<void>) {
    this.chatView?.saveScrollPosition();
    await action();
    await this.updateComplete;
    await this.chatView?.updateComplete;
    await nextFrame();
    this.chatView?.restoreScrollPosition();
    this.promptEditor?.focusInput();
  }

  private async withChatPrependTransition(action: () => Promise<void>) {
    const anchor = this.chatView?.capturePrependScrollAnchor();
    await action();
    await this.updateComplete;
    await this.chatView?.updateComplete;
    await nextFrame();
    this.chatView?.restorePrependScrollAnchor(anchor);
  }

  private updateUrl() {
    writeRoute({
      projectId: this.state.selectedProject?.id,
      workspaceId: this.state.selectedWorkspace?.id,
      sessionId: this.state.selectedSession?.id,
    });
  }

  override render() {
    const state = this.state;
    return html`
      <div class="shell">
        <aside>
          <header>
            <strong>Pi Web POC</strong>
            <button @click=${() => this.projects.addProject()}>+ Project</button>
          </header>
          <project-list .projects=${state.projects} .selected=${state.selectedProject} .onSelect=${(project: Project) => this.withChatScrollTransition(() => this.workspaces.selectProject(project))}></project-list>
          <workspace-list .workspaces=${state.workspaces} .selected=${state.selectedWorkspace} .onSelect=${(workspace: Workspace) => this.withChatScrollTransition(() => this.workspaces.selectWorkspace(workspace))}></workspace-list>
          <session-list .sessions=${state.sessions} .statuses=${state.sessionStatuses} .activities=${state.sessionActivities} .selected=${state.selectedSession} .canStart=${!!state.selectedWorkspace} .onStart=${() => this.withChatScrollTransition(() => this.sessions.startSession())} .onSelect=${(session: SessionInfo) => this.withChatScrollTransition(() => this.sessions.selectSession(session))}></session-list>
        </aside>
        <main>
          ${state.error ? html`<div class="error">${state.error}</div>` : null}
          ${state.selectedSession ? html`
            <chat-view .sessionId=${state.selectedSession.id} .messages=${state.messages} .messageStart=${state.messagePageStart} .messageTotal=${state.messagePageTotal} .hasMore=${state.messagePageStart > 0} .loadingMore=${state.isLoadingEarlierMessages} .isCompacting=${state.status?.isCompacting === true} .pendingMessageCount=${state.status?.pendingMessageCount ?? 0} .onLoadMore=${() => this.withChatPrependTransition(() => this.sessions.loadEarlierMessages())}></chat-view>
            <prompt-editor .sessionId=${state.selectedSession.id} .cwd=${state.selectedWorkspace?.path} .canSteer=${state.status?.isStreaming === true} .isCompacting=${state.status?.isCompacting === true} .onSend=${(text: string, streamingBehavior?: "steer" | "followUp") => this.sessions.send(text, streamingBehavior)} .onStopSession=${() => this.sessions.stopSession()}></prompt-editor>
            <status-bar .status=${state.status} .activity=${state.activity} .workspace=${state.selectedWorkspace}></status-bar>
            ${state.commandDialog !== undefined ? html`<command-picker .title=${state.commandDialog.title} .options=${state.commandDialog.options} .onPick=${(value: string) => this.sessions.respondToCommand(state.commandDialog?.requestId ?? "", value)} .onCancel=${() => { this.sessions.cancelCommand(); }}></command-picker>` : null}
          ` : html`<div class="empty">Select or start a session.</div>`}
        </main>
      </div>
    `;
  }

  static override styles = appStyles;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => { resolve(); }));
}
