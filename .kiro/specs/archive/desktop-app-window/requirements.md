# Requirements — Desktop App Window

## Goal
NovelFork 的单文件启动入口应默认呈现为 NarraFork 风格的桌面应用窗口：底层仍由本地 Hono/Bun 服务提供前端和 API，但用户不再看到浏览器地址栏、标签页或普通浏览器外壳。

## Requirements

### R1 应用窗口启动
- WHEN 用户运行 `novelfork.exe` THEN 系统 SHALL 启动本地 Studio 服务并打开一个无浏览器 UI 的应用窗口。
- WHEN 应用窗口打开 THEN 它 SHALL 加载当前 Studio 地址，例如 `http://localhost:4567`。

### R2 单 exe 路线优先
- THE SYSTEM SHALL NOT 引入 Electron/Tauri 等新的桌面壳作为本次实现的硬依赖。
- THE SYSTEM SHALL 继续兼容当前 `bun compile` 单文件分发路线。

### R3 可禁用与可回退
- WHEN `NOVELFORK_NO_BROWSER=1` 或窗口模式为 `none` THEN 系统 SHALL 只启动服务，不打开窗口。
- WHEN 应用窗口浏览器不可用 THEN 系统 SHALL 回退到系统默认浏览器打开 Studio。

### R4 开发与测试可验证
- THE SYSTEM SHALL 将窗口启动命令解析逻辑拆成可单元测试的纯函数。
- THE SYSTEM SHALL 保留现有 API 与嵌入静态资源启动行为。
