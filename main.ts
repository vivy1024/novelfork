import { homedir } from "node:os";
import { resolve } from "node:path";

// Root main.ts is the stable NovelFork executable entry. Configure product-owned
// paths before the complete NarraFork Runtime backend evaluates. The product
// keeps its NovelFork domain database, Runtime database, lock, and settings
// separate from the standalone NarraFork host by default.
const novelForkHome = resolve(homedir(), ".novelfork");
const defaultRuntimeDir = resolve(novelForkHome, ".runtime");
const projectRoot = process.env.NOVELFORK_PROJECT_ROOT ?? novelForkHome;
const runtimeDir = process.env.NOVELFORK_RUNTIME_DIR ?? process.env.NARRAFORK_HOME ?? defaultRuntimeDir;

process.env.NOVELFORK_PROJECT_ROOT ??= projectRoot;
process.env.NOVELFORK_BOOKS_ROOT ??= resolve(projectRoot, "books");
process.env.NOVELFORK_RUNTIME_DIR ??= runtimeDir;
process.env.NARRAFORK_HOME ??= runtimeDir;
process.env.NOVELFORK_SESSION_STORE_DIR ??= resolve(runtimeDir, "sessions");
process.env.NOVELFORK_STORAGE_DB_PATH ??= resolve(novelForkHome, "novelfork.db");

// Preserve NovelFork's historical public listener port. Explicit PORT and
// --port=XXXX values remain supported by the Runtime server.
process.env.PORT ??= "4567";

// Keep the specifier literal so Bun includes the complete Runtime dependency graph
// in the root executable without maintaining a second Runtime implementation package.
await import("./packages/narrafork-runtime-private/server/index.ts");

// Open the product UI only after the Runtime has bound its actual listener. Reading
// the registered address matters when --port is overridden or the Runtime has to
// move to the next available port during startup.
if (process.env.NOVELFORK_NO_BROWSER !== "1") {
  const { getRuntimeAddress } = await import(
    "./packages/narrafork-runtime-private/server/lib/server-restart.ts"
  );
  const { openStudioWindow } = await import("./packages/studio/src/desktop-window.ts");
  const address = getRuntimeAddress();
  const host =
    address.host === "0.0.0.0" || address.host === "::" ? "localhost" : address.host;
  const browserHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  const studioUrl = `${address.protocol}://${browserHost}:${address.port}`;
  const launchPlan = openStudioWindow(studioUrl);

  if (launchPlan.kind === "app") {
    console.log(`[desktop-window] Opened NovelFork app window at ${studioUrl}`);
  } else if (launchPlan.kind === "browser") {
    console.log(`[desktop-window] Opened NovelFork in the system browser at ${studioUrl}`);
  }
}
