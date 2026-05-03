# Design — Desktop App Window

## Decision
采用“单 exe 服务 + 系统浏览器 app mode 窗口”的 NarraFork 风格路线。

不新增 Electron/Tauri 壳。原因：项目当前技术栈选型明确要求优先靠近 `bun compile` 单入口本地应用；历史 Tauri 壳不是当前主路线。Windows 上 Edge 默认可用，`msedge --app=http://localhost:4567` 能提供无地址栏、无标签页的独立窗口体验，满足当前目标且改动最小。

## Components

### `desktop-window.ts`
新增 API 侧启动辅助模块：
- `buildDesktopWindowLaunchPlan()`：根据平台、环境变量、候选浏览器存在性生成启动计划。
- `openStudioWindow()`：执行启动计划。

### `src/api/index.ts`
在 `startStudioServer()` 成功返回后调用 `openStudioWindow()`，默认打开 app mode 窗口。

### `main.ts`
根入口沿用同一窗口启动逻辑，避免根级 `bun:compile` 路线仍打开普通浏览器。

## Launch behavior

默认模式：
- Windows：优先使用 Edge app mode；找不到 Edge 时尝试 Chrome；都找不到则回退系统默认浏览器。
- macOS/Linux：预留 app mode 候选；不可用时回退系统默认浏览器。

环境变量：
- `NOVELFORK_NO_BROWSER=1`：不打开窗口。
- `NOVELFORK_WINDOW_MODE=none`：不打开窗口。
- `NOVELFORK_WINDOW_MODE=browser`：使用普通默认浏览器。
- `NOVELFORK_WINDOW_MODE=app` 或未设置：应用窗口模式。
- `NOVELFORK_BROWSER_PATH`：覆盖 app mode 浏览器路径。
- `NOVELFORK_DESKTOP_USER_DATA_DIR`：覆盖 app mode 独立浏览器数据目录。

## Risks

- 这不是完整原生 WebView 壳，进程仍来自 Edge/Chrome；但用户界面层已经是独立应用窗口。
- 如果用户系统缺少 app mode 浏览器，会回退到普通浏览器。
