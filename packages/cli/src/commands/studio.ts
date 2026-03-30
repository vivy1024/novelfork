import { Command } from "commander";
import { findProjectRoot, log, logError } from "../utils.js";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { access } from "node:fs/promises";

export interface StudioLaunchSpec {
  readonly studioEntry: string;
  readonly command: "npx" | "node";
  readonly args: string[];
}

async function firstAccessiblePath(paths: readonly string[]): Promise<string | undefined> {
  for (const path of paths) {
    try {
      await access(path);
      return path;
    } catch {
      // continue
    }
  }
  return undefined;
}

export async function resolveStudioLaunch(root: string): Promise<StudioLaunchSpec | null> {
  const sourceEntry = await firstAccessiblePath([
    join(root, "packages", "studio", "src", "api", "index.ts"),
    join(root, "..", "packages", "studio", "src", "api", "index.ts"),
    join(root, "..", "studio", "src", "api", "index.ts"),
  ]);
  if (sourceEntry) {
    return {
      studioEntry: sourceEntry,
      command: "npx",
      args: ["tsx", sourceEntry, root],
    };
  }

  const builtEntry = await firstAccessiblePath([
    join(root, "node_modules", "@actalk", "inkos-studio", "dist", "api", "index.js"),
    join(root, "node_modules", "@actalk", "inkos-studio", "server.cjs"),
  ]);
  if (builtEntry) {
    return {
      studioEntry: builtEntry,
      command: "node",
      args: [builtEntry, root],
    };
  }

  return null;
}

export const studioCommand = new Command("studio")
  .description("Start InkOS Studio web workbench")
  .option("-p, --port <port>", "Server port", "4567")
  .action(async (opts) => {
    const root = findProjectRoot();
    const port = opts.port;
    const launch = await resolveStudioLaunch(root);

    if (!launch) {
      logError(
        "InkOS Studio not found. If you cloned the repo, run:\n" +
        "  cd packages/studio && pnpm install && pnpm build\n" +
        "Then run 'inkos studio' from the project root.",
      );
      process.exit(1);
    }

    log(`Starting InkOS Studio on http://localhost:${port}`);

    const child = spawn(launch.command, launch.args, {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, INKOS_STUDIO_PORT: port },
    });

    child.on("error", (e) => {
      logError(`Failed to start studio: ${e.message}`);
      process.exit(1);
    });

    child.on("exit", (code) => {
      process.exit(code ?? 0);
    });
  });
