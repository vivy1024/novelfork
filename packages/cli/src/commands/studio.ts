import { Command } from "commander";
import { findProjectRoot, log, logError } from "../utils.js";
import { openExternalUrl, resolveBrowserLaunch } from "../open-external-url.js";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export { resolveBrowserLaunch };

export interface StudioLaunchSpec {
  readonly studioEntry: string;
  readonly command: string;
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

const cliPackageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function resolveStudioLaunch(root: string): Promise<StudioLaunchSpec | null> {
  const bunMainEntry = await firstAccessiblePath([
    join(root, "main.ts"),
    join(root, "..", "main.ts"),
  ]);
  if (bunMainEntry) {
    return {
      studioEntry: bunMainEntry,
      command: "bun",
      args: ["run", bunMainEntry, `--root=${root}`],
    };
  }

  const sourceEntry = await firstAccessiblePath([
    join(root, "..", "packages", "studio", "src", "api", "index.ts"),
    join(root, "packages", "studio", "src", "api", "index.ts"),
    join(root, "..", "studio", "src", "api", "index.ts"),
  ]);
  if (sourceEntry) {
    const studioPackageRoot = dirname(dirname(dirname(sourceEntry)));
    const localTsxLoader = await firstAccessiblePath([
      join(studioPackageRoot, "node_modules", "tsx", "dist", "loader.mjs"),
    ]);
    if (localTsxLoader) {
      return {
        studioEntry: sourceEntry,
        command: "node",
        args: ["--import", localTsxLoader, sourceEntry, root],
      };
    }

    const localTsx = await firstAccessiblePath([
      join(studioPackageRoot, "node_modules", ".bin", "tsx"),
    ]);
    if (localTsx) {
      return {
        studioEntry: sourceEntry,
        command: localTsx,
        args: [sourceEntry, root],
      };
    }
    return {
      studioEntry: sourceEntry,
      command: "npx",
      args: ["tsx", sourceEntry, root],
    };
  }

  const builtEntry = await firstAccessiblePath([
    join(root, "node_modules", "@vivy1024", "novelfork-studio", "dist", "api", "index.js"),
    join(root, "node_modules", "@vivy1024", "novelfork-studio", "server.cjs"),
    join(cliPackageRoot, "node_modules", "@vivy1024", "novelfork-studio", "dist", "api", "index.js"),
    join(cliPackageRoot, "node_modules", "@vivy1024", "novelfork-studio", "server.cjs"),
    resolve(cliPackageRoot, "..", "novelfork-studio", "dist", "api", "index.js"),
    resolve(cliPackageRoot, "..", "novelfork-studio", "server.cjs"),
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
  .description("Start NovelFork Studio web workbench")
  .option("-p, --port <port>", "Server port", "4567")
  .action(async (opts) => {
    const root = findProjectRoot();
    const port = opts.port;
    const url = `http://localhost:${port}`;
    const launch = await resolveStudioLaunch(root);

    if (!launch) {
      logError(
        "NovelFork Studio not found. If you cloned the repo, run:\n" +
        "  cd packages/studio && pnpm install && pnpm build\n" +
        "Then run 'novelfork studio' from the project root.",
      );
      process.exit(1);
    }

    log(`Starting NovelFork Studio on ${url}`);

    const child = spawn(launch.command, launch.args, {
      cwd: root,
      env: { ...process.env, NOVELFORK_STUDIO_PORT: port },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (data: Buffer) => {
      process.stdout.write(data.toString("utf-8"));
    });
    child.stderr?.on("data", (data: Buffer) => {
      process.stderr.write(data.toString("utf-8"));
    });
    child.on("error", (e: Error) => {
      logError(`Failed to start studio: ${e.message}`);
      process.exit(1);
    });

    await openExternalUrl(process.platform, url, root);

    child.on("close", (code: number | null) => {
      process.exit(code ?? 0);
    });
  });
