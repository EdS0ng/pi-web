import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { AppState } from "../appState";

export interface PanelCollapseControllerOptions {
  navigationPanelCollapsed?: boolean;
}

export class PanelCollapseController implements ReactiveController {
  navigationPanelCollapsed: boolean;
  // The workspace panel opens as an overlay on demand, so it starts hidden.
  workspacePanelCollapsed = true;

  hostConnected(): void {
    return;
  }

  constructor(private readonly host: ReactiveControllerHost, options: PanelCollapseControllerOptions = {}) {
    host.addController(this);
    this.navigationPanelCollapsed = options.navigationPanelCollapsed ?? false;
  }

  toggleNavigationPanel(): void {
    this.navigationPanelCollapsed = !this.navigationPanelCollapsed;
    this.host.requestUpdate();
  }

  toggleWorkspacePanel(): void {
    this.workspacePanelCollapsed = !this.workspacePanelCollapsed;
    this.host.requestUpdate();
  }

  expandNavigationPanel(): void {
    if (!this.navigationPanelCollapsed) return;
    this.navigationPanelCollapsed = false;
    this.host.requestUpdate();
  }

  expandWorkspacePanel(): void {
    if (!this.workspacePanelCollapsed) return;
    this.workspacePanelCollapsed = false;
    this.host.requestUpdate();
  }

  shellClass(mainView: AppState["mainView"]): string {
    return [
      "shell",
      mainViewClass(mainView),
      ...(this.navigationPanelCollapsed ? ["navigation-panel-collapsed"] : []),
      ...(this.workspacePanelCollapsed ? ["workspace-panel-collapsed"] : []),
    ].join(" ");
  }
}

export function mainViewClass(mainView: AppState["mainView"]): "navigation-view" | "chat-view" | "workspace-view" {
  if (mainView === "navigation") return "navigation-view";
  if (mainView === "chat") return "chat-view";
  return "workspace-view";
}
