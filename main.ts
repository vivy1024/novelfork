import { homedir } from "node:os";
import { resolve } from "node:path";

// 五个协议模块都刻意零副作用（不开库、不读设置），静态导入不会提前触发产品启动。
import { DB_INTEGRITY_WORKER_FLAG } from "./packages/narrafork-runtime-private/server/db/integrity-protocol.ts";
import { DB_SNAPSHOT_WORKER_FLAG } from "./packages/narrafork-runtime-private/server/db/snapshot-protocol.ts";
import { WATCHER_WORKER_FLAG } from "./packages/narrafork-runtime-private/server/lib/watcher/worker-protocol.ts";
import { PLUGIN_RUNTIME_WORKER_FLAG } from "./packages/narrafork-runtime-private/server/plugin-runtime-worker.ts";
import { FILE_CHANGE_PHYSICAL_AUDIT_WORKER_FLAG } from "./packages/narrafork-runtime-private/server/services/file-change-physical-audit.ts";

// 自检与后台 worker 子进程必须在所有产品设置之前分流：
// - 下面的延迟 import 链（product 集成、bridge 的 db/settings）一旦先求值，
//   会以父进程为名去开 Runtime 数据库、跑迁移、取实例锁并打印 JSON 日志——
//   既与父进程抢锁（实测本地插件激活即被隔离），也把 JSON 日志淋到 STDOUT、
//   污染 worker 的 Content-Length RPC 帧；完整性探针还会在只读检查前先读写一遍待查的库。
// - Runtime 的 server/index.ts 自带这些 flag 的分流（在 ./main 之前）；
//   产品 root 入口也必须遵守同一个契约。flag 名直接引用 Runtime 常量，不手抄。
const WORKER_FLAGS = [
  DB_INTEGRITY_WORKER_FLAG,
  DB_SNAPSHOT_WORKER_FLAG,
  FILE_CHANGE_PHYSICAL_AUDIT_WORKER_FLAG,
  WATCHER_WORKER_FLAG,
  PLUGIN_RUNTIME_WORKER_FLAG,
] as const;

