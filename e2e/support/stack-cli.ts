#!/usr/bin/env -S npx tsx
/**
 * Boots a persistent isolated PI WEB stack for manual browsing or dev-loop UI
 * verification (npm run e2e:stack). Prints the URLs and seeded ids, then waits
 * for Ctrl+C to tear everything down.
 */
import { startPiWebStack } from "./stack";

interface CliArgs {
  keepTemp?: boolean;
  project?: "fixture" | "clone";
}

const args = parseArgs(process.argv.slice(2));
const project = args.project ?? "fixture";
const keepTemp = args.keepTemp === true;

console.log(`Starting isolated PI WEB stack (${project} project)…`);
const stack = await startPiWebStack({ project, keepTemp });

const shutdown = (exitCode: number): void => {
  console.log("\nShutting down…");
  void stack.dispose().finally(() => process.exit(exitCode));
};
process.once("SIGINT", () => { shutdown(130); });
process.once("SIGTERM", () => { shutdown(143); });

console.log(`
PI WEB stack ready
  app:          ${stack.baseUrl}
  api:          ${stack.apiUrl}
  temp root:    ${stack.tempRoot}
  logs:         ${stack.tempRoot}/logs (sessiond.log, api.log, vite.log)
  project:      ${stack.projectDir} (id: ${stack.projectId}, workspace: ${stack.workspaceId})
  demo session: ${stack.demoSessionId}${project === "fixture" ? `\n  scratch session: ${stack.scratchSessionId}` : ""}

  demo session URL:
  ${stack.appUrl({ session: stack.demoSessionId, view: "chat" })}

Press Ctrl+C to stop${keepTemp ? " (temp dir is kept)" : " and clean up the temp dir"}.`);

// Keep the process alive until a signal arrives.
await new Promise<never>(() => undefined);

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--help" || arg === "-h") {
      console.log("Usage: npm run e2e:stack -- [--project fixture|clone] [--keep-temp]\n\nBoots an isolated PI WEB stack (sessiond + API + Vite) and waits for Ctrl+C.");
      process.exit(0);
    }
    if (arg === "--keep-temp") {
      parsed.keepTemp = true;
      continue;
    }
    if (arg === "--project") {
      parsed.project = parseProject(argv[++i]);
      continue;
    }
    if (arg.startsWith("--project=")) {
      parsed.project = parseProject(arg.slice("--project=".length));
      continue;
    }
    console.error(`Unknown argument: ${arg}`);
    process.exit(1);
  }
  return parsed;
}

function parseProject(value: string | undefined): "fixture" | "clone" {
  if (value === "fixture" || value === "clone") return value;
  console.error(`--project must be "fixture" or "clone", got: ${value ?? "(missing)"}`);
  process.exit(1);
}
