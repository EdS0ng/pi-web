import type { AppState } from "../../appState";
import type { SessionUiEvent } from "../../sessionSocket";
import type { ForkRegistry } from "./registryExtensions";

/**
 * Layer 1 dispatcher: fan a single raw session event out to every registered
 * fork event listener. A throwing listener is isolated — it never breaks the
 * stream or starves the other listeners — because the tap is a strictly
 * read-only side channel.
 */
export function dispatchSessionEvent(registry: ForkRegistry, event: SessionUiEvent, state: AppState, isCatchup: boolean): void {
  for (const listener of registry.getSessionEventListeners()) {
    try {
      listener.onEvent(event, { state, isCatchup });
    } catch (error) {
      console.warn("pi-web: plugin session event listener failed", error);
    }
  }
}
