import { css } from "lit";

/**
 * Fork-owned styles appended to `PiWebApp.styles`. Kept in a separate module so
 * the upstream `shared.ts` stylesheet stays byte-identical and merges cleanly.
 * These rules place fork region hosts within the existing shell grid: a main
 * widget fills the conversation column (replacing chat), and nav widgets stack
 * below the built-in navigation panel in the left aside.
 */
export const forkStyles = css`
  main > region-host { flex: 1 1 auto; min-height: 0; overflow: hidden; }
  aside > region-host.fork-nav-region { flex: 0 0 auto; min-height: 0; max-height: 45%; border-top: 1px solid var(--pi-border); overflow: hidden; }

  /* Layer 3 — full-viewport page grid. <page-host> renders into the light DOM, so
     these rules (scoped to PiWebApp's shadow tree) reach its grid and cells. Each
     cell is a flex column so the conversation widget lays out exactly as it does
     inside the shell's <main>. */
  page-host { display: block; height: 100%; min-height: 0; overflow: hidden; }
  page-host .page-grid { display: grid; width: 100%; height: 100%; min-height: 0; }
  page-host .page-cell { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: auto; }

  /* A page replaces the whole shell. The wrapper is a flex column so the generic
     error banner takes its intrinsic height and <page-host> flexes to fill the
     rest; the exit control floats over the page for touch layouts. */
  .fork-page { display: flex; flex-direction: column; position: relative; height: 100%; min-height: 0; overflow: hidden; }
  .fork-page > page-host { flex: 1 1 auto; height: auto; }
  .fork-page-exit { position: absolute; top: 8px; right: 8px; z-index: 10; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; border: 1px solid var(--pi-border); border-radius: 6px; background: var(--pi-surface); color: var(--pi-text); cursor: pointer; }
`;
