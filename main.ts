import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { startStudioServer } from "./packages/studio/src/api/server.ts";
import { createFilesystemStaticProvider } from "./packages/studio/src/api/static-provider.ts";

function parseArg(name: string): string | undefined {
  const prefix = `${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

const projectRoot = resolve(
  parseArg("--root")
    ?? process.env.NOVELFORK_PROJECT_ROOT
    ?? process.cwd(),
);
const port = parseInt(
  parseArg("--port")
    ?? process.env.NOVELFORK_STUDIO_PORT
    ?? "4567",
  10,
);

const staticDir = resolve("packages/studio/dist");
const hasStatic = existsSync(join(staticDir, "index.html"));
const staticProvider = hasStatic ? createFilesystemStaticProvider(staticDir) : undefined;

if (!hasStatic) {
  console.warn("[bun:main] packages/studio/dist/index.html not found; starting API without embedded frontend assets.");
  console.warn("[bun:main] Run 'pnpm bun:build-client' before using the Bun main entry with the web UI.");
}

await startStudioServer(projectRoot, port, {
  staticDir: hasStatic ? staticDir : undefined,
  staticProvider,
});
