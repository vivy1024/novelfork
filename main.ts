import { homedir } from "node:os";
import { resolve } from "node:path";

// Root main.ts is the stable NovelFork executable entry. Configure product-owned
// paths before the complete NarraFork Runtime backend evaluates. The product
// keeps its NovelFork domain database, Runtime database, lock, and settings
// separate from the standalone NarraFork host by default.
// NOVELFORK_HOME 是产品数据目录：两个数据库、Runtime 目录、桌面窗口配置目录，以及各解析器的
// 默认路径（全局配置、作者技能、市场数据）都以它为根，可整体迁出用户目录。
const novelForkHome = resolve(process.env.NOVELFORK_HOME?.trim() || resolve(homedir(), ".novelfork"));
const defaultRuntimeDir = resolve(novelForkHome, ".runtime");
const projectRoot = process.env.NOVELFORK_PROJECT_ROOT ?? novelForkHome;
// 产品 Runtime 目录只认 NOVELFORK_RUNTIME_DIR（空值视为未设置）。继承来的 NARRAFORK_HOME
// 属于同机独立运行的 NarraFork 宿主，沿用它会打开并迁移那个宿主的数据库；空值同理，
// Runtime 会把空的 NARRAFORK_HOME 回落到 ~/.narrafork。
const configuredRuntimeDir = process.env.NOVELFORK_RUNTIME_DIR?.trim();
const runtimeDir = configuredRuntimeDir ? resolve(configuredRuntimeDir) : defaultRuntimeDir;
const runtimeMigrationsDir = resolve(
  import.meta.dir,
  "packages",
  "narrafork-runtime-private",
  "runtime-migrations",
);

process.env.NOVELFORK_HOME = novelForkHome;
process.env.NOVELFORK_PROJECT_ROOT ??= projectRoot;
process.env.NOVELFORK_BOOKS_ROOT ??= resolve(projectRoot, "books");
process.env.NOVELFORK_RUNTIME_DIR = runtimeDir;
process.env.NARRAFORK_HOME = runtimeDir;
process.env.NOVELFORK_SESSION_STORE_DIR ??= resolve(runtimeDir, "sessions");
process.env.NOVELFORK_STORAGE_DB_PATH ??= resolve(novelForkHome, "novelfork.db");
// 桌面窗口只认这个变量，否则落到写死的 ~/.novelfork/desktop-browser；空值同样视为未设置。
process.env.NOVELFORK_DESKTOP_USER_DATA_DIR =
  process.env.NOVELFORK_DESKTOP_USER_DATA_DIR?.trim() || resolve(novelForkHome, "desktop-browser");
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
