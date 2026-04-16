#!/usr/bin/env node
/**
 * build-studio-sea.mjs — Build InkOS Studio as a Node.js Single Executable Application.
 *
 * Steps:
 *   1. Build frontend (Vite) → dist/
 *   2. Build server (tsc) → dist-server/
 *   3. Bundle server + static assets into a single JS blob
 *   4. Generate SEA config → sea-config.json
 *   5. Create SEA blob → sea-prep.blob
 *   6. Copy node.exe → inkos.exe
 *   7. Inject SEA blob into inkos.exe
 *
 * Requirements: Node.js >= 22.5.0, pnpm, Windows (for .exe output)
 *
 * Usage: node build-studio-sea.mjs [--skip-frontend] [--skip-server]
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const studioRoot = resolve(__dirname, "packages", "studio");
const outDir = resolve(__dirname, "dist-sea");
const skipFrontend = process.argv.includes("--skip-frontend");
const skipServer = process.argv.includes("--skip-server");

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...opts });
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// --- Step 1: Build frontend ---
if (!skipFrontend) {
  console.log("\n=== Step 1: Building frontend ===");
  run("pnpm run build", { cwd: studioRoot });
} else {
  console.log("\n=== Step 1: Skipping frontend build ===");
}

// --- Step 2: Build server ---
if (!skipServer) {
  console.log("\n=== Step 2: Building server ===");
  run("pnpm run --filter @actalk/inkos-core build", { cwd: __dirname });
  run("pnpm run --filter @actalk/inkos-studio build:server", { cwd: __dirname });
} else {
  console.log("\n=== Step 2: Skipping server build ===");
}

// --- Step 3: Create SEA entry point ---
console.log("\n=== Step 3: Creating SEA entry bundle ===");
ensureDir(outDir);

const serverPath = resolve(__dirname, "packages", "studio", "dist", "api", "server.js").replace(/\\/g, "/");

const seaEntrySrc = `
// InkOS Studio — Single Executable Application entry
const { startStudioServer } = require("${serverPath}");
const { join } = require("node:path");
const { spawn } = require("node:child_process");

// Parse command line arguments
const args = process.argv.slice(2);

// Handle --version flag
if (args.includes('--version') || args.includes('-v')) {
  console.log('InkOS Studio v1.1.1');
  process.exit(0);
}

// Handle --help flag
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: inkos [options] [project-path]');
  console.log('');
  console.log('Options:');
  console.log('  -h, --help     Show this help message');
  console.log('  -v, --version  Show version number');
  console.log('  --port <port>  Specify port (default: 4567)');
  console.log('');
  console.log('Environment Variables:');
  console.log('  INKOS_PROJECT_ROOT  Default project directory');
  console.log('  INKOS_STUDIO_PORT   Server port (default: 4567)');
  process.exit(0);
}

// Extract port from --port flag if present
let portArg = null;
const portIndex = args.findIndex(arg => arg === '--port');
if (portIndex !== -1 && args[portIndex + 1]) {
  portArg = parseInt(args[portIndex + 1], 10);
}

// Get project root (first non-flag argument)
const root = args.find(arg => !arg.startsWith('-') && arg !== args[portIndex + 1])
  || process.env.INKOS_PROJECT_ROOT
  || process.cwd();

const port = portArg || parseInt(process.env.INKOS_STUDIO_PORT || "4567", 10);
const exeDir = require("node:path").dirname(process.execPath);
const staticDir = join(exeDir, "static");

setTimeout(() => {
  const url = "http://localhost:" + port;
  console.log("Opening " + url + " in browser...");
  const platform = process.platform;
  if (platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  } else if (platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  }
}, 1500);

console.log("InkOS Studio starting on http://localhost:" + port);
startStudioServer(root, port, { staticDir }).catch((e) => {
  console.error("Failed to start:", e);
  process.exit(1);
});
`.trim();

const seaEntrySrcPath = join(outDir, "sea-entry-src.js");
writeFileSync(seaEntrySrcPath, seaEntrySrc, "utf-8");

// Bundle with esbuild into a single CJS file
const seaEntryPath = join(outDir, "sea-entry.js");

const { build: esbuild } = await import("esbuild");
await esbuild({
  entryPoints: [seaEntrySrcPath],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: seaEntryPath,
  external: ["better-sqlite3", "node:*"],
  absWorkingDir: __dirname,
});

// --- Step 4: Generate SEA config ---
console.log("\n=== Step 4: Generating SEA config ===");
const seaConfig = {
  main: seaEntryPath,
  output: join(outDir, "sea-prep.blob"),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: true,
};
const seaConfigPath = join(outDir, "sea-config.json");
writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2), "utf-8");

// --- Step 5: Generate SEA blob ---
console.log("\n=== Step 5: Generating SEA blob ===");
run(`node --experimental-sea-config "${seaConfigPath}"`);

// --- Step 6: Copy node.exe ---
console.log("\n=== Step 6: Copying node.exe → inkos.exe ===");
const nodeExe = process.execPath;
const inkosExe = join(outDir, "inkos.exe");
copyFileSync(nodeExe, inkosExe);

// --- Step 7: Inject SEA blob ---
console.log("\n=== Step 7: Injecting SEA blob ===");
const blobPath = join(outDir, "sea-prep.blob");

// Remove signature (Windows)
try {
  run(`signtool remove /s "${inkosExe}"`, { stdio: "pipe" });
} catch {
  // signtool not available — skip, postject handles unsigned binaries
}

run(`npx postject "${inkosExe}" NODE_SEA_BLOB "${blobPath}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`);

// --- Step 8: Copy frontend static files ---
console.log("\n=== Step 8: Copying frontend static files ===");
const frontendSrc = join(studioRoot, "dist");
const frontendDst = join(outDir, "static");
ensureDir(frontendDst);
ensureDir(join(frontendDst, "assets"));

// Copy index.html
copyFileSync(join(frontendSrc, "index.html"), join(frontendDst, "index.html"));

// Copy assets
for (const f of readdirSync(join(frontendSrc, "assets"))) {
  copyFileSync(join(frontendSrc, "assets", f), join(frontendDst, "assets", f));
}

// Copy vite.svg if exists
if (existsSync(join(frontendSrc, "vite.svg"))) {
  copyFileSync(join(frontendSrc, "vite.svg"), join(frontendDst, "vite.svg"));
}

console.log(`Copied frontend to ${frontendDst}`);

console.log(`\n=== Done! ===`);
console.log(`Output: ${inkosExe}`);
console.log(`Static: ${frontendDst}`);
console.log(`\nUsage:`);
console.log(`  inkos.exe                    # Start studio in current directory`);
console.log(`  inkos.exe /path/to/project   # Start studio for specific project`);
console.log(`  INKOS_STUDIO_PORT=8080 inkos.exe  # Custom port`);
