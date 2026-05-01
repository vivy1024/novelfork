import { startStudioServer } from "./server.js";
import { resolve, join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const root = process.argv[2] ?? process.env.NOVELFORK_PROJECT_ROOT ?? process.cwd();
const port = parseInt(process.env.NOVELFORK_STUDIO_PORT ?? "4567", 10);

const studioRoot = resolve(__dirname, "../..");
const distDir = join(studioRoot, "dist");
const hasFrontendAssets = existsSync(join(distDir, "index.html"));

if (!hasFrontendAssets) {
  console.warn("Frontend assets not found. Starting in API-only mode.");
  console.warn("Run 'bun run build:client' to build frontend assets, or use 'bun run dev' for development.");
}

startStudioServer(root, port, {
  staticDir: hasFrontendAssets ? distDir : undefined,
  staticMode: hasFrontendAssets ? "filesystem" : "missing",
}).catch((e) => {
  console.error("Failed to start studio:", e);
  process.exit(1);
});
