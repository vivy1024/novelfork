import { startStudioServer } from "./server.js";
import { resolve, join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createEmbeddedStaticProvider } from "./static-provider.js";
import { openStudioWindow } from "./desktop-window.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const root = process.argv[2] ?? process.env.NOVELFORK_PROJECT_ROOT ?? process.cwd();
const port = parseInt(process.env.NOVELFORK_STUDIO_PORT ?? "4567", 10);

const studioRoot = resolve(__dirname, "../..");
const distDir = join(studioRoot, "dist");
const hasFrontendAssets = existsSync(join(distDir, "index.html"));

let staticProvider: ReturnType<typeof createEmbeddedStaticProvider> | undefined;

if (!hasFrontendAssets) {
  try {
    const { embeddedIndexHtml, embeddedAssets } = await import("./embedded-assets.generated.js");
    if (embeddedAssets && Object.keys(embeddedAssets).length > 0) {
      const files: Record<string, { content: Uint8Array; contentType: string }> = {};
      for (const [k, v] of Object.entries(embeddedAssets as Record<string, { content: Uint8Array; contentType: string }>)) {
        files[k] = v;
      }
      staticProvider = createEmbeddedStaticProvider({ indexHtml: embeddedIndexHtml, files });
    }
  } catch {
    console.warn("Frontend assets not found. Starting in API-only mode.");
  }
}

const serverUrl = `http://localhost:${port}`;

startStudioServer(root, port, {
  staticDir: hasFrontendAssets ? distDir : undefined,
  staticProvider,
  staticMode: hasFrontendAssets ? "filesystem" : (staticProvider ? "embedded" : "missing"),
})
  .then(() => {
    const launchPlan = openStudioWindow(serverUrl);
    if (launchPlan.kind === "app") {
      console.log(`NovelFork app window opened via ${launchPlan.command}`);
    } else if (launchPlan.kind === "browser") {
      console.log(`NovelFork opened in default browser via ${launchPlan.command}`);
    }
  })
  .catch((e) => {
    console.error("Failed to start studio:", e);
    process.exit(1);
  });