if (WORKER_FLAGS.some((flag) => process.argv.includes(flag))) {
  // 事件循环在 stdio/网络处理器存活期间保持，worker 任务结束后进程自然退出。
  await import("./packages/narrafork-runtime-private/server/index.ts");
} else {

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

// 桌面单实例：同一数据目录已有 NovelFork 在跑（实例记录的进程存活、地址答 Runtime 健康检查），
// 就把窗口交给它并以退出码 0 退出——不再撞端口与实例锁。判断只读产品自己的实例记录与
// Runtime 实例锁文件，不加载 Runtime；陈旧记录按没有实例处理，之后由 Runtime 原有实例锁逻辑裁决。
const desktopInstance = await import("./packages/studio/src/desktop-instance.ts");
const desktopWindow = await import("./packages/studio/src/desktop-window.ts");
const windowDisabled = desktopWindow.isDesktopWindowDisabled();
const { isCompiledRuntime } = await import("./packages/narrafork-runtime-private/server/lib/runtime-target.ts");
// Windows 编译产物默认进 Runtime 图形化管理器（托盘 + 管理窗口），服务由它以 `--serve` 子进程拉起；
// 其余情况（管理器的服务子进程、无头运行、非 Windows、源码）直接跑服务。见 resolveDesktopLaunchMode。
const requestedLaunchMode = desktopWindow.resolveDesktopLaunchMode({
  platform: process.platform,
  argv: process.argv,
  compiled: isCompiledRuntime(),
});
// 管理器定制挂点（fork 层 server/manager/manager-host.ts）。旧版 Runtime 没有它时不进管理器：
// 否则是一个 NarraFork 品牌、开系统浏览器的上游管理器。
const managerHostModule =
  requestedLaunchMode === "manager"
    ? await import("./packages/narrafork-runtime-private/server/manager/manager-host.ts").catch(() => undefined)
    : undefined;
const launchMode = managerHostModule ? requestedLaunchMode : "serve";
// 管理器拉起的服务子进程：窗口由管理器开，实例锁冲突要报给管理器（它会等旧进程退出后重试）。
const managedByManager = process.env.NARRAFORK_MANAGER_MANAGED === "1";
// 自动更新的替换进程：旧服务仍在应答健康检查、正等它来交接（Runtime `restart-handoff`）。
// 此时不能把窗口交给旧服务后退出，否则交接超时、更新失败。
const updateHandoff = Boolean(
  process.env.NARRAFORK_GRACEFUL_RESTART_URL && process.env.NARRAFORK_GRACEFUL_RESTART_TOKEN,
);

// Windows 上聚焦已开的 NovelFork 应用窗口。Chromium（Edge/Chrome）每个 profile 的浏览器进程有一个
// 以 user-data-dir 为标题的消息窗口（类 Chrome_MessageWindow），据此找到 NovelFork 专用 profile
// 的浏览器进程，只聚焦这个进程里标题匹配的顶层窗口（类 Chrome_WidgetWin_1）——不会误聚焦
// 另一个数据目录的 NovelFork 窗口或同名的资源管理器窗口。FFI 不可用时返回 undefined（只新开窗口）。
// 写在入口里而不是 studio 包：这是 Bun 专属代码，studio 的 Node 类型检查不认 bun:ffi。
async function loadWindowFocus(userDataDir: string): Promise<((title: string) => boolean) | undefined> {
  if (process.platform !== "win32") return undefined;
  try {
    const { dlopen, FFIType, ptr } = await import("bun:ffi");
    const { symbols: user32 } = dlopen("user32.dll", {
      FindWindowExW: { args: [FFIType.i64, FFIType.i64, FFIType.ptr, FFIType.ptr], returns: FFIType.i64 },
      GetWindowThreadProcessId: { args: [FFIType.i64, FFIType.ptr], returns: FFIType.u32 },
      IsWindowVisible: { args: [FFIType.i64], returns: FFIType.i32 },
      IsIconic: { args: [FFIType.i64], returns: FFIType.i32 },
      ShowWindow: { args: [FFIType.i64, FFIType.i32], returns: FFIType.i32 },
      SetForegroundWindow: { args: [FFIType.i64], returns: FFIType.i32 },
    });
    const HWND_MESSAGE = -3;
    const SW_RESTORE = 9;
    const wide = (text: string) => Buffer.from(`${text}\0`, "utf16le");
    const windowPid = (hwnd: number | bigint) => {
      const pid = new Uint32Array(1);
      user32.GetWindowThreadProcessId(hwnd, ptr(pid));
      return pid[0];
    };
    const messageClass = wide("Chrome_MessageWindow");
    const appClass = wide("Chrome_WidgetWin_1");
    return (title) => {
      const messageWindow = user32.FindWindowExW(HWND_MESSAGE, 0, ptr(messageClass), ptr(wide(userDataDir)));
      if (!messageWindow) return false;
      const browserPid = windowPid(messageWindow);
      const name = wide(title);
      let hwnd: number | bigint = 0;
      for (let index = 0; index < 64; index++) {
        hwnd = user32.FindWindowExW(0, hwnd, ptr(appClass), ptr(name));
        if (!hwnd) return false;
        if (windowPid(hwnd) !== browserPid || !user32.IsWindowVisible(hwnd)) continue;
        // 只唤出最小化的窗口；最大化/普通窗口只前置，不改尺寸。
        if (user32.IsIconic(hwnd)) user32.ShowWindow(hwnd, SW_RESTORE);
        user32.SetForegroundWindow(hwnd);
        return true;
      }
      return false;
    };
  } catch {
    return undefined;
  }
}

const focusUserDataDir = () => resolve(process.env.NOVELFORK_DESKTOP_USER_DATA_DIR ?? "");

async function bringRunningInstanceForward(running: { url: string; windowTitle?: string; starting: boolean }) {
  if (windowDisabled) {
    console.log(`[desktop-window] NovelFork is already running at ${running.url}; window launch is disabled.`);
    return;
  }
  const url = desktopWindow.desktopOrigin(running.url);
  const activation = desktopWindow.activateStudioWindow(url, {
    windowTitles: [running.windowTitle, desktopWindow.STUDIO_DOCUMENT_TITLE],
    // Chromium 以规范化的绝对路径（Windows 反斜杠）作消息窗口标题，这里同样规范化。
    focusWindow: await loadWindowFocus(focusUserDataDir()),
  });
  console.log(
    activation.kind === "focused"
      ? `[desktop-window] NovelFork is already running; focused its window (${url}).`
      : `[desktop-window] NovelFork is already running; opened ${url}.`,
  );
}

if (launchMode === "manager") {
  // 管理器本身不认领实例记录（记录归它拉起的服务子进程）。服务已在跑就直接把窗口带到前面；
  // 服务没在跑而管理器在托盘里时，Runtime 管理器的单实例互斥体会把这次启动转成「打开前端」。
  if (!updateHandoff) {
    const running = await desktopInstance.probeRunningDesktopInstance(runtimeDir, process.pid);
    if (running.kind === "running") {
      await bringRunningInstanceForward(running);
      process.exit(0);
    }
  }
} else {
  if (updateHandoff) {
    desktopInstance.claimDesktopInstanceRecord(runtimeDir, process.pid, { force: true });
  } else {
    const existingInstance = await desktopInstance.resolveDesktopInstance(runtimeDir, process.pid);
    if (existingInstance.kind === "running") {
      if (!managedByManager) {
        await bringRunningInstanceForward(existingInstance);
        process.exit(0);
      }
      // 管理器的子进程不替别人开窗也不静默退出：继续启动，由 Runtime 实例锁把冲突报给管理器。
      console.log(`[desktop-window] Another NovelFork (pid ${existingInstance.pid}) holds this data directory.`);
    }
  }
  process.once("exit", () => desktopInstance.releaseDesktopInstanceRecord(runtimeDir, process.pid));
}

// The product adapter must be registered before the Runtime server graph evaluates. The
// Runtime package itself remains usable without this registration via its Null integration,
// while the NovelFork executable opts into product behavior here. Importing the adapter opens
// the Runtime database (instance lock, migrations), so with startup hooks it runs under the
// Runtime startup status page instead of before it.
const { registerRuntimeProductIntegration } = await import(
  "./packages/narrafork-runtime-private/server/lib/product-host/index.ts"
);
async function registerNovelForkProduct(): Promise<void> {
  const { novelForkProductIntegration } = await import("./packages/novelfork-product-runtime/src/index.ts");
  registerRuntimeProductIntegration(novelForkProductIntegration);
}

// 窗口标题跟随实例显示名（启动状态页标题），记进实例记录，供再次启动时聚焦。
const { resolveBranding } = await import("./packages/narrafork-runtime-private/shared/branding.ts");
let windowTitle = resolveBranding(undefined).name;
if (launchMode === "serve") {
  // NovelFork owns the desktop window. The embedded Runtime has its own generic browser
  // auto-open setting; the fork already skips it while startup hooks are registered
  // (`hostOpensWindow`), this keeps older Runtime trees from opening a second window too.
  // The manager process skips the settings module: it must not load the server's modules.
  const { settings: runtimeSettings } = await import(
    "./packages/narrafork-runtime-private/server/lib/settings/index.ts"
  );
  runtimeSettings.server.openBrowser = "off";
  windowTitle = resolveBranding(runtimeSettings.branding).name;
}

let openedWindowUrl: string | undefined;
// 端口一可用（启动状态页）就打开窗口，真服务换了地址（端口回落）时再开新地址。
// 地址按 desktopOrigin 归一：状态页与正式服务的主机写法不同（127.0.0.1 / localhost / [::1]）时
// 仍是同一个窗口。
function openWindowAt(rawUrl: string): boolean {
  const url = desktopWindow.desktopOrigin(rawUrl);
  desktopInstance.updateDesktopInstanceRecord(runtimeDir, process.pid, { url, windowTitle });
  if (windowDisabled || managedByManager) return false;
  if (openedWindowUrl === url) return true;
  // 只在第一次打开前清 profile 的 Service Worker 缓存；端口回落后再开时浏览器已在用这个 profile。
  const firstOpen = openedWindowUrl === undefined;
  openedWindowUrl = url;
  const launchPlan = desktopWindow.openStudioWindow(url, { cleanServiceWorkerCache: firstOpen });
  if (launchPlan.kind === "app") {
    console.log(`[desktop-window] Opened NovelFork app window at ${url}`);
  } else if (launchPlan.kind === "browser") {
    console.log(`[desktop-window] Opened NovelFork in the system browser at ${url}`);
  }
  return launchPlan.kind !== "none";
}

// Runtime 启动钩子（fork 层 server/lib/startup-hooks.ts）。旧版 Runtime 没有这个模块时退回
// “先注册产品、Runtime 完整就绪后再开窗口”的旧流程。管理器进程也注册：它接不了更新交接时会
// 改走服务模式（Runtime `runManager()` 返回 "serve"），那时它就是普通的服务进程。
const startupHooks = await import("./packages/narrafork-runtime-private/server/lib/startup-hooks.ts").catch(
  () => undefined,
);
if (startupHooks) {
  startupHooks.registerRuntimeStartupHooks({
    beforeServerMain: registerNovelForkProduct,
    onStartupPageListening: (url) => openWindowAt(url),
    onServerListening: (url) => {
      openWindowAt(url);
    },
    // 与另一个进程几乎同时启动、输掉实例锁：等对方写出地址后把窗口交给它。
    // 管理器的子进程不接这个：冲突要报给管理器。
    onInstanceLocked: async () => {
      if (managedByManager) return false;
      const running = await desktopInstance.waitForRunningDesktopInstance(runtimeDir, process.pid, {
        timeoutMs: 10_000,
      });
      if (running.kind !== "running") return false;
      await bringRunningInstanceForward(running);
      return true;
    },
  });
} else if (launchMode === "serve") {
  await registerNovelForkProduct();
}

if (launchMode === "manager" && managerHostModule) {
  // 托盘管理器（Runtime fork 层 server/manager/manager-host.ts）：NovelFork 的名称、图标与互斥体，
  // 「打开」走 NovelFork 应用窗口（先聚焦已开窗口），更新入口仍是服务端的 NovelFork 自动更新。
  const { registerManagerHost } = managerHostModule;
  const { renderNovelForkIcon } = await import("./packages/studio/src/desktop-icon.ts");
  const focusWindow = await loadWindowFocus(focusUserDataDir());
  let managerOpenedWindow = false;
  registerManagerHost({
    productName: "NovelFork",
    instanceKey: "NovelFork",
    icon: renderNovelForkIcon,
    sourceServeArgs: [import.meta.path, "--serve"],
    openFrontend: (request) => {
      if (windowDisabled) return "none";
      const url = desktopWindow.desktopOrigin(request.url);
      // 只在本次运行第一次开窗前清 Service Worker 缓存（EXE 升级后不吃旧前端）。
      const cleanServiceWorkerCache = !managerOpenedWindow;
      const open = (target: string) => {
        managerOpenedWindow = true;
        return desktopWindow.openStudioWindow(target, { cleanServiceWorkerCache });
      };
      const activation = request.forceNewWindow
        ? open(url)
        : desktopWindow.activateStudioWindow(url, {
            windowTitles: [request.windowTitle, desktopWindow.STUDIO_DOCUMENT_TITLE],
            focusWindow,
            open: (target) => open(target),
          });
      if (activation.kind === "focused") return "focused";
      return activation.kind === "none" ? "none" : "opened";
    },
  });
  // 管理器不把命令行转给服务子进程（子进程只带 `--serve`），监听参数改由继承的环境变量传过去。
  for (const [flag, name] of [
    ["--port=", "PORT"],
    ["--host=", "HOST"],
  ] as const) {
    const value = process.argv.find((arg) => arg.startsWith(flag))?.slice(flag.length);
    if (value) process.env[name] = value;
  }
  // Runtime 的启动分流：不带 `--serve`、带 `--manager` 即进管理器。
  process.argv = process.argv.filter((arg) => arg !== "--serve");
  if (!process.argv.includes("--manager")) process.argv.push("--manager");
} else if (!process.argv.includes("--serve")) {
  // Runtime 0.9 起，Windows 编译产物默认先进入图形化管理器；服务模式显式带上 `--serve`。
  process.argv.push("--serve");
}

// Keep the specifier literal so Bun includes the complete Runtime dependency graph
// in the root executable without maintaining a second Runtime implementation package.
await import("./packages/narrafork-runtime-private/server/index.ts");

if (!startupHooks && launchMode === "serve") {
  // 旧流程：Runtime 已绑定真实监听后再开窗口。Prefer the Runtime-registered address getter;
  // fall back to the product default port so a missing export cannot crash a healthy server.
  const serverRestart = await import(
    "./packages/narrafork-runtime-private/server/lib/server-restart.ts"
  );
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
  openWindowAt(`${address.protocol}://${browserHost}:${address.port}`);
}

}
