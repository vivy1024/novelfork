/**
 * NovelFork bun compile — 构建单文件可执行程序
 * 用法: bun run compile
 * 输出:
 * - dist/novelfork(.exe)                           根目录最新产物
 * - dist/novelfork-vX.Y.Z-<platform>-<arch>(.exe)  Release 产物
 *
 * 注意：不要把 exe 输出到 packages/studio/dist。
 * 该目录由 Vite/tsc 管理，前端构建会清理它；exe 放进去会在 Windows 上导致 EPERM。
 */
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const REPO_ROOT = join(ROOT, "..", "..");
const DIST = join(ROOT, "dist");
const RELEASE_DIST = join(REPO_ROOT, "dist");

async function readVersion(): Promise<string> {
  const packageJson = JSON.parse(await readFile(join(REPO_ROOT, "package.json"), "utf-8")) as { version?: string };
  if (!packageJson.version) {
    throw new Error("package.json version is missing");
  }
  return packageJson.version;
}

async function runStep(label: string, command: string[]): Promise<void> {
  console.log(label);
  const child = Bun.spawn(command, { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  await child.exited;
  if (child.exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${child.exitCode}`);
  }
}

function platformLabel(): string {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return process.platform;
}

async function main() {
  const version = await readVersion();
  const executableName = process.platform === "win32" ? "novelfork.exe" : "novelfork";
  const versionedName = process.platform === "win32"
    ? `novelfork-v${version}-${platformLabel()}-${process.arch}.exe`
    : `novelfork-v${version}-${platformLabel()}-${process.arch}`;

  await mkdir(DIST, { recursive: true });
  await mkdir(RELEASE_DIST, { recursive: true });

  await runStep("[1/4] Building frontend...", ["bun", "run", "build:client"]);
  await runStep("[2/4] Generating embedded assets...", ["bun", "scripts/generate-embedded-assets.mjs"]);
  await runStep("[3/4] Building server...", ["bun", "run", "build:server"]);

  console.log("[4/4] Compiling...");
  const entry = join(ROOT, "dist", "api", "index.js");
  const latestOutput = join(RELEASE_DIST, executableName);
  const versionedOutput = join(RELEASE_DIST, versionedName);
  const compile = Bun.spawn(["bun", "build", "--compile", "--target=bun", entry, "--outfile", latestOutput], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  await compile.exited;
  if (compile.exitCode !== 0) {
    throw new Error(`Compile failed with exit code ${compile.exitCode}`);
  }

  await copyFile(latestOutput, versionedOutput);

  console.log(`[Done] Latest release output: ${latestOutput}`);
  console.log(`[Done] Versioned release output: ${versionedOutput}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
