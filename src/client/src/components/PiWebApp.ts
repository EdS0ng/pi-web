import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api, type Project, type SessionInfo, type Workspace } from "../api";
import { readRoute, writeRoute } from "../route";
import { SessionSocket, type SessionUiEvent } from "../sessionSocket";
import "./ProjectList";
import "./WorkspaceList";
import "./SessionList";
import "./ChatView";
import "./Composer";
import { normalizeMessages, appendText, textMessage } from "../chatMessages";
import { appStyles, type ChatLine } from "./shared";

@customElement("pi-web-poc")
export class PiWebApp extends LitElement {
  @state() private projects: Project[] = [];
  @state() private workspaces: Workspace[] = [];
  @state() private sessions: SessionInfo[] = [];
  @state() private messages: ChatLine[] = [];
  @state() private selectedProject?: Project;
  @state() private selectedWorkspace?: Workspace;
  @state() private selectedSession?: SessionInfo;
  @state() private error = "";

  private readonly socket = new SessionSocket();
  private readonly onPopState = () => void this.restoreRoute(false);

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("popstate", this.onPopState);
    void this.loadProjects();
  }

  disconnectedCallback(): void {
    window.removeEventListener("popstate", this.onPopState);
    this.socket.close();
    super.disconnectedCallback();
  }

  private async loadProjects() {
    this.error = "";
    try {
      this.projects = await api.projects();
      await this.restoreRoute(false);
    } catch (error) {
      this.error = String(error);
    }
  }

  private async addProject() {
    const path = prompt("Project folder path");
    if (!path) return;
    try {
      const project = await api.addProject(path);
      this.projects = [...this.projects.filter((p) => p.id !== project.id), project];
      await this.selectProject(project);
    } catch (error) {
      this.error = String(error);
    }
  }

  private async selectProject(project: Project, target?: { workspaceId?: string; sessionId?: string; updateUrl?: boolean }) {
    this.selectedProject = project;
    this.selectedWorkspace = undefined;
    this.selectedSession = undefined;
    this.sessions = [];
    this.messages = [];
    this.socket.close();
    try {
      this.workspaces = await api.workspaces(project.id);
      const workspace = target?.workspaceId ? this.workspaces.find((w) => w.id === target.workspaceId) : this.workspaces[0];
      if (workspace) await this.selectWorkspace(workspace, { sessionId: target?.sessionId, updateUrl: target?.updateUrl });
      else if (target?.updateUrl !== false) this.updateUrl();
    } catch (error) {
      this.error = String(error);
    }
  }

  private async selectWorkspace(workspace: Workspace, target?: { sessionId?: string; updateUrl?: boolean }) {
    this.selectedWorkspace = workspace;
    this.selectedSession = undefined;
    this.messages = [];
    this.socket.close();
    try {
      this.sessions = await api.sessions(workspace.path);
      const sessionId = target?.sessionId;
      const session = sessionId ? this.sessions.find((s) => s.id === sessionId || s.id.startsWith(sessionId)) : undefined;
      if (session) await this.selectSession(session, { updateUrl: target?.updateUrl });
      else if (target?.updateUrl !== false) this.updateUrl();
    } catch (error) {
      this.error = String(error);
    }
  }

  private async startSession() {
    if (!this.selectedWorkspace) return;
    try {
      const session = await api.startSession(this.selectedWorkspace.path);
      this.sessions = [session, ...this.sessions];
      await this.selectSession(session);
    } catch (error) {
      this.error = String(error);
    }
  }

  private async selectSession(session: SessionInfo, options?: { updateUrl?: boolean }) {
    this.selectedSession = session;
    this.socket.close();
    this.messages = normalizeMessages(await api.messages(session.id));
    this.socket.connect(session.id, (event) => this.applyEvent(event));
    if (options?.updateUrl !== false) this.updateUrl();
  }

  private applyEvent(event: SessionUiEvent) {
    if (event.type === "assistant.delta") {
      this.messages = appendText(this.messages, "assistant", event.text);
    } else if (event.type === "tool.start") {
      this.messages = [...this.messages, { role: "tool", parts: [{ type: "toolCall", toolName: event.toolName, summary: "" }] }];
    } else if (event.type === "tool.end") {
      this.messages = [...this.messages, textMessage("tool", `${event.isError ? "✖" : "✓"} ${event.toolName}`)];
    } else if (event.type === "session.error") {
      this.messages = [...this.messages, textMessage("system", event.message)];
    }
  }

  private async send(text: string) {
    if (!this.selectedSession) return;
    this.messages = [...this.messages, textMessage("user", text)];
    try {
      await api.prompt(this.selectedSession.id, text);
    } catch (error) {
      this.error = String(error);
    }
  }

  private async closeSession() {
    if (!this.selectedSession) return;
    await api.close(this.selectedSession.id);
    this.selectedSession = undefined;
    this.socket.close();
    this.messages = [];
    this.updateUrl();
  }

  private async restoreRoute(updateUrl: boolean) {
    const route = readRoute();
    if (!route.projectId) return;
    const project = this.projects.find((p) => p.id === route.projectId);
    if (!project) return;
    await this.selectProject(project, { workspaceId: route.workspaceId, sessionId: route.sessionId, updateUrl });
  }

  private updateUrl() {
    writeRoute({ projectId: this.selectedProject?.id, workspaceId: this.selectedWorkspace?.id, sessionId: this.selectedSession?.id });
  }

  render() {
    return html`
      <div class="shell">
        <aside>
          <header>
            <strong>Pi Web POC</strong>
            <button @click=${this.addProject}>+ Project</button>
          </header>
          <project-list .projects=${this.projects} .selected=${this.selectedProject} .onSelect=${(project: Project) => this.selectProject(project)}></project-list>
          <workspace-list .workspaces=${this.workspaces} .selected=${this.selectedWorkspace} .onSelect=${(workspace: Workspace) => this.selectWorkspace(workspace)}></workspace-list>
          <session-list .sessions=${this.sessions} .selected=${this.selectedSession} .canStart=${!!this.selectedWorkspace} .onStart=${() => this.startSession()} .onSelect=${(session: SessionInfo) => this.selectSession(session)}></session-list>
        </aside>
        <main>
          ${this.error ? html`<div class="error">${this.error}</div>` : null}
          ${this.selectedSession ? html`
            <chat-view .messages=${this.messages}></chat-view>
            <chat-composer .onSend=${(text: string) => this.send(text)} .onCloseSession=${() => this.closeSession()}></chat-composer>
          ` : html`<div class="empty">Select or start a session.</div>`}
        </main>
      </div>
    `;
  }

  static styles = appStyles;
}
