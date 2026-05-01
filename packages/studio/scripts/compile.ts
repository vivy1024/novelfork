/**
 * NovelFork bun compile — 构建单文件可执行程序
 * 用法: bun run compile
 * 输出: dist/novelfork (Linux) / dist/novelfork.exe (Windows)
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");

async function main() {
  await mkdir(DIST, { recursive: true });

  // Step 1: Build frontend
  console.log("[1/4] Building frontend...");
  const buildClient = Bun.spawn(["bun", "run", "build:client"], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  await buildClient.exited;

  // Step 2: Generate embedded assets
  console.log("[2/4] Generating embedded assets...");
  const gen = Bun.spawn(["bun", "scripts/generate-embedded-assets.mjs"], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  await gen.exited;

  // Step 3: Build server (compiles the generated file)
  console.log("[3/4] Building server...");
  const buildServer = Bun.spawn(["bun", "run", "build:server"], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  await buildServer.exited;
  if (buildServer.exitCode !== 0) { console.error("Build failed"); process.exit(1); }

  // Step 4: Compile
  console.log("[4/4] Compiling...");
  const entry = join(ROOT, "dist", "api", "index.js");
  const out = join(DIST, process.platform === "win32" ? "novelfork.exe" : "novelfork");
  const c = Bun.spawn(["bun", "build", "--compile", "--target=bun", entry, "--outfile", out], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  await c.exited;
  console.log(c.exitCode === 0 ? "[Done] Output: dist/novelfork" : "Compile failed");
}

main();
