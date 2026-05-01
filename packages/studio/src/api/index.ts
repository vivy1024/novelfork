import { startStudioServer } from "./server.js";
import { resolve, join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const root = process.argv[2] ?? process.env.NOVELFORK_PROJECT_ROOT ?? process.cwd();
const port = parseInt(process.env.NOVELFORK_STUDIO_PORT ?? "4567", 10);

// Find studio package root (2 levels up from src/api/)
const studioRoot = resolve(__dirname, "../..");
const distDir = join(studioRoot, "dist");

// When running as compiled binary, frontend assets may not exist on filesystem.
// Allow the server to start in API-only mode, or with embedded assets.
const hasFrontendAssets = existsSync(join(distDir, "index.html"));

if (!hasFrontendAssets && !process.env.NOVELFORK_API_ONLY) {
  console.warn("Frontend assets not found. Starting in API-only mode.");
  console.warn("Run 'pnpm build:client' to build frontend assets.");
}

startStudioServer(root, port, {
  staticDir: hasFrontendAssets ? distDir : undefined,
  staticMode: hasFrontendAssets ? "filesystem" : "missing",
}).catch((e) => {
  console.error("Failed to start studio:", e);
  process.exit(1);
});
