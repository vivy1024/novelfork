import { Command } from "commander";
import { spawnProcess } from "@vivy1024/novelfork-core/runtime/process-adapter";
import { openExternalUrl } from "../open-external-url.js";
import { findProjectRoot, log, logError } from "../utils.js";
import { dirname, join, resolve } from "node:path";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export interface StudioLaunchSpec {
  readonly studioEntry: string;
  readonly command: string;
  readonly args: string[];
}

export interface BrowserLaunchSpec {
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

export function resolveBrowserLaunch(
  platform: NodeJS.Platform,
  url: string,
): BrowserLaunchSpec {
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }
  if (platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", url] };
  }
  return { command: "xdg-open", args: [url] };
}

export async function resolveStudioLaunch(root: string): Promise<StudioLaunchSpec | null> {
  // 运行时口径：仓库级 Bun 主入口优先；legacy Studio 入口仅作为最后兼容桥。
  const bunMainEntry = await firstAccessiblePath([
    join(root, "main.ts"),
    resolve(root, "..", "main.ts"),
  ]);
  if (bunMainEntry) {
    return {
      studioEntry: bunMainEntry,
      command: "bun",
      args: ["run", bunMainEntry, `--root=${root}`],
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

  const sourceEntry = await firstAccessiblePath([
    resolve(root, "..", "packages", "studio", "src", "api", "index.ts"),
    join(root, "packages", "studio", "src", "api", "index.ts"),
    resolve(root, "..", "studio", "src", "api", "index.ts"),
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
        "  pnpm bun:compile\n" +
        "or, for package-only verification:\n" +
        "  pnpm --dir packages/studio build\n" +
        "Then run 'novelfork studio' from the project root.",
      );
      process.exit(1);
    }

    log(`Starting NovelFork Studio on ${url}`);

    const child = await spawnProcess(launch.command, launch.args, {
      cwd: root,
      env: { ...process.env, NOVELFORK_STUDIO_PORT: port },
    });

    child.onStdout((data) => {
      process.stdout.write(data);
    });
    child.onStderr((data) => {
      process.stderr.write(data);
    });
    child.onError((e) => {
      logError(`Failed to start studio: ${e.message}`);
      process.exit(1);
    });

    await openExternalUrl(process.platform, url, root);

    child.onClose((code) => {
      process.exit(code ?? 0);
    });
  });
