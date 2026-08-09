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
const runtimeMigrationsDir = resolve(
  import.meta.dir,
  "packages",
  "narrafork-runtime-overlay",
  "runtime-migrations",
);

process.env.NOVELFORK_PROJECT_ROOT ??= projectRoot;
process.env.NOVELFORK_BOOKS_ROOT ??= resolve(projectRoot, "books");
process.env.NOVELFORK_RUNTIME_DIR ??= runtimeDir;
process.env.NARRAFORK_HOME ??= runtimeDir;
process.env.NOVELFORK_SESSION_STORE_DIR ??= resolve(runtimeDir, "sessions");
process.env.NOVELFORK_STORAGE_DB_PATH ??= resolve(novelForkHome, "novelfork.db");
process.env.NARRAFORK_MIGRATIONS_DIR ??= runtimeMigrationsDir;

// Preserve NovelFork's historical public listener port. Explicit PORT and
// --port=XXXX values remain supported by the Runtime server.
process.env.PORT ??= "4567";

// Register the product adapter before the Runtime server graph evaluates. The
// Runtime package itself remains usable without this registration via its Null
// integration, while the NovelFork executable opts into product behavior here.
const { registerRuntimeProductIntegration } = await import(
  "./packages/narrafork-runtime-private/server/lib/product-host/index.ts"
);
const { novelForkProductIntegration } = await import("./packages/novelfork-product-runtime/src/index.ts");
registerRuntimeProductIntegration(novelForkProductIntegration);

// NovelFork owns the single desktop-window launch below. The embedded Runtime
// has its own generic browser auto-open setting, which would otherwise launch a
// second window before the product shell opens its app window.
const { settings: runtimeSettings } = await import(
  "./packages/narrafork-runtime-private/server/lib/settings/index.ts"
);
runtimeSettings.server.openBrowser = "off";

// Keep the specifier literal so Bun includes the complete Runtime dependency graph
// in the root executable without maintaining a second Runtime implementation package.
await import("./packages/narrafork-runtime-private/server/index.ts");

// Open the product UI only after the Runtime has bound its actual listener.
// Prefer the Runtime-registered address getter when available; fall back to the
// product default port so a missing export cannot crash an otherwise healthy server.
if (
  process.env.NOVELFORK_NO_BROWSER !== "1" &&
  process.env.NARRAFORK_NO_BROWSER !== "1"
) {
  const serverRestart = await import(
    "./packages/narrafork-runtime-private/server/lib/server-restart.ts"
  );
  const { openStudioWindow } = await import("./packages/studio/src/desktop-window.ts");
  const fallbackPort = Number(process.env.PORT ?? "4567");
  const address =
    typeof serverRestart.getRuntimeAddress === "function"
      ? serverRestart.getRuntimeAddress()
      : {
          protocol: "http" as const,
          host: "localhost",
          port: Number.isFinite(fallbackPort) && fallbackPort > 0 ? fallbackPort : 4567,
        };
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
