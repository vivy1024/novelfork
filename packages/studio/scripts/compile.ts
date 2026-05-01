/**
 * NovelFork bun compile — 构建单文件可执行程序
 * 用法: bun run compile
 * 输出: dist/novelfork (Linux) / dist/novelfork.exe (Windows)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");

async function main() {
  await mkdir(DIST, { recursive: true });

  // Step 1: Build frontend (Vite)
  console.log("[1/3] Building frontend...");
  const buildClient = Bun.spawn(["bun", "run", "build:client"], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  await buildClient.exited;
  if (buildClient.exitCode !== 0) {
    console.error("Frontend build failed");
    process.exit(1);
  }

  // Step 2: Build server (tsc) is already done as part of the normal build
  // The entry point is dist/api/index.js which is produced by tsc
  console.log("[2/3] Compiling single executable...");
  const compile = Bun.spawn([
    "bun", "build",
    "--compile",
    "--target=bun",
    join(ROOT, "dist", "api", "index.js"),
    "--outfile", join(DIST, "novelfork"),
  ], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  await compile.exited;

  if (compile.exitCode === 0) {
    console.log("[3/3] Done! Output: dist/novelfork");
  } else {
    console.error("Compile failed");
    process.exit(1);
  }
}

main();
