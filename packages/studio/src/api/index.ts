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

// Package entrypoint for published Studio package usage only.
// The repository-level Bun main entry is `D:/DESKTOP/novelfork/main.ts`.
// Keep this file as a thin package launcher; do not treat it as the primary runtime path.
if (!existsSync(join(distDir, "index.html"))) {
  console.error("Built frontend assets not found for the Studio package entry.");
  console.error("Run 'pnpm bun:build-client' or 'cd packages/studio && pnpm build' before using this package entry.");
  process.exit(1);
}

startStudioServer(root, port, { staticDir: distDir }).catch((e) => {
  console.error("Failed to start studio:", e);
  process.exit(1);
});
