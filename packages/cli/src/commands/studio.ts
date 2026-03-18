import { Command } from "commander";
import { findProjectRoot, log, logError } from "../utils.js";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { access } from "node:fs/promises";

export const studioCommand = new Command("studio")
  .description("Start InkOS Studio web workbench")
  .option("-p, --port <port>", "Server port", "4567")
  .action(async (opts) => {
    const root = findProjectRoot();
    const port = opts.port;

    // Look for studio's built server entry
    const studioPaths = [
      join(root, "node_modules", "@actalk", "inkos-studio", "dist", "api", "index.js"),
      join(root, "..", "studio", "src", "api", "index.ts"),
    ];

    // Try to find tsx or ts-node for running TypeScript
    // In dev (monorepo), run studio's TS source directly via tsx
    const studioDir = join(root, "..", "studio");
    let studioEntry: string | undefined;

    try {
      await access(join(studioDir, "src", "api", "index.ts"));
      studioEntry = join(studioDir, "src", "api", "index.ts");
    } catch {
      // Not in monorepo — look for built JS
      for (const p of studioPaths) {
        try {
          await access(p);
          studioEntry = p;
          break;
        } catch {
          // continue
        }
      }
    }

    if (!studioEntry) {
      logError(
        "InkOS Studio not found. If you cloned the repo, run:\n" +
        "  cd packages/studio && pnpm install && pnpm build\n" +
        "Then run 'inkos studio' from the project root.",
      );
      process.exit(1);
    }

    log(`Starting InkOS Studio on http://localhost:${port}`);

    const child = spawn("npx", ["tsx", studioEntry], {
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
