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
import { copyFile, mkdir, readFile, readdir, cp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";

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

  try {
    await copyFile(latestOutput, versionedOutput);
  } catch (err) {
    console.warn(`[Warn] Could not copy versioned output (file may be in use): ${err instanceof Error ? err.message : err}`);
  }

  // Copy .novelfork/skills/ to dist/ so exe can find them at runtime
  const skillsSrc = join(REPO_ROOT, ".novelfork", "skills");
  const skillsDest = join(RELEASE_DIST, ".novelfork", "skills");
  if (existsSync(skillsSrc)) {
    await mkdir(skillsDest, { recursive: true });
    const files = await readdir(skillsSrc);
    for (const file of files) {
      if (file.endsWith(".md")) {
        await copyFile(join(skillsSrc, file), join(skillsDest, file));
      }
    }
    console.log(`[Done] Skills copied: ${files.filter(f => f.endsWith(".md")).length} files → ${skillsDest}`);
  }

  // Copy docs/learning/ to dist/ so LearningGuide tool can find them at runtime
  const learningSrc = join(REPO_ROOT, "docs", "learning");
  const learningDest = join(RELEASE_DIST, "docs", "learning");
  if (existsSync(learningSrc)) {
    await mkdir(learningDest, { recursive: true });
    const files = await readdir(learningSrc);
    for (const file of files) {
      if (file.endsWith(".md")) {
        await copyFile(join(learningSrc, file), join(learningDest, file));
      }
    }
    console.log(`[Done] Learning docs copied: ${files.filter(f => f.endsWith(".md")).length} files → ${learningDest}`);
  }

  console.log(`[Done] Latest release output: ${latestOutput}`);
  console.log(`[Done] Versioned release output: ${versionedOutput}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
