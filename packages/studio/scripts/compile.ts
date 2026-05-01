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

  // Step 1: Build full project (frontend + server)
  console.log("[1/3] Building project...");
  const build = Bun.spawn(["bun", "run", "build"], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  await build.exited;
  if (build.exitCode !== 0) {
    console.error("Build failed");
    process.exit(1);
  }

  // Step 2: Compile to single executable
  console.log("[2/3] Compiling single executable...");
  const entryPoint = join(ROOT, "dist", "api", "index.js");
  const outFile = join(DIST, process.platform === "win32" ? "novelfork.exe" : "novelfork");
  
  const compile = Bun.spawn([
    "bun", "build",
    "--compile",
    "--target=bun",
    entryPoint,
    "--outfile", outFile,
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
