import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { FileContentResponse, FileTreeEntry, GitDiffResponse, GitStatusResponse, Workspace } from "../api";
import type { QualifiedContributionId, QualifiedWorkspacePanelContribution, WorkspacePanelContext } from "../plugins/types";
import { workspacePanelStyles } from "./shared";

@customElement("workspace-panel")
export class WorkspacePanel extends LitElement {
  @property({ attribute: false }) workspace: Workspace | undefined;
  @property() tool: QualifiedContributionId = "core:workspace.files";
  @property({ attribute: false }) panels: QualifiedWorkspacePanelContribution[] = [];
  @property({ type: Boolean }) hideToolTabs = false;
  @property({ attribute: false }) fileTree: FileTreeEntry[] = [];
  @property({ attribute: false }) expandedDirs: Record<string, FileTreeEntry[]> = {};
  @property({ attribute: false }) selectedFilePath: string | undefined;
  @property({ attribute: false }) selectedFileContent: FileContentResponse | undefined;
  @property({ type: Boolean }) fileTreeStale = false;
  @property({ attribute: false }) gitStatus: GitStatusResponse | undefined;
  @property({ attribute: false }) selectedDiffPath: string | undefined;
  @property({ attribute: false }) selectedDiff: GitDiffResponse | undefined;
  @property({ attribute: false }) selectedStagedDiff: GitDiffResponse | undefined;
  @property({ type: Boolean }) gitStale = false;
  @property({ attribute: false }) onSelectTool: (tool: QualifiedContributionId) => void = () => undefined;
  @property({ attribute: false }) onRefreshFiles: () => void = () => undefined;
  @property({ attribute: false }) onExpandDir: (path: string) => void = () => undefined;
  @property({ attribute: false }) onSelectFile: (path: string) => void = () => undefined;
  @property({ attribute: false }) onRefreshGit: () => void = () => undefined;
  @property({ attribute: false }) onSelectDiff: (path: string) => void = () => undefined;

  override render() {
    const workspace = this.workspace;
    if (workspace === undefined) return html`<section class="empty">Select a workspace.</section>`;
    const visiblePanels = this.panels.filter((panel) => panel.visible?.(workspace) ?? true);
    const selectedPanel = visiblePanels.find((panel) => panel.id === this.tool) ?? visiblePanels[0];
    return html`
      <header>
        ${this.hideToolTabs ? null : html`
          <div class="tabs">
            ${visiblePanels.map((panel) => html`
              <button class=${selectedPanel?.id === panel.id ? "selected" : ""} @click=${() => { this.onSelectTool(panel.id); }}>${panel.title}</button>
            `)}
          </div>
        `}
        <small title=${workspace.path}>${workspace.label}</small>
      </header>
      ${selectedPanel === undefined ? html`<section class="empty">No workspace panels registered.</section>` : selectedPanel.render(this.createPanelContext(workspace))}
    `;
  }

  private createPanelContext(workspace: Workspace): WorkspacePanelContext {
    return {
      workspace,
      fileTree: this.fileTree,
      expandedDirs: this.expandedDirs,
      selectedFilePath: this.selectedFilePath,
      selectedFileContent: this.selectedFileContent,
      fileTreeStale: this.fileTreeStale,
      gitStatus: this.gitStatus,
      selectedDiffPath: this.selectedDiffPath,
      selectedDiff: this.selectedDiff,
      selectedStagedDiff: this.selectedStagedDiff,
      gitStale: this.gitStale,
      onRefreshFiles: this.onRefreshFiles,
      onExpandDir: this.onExpandDir,
      onSelectFile: this.onSelectFile,
      onRefreshGit: this.onRefreshGit,
      onSelectDiff: this.onSelectDiff,
    };
  }

  static override styles = workspacePanelStyles;
}
