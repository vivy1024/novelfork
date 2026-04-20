import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { startStudioServer } from "./packages/studio/src/api/server.ts";
import { createEmbeddedStaticProvider, createFilesystemStaticProvider } from "./packages/studio/src/api/static-provider.ts";

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

let staticProvider;
let usingEmbeddedAssets = false;

try {
  const embeddedAssets = await import("./packages/studio/src/api/embedded-assets.generated.ts");
  if (embeddedAssets.embeddedIndexHtml) {
    staticProvider = createEmbeddedStaticProvider({
      indexHtml: embeddedAssets.embeddedIndexHtml,
      files: embeddedAssets.embeddedFiles,
    });
    usingEmbeddedAssets = true;
  }
} catch {
  // generated module missing; fall back to filesystem assets
}

if (!staticProvider && hasStatic) {
  staticProvider = createFilesystemStaticProvider(staticDir);
}

if (!staticProvider) {
  console.warn("[bun:main] No embedded assets or packages/studio/dist/index.html found; starting API without frontend assets.");
  console.warn("[bun:main] Run 'pnpm bun:build-client' and 'pnpm bun:embed-assets' before compile.");
} else if (usingEmbeddedAssets) {
  console.log("[bun:main] Using embedded Studio assets.");
}

await startStudioServer(projectRoot, port, {
  staticDir: hasStatic ? staticDir : undefined,
  staticProvider,
});
