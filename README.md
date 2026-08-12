<p align="center">
  <h1 align="center">NovelFork Studio</h1>
  <p align="center">
    AI 驱动的网文创作工作台 — 本地优先、经纬驱动、插件化架构
  </p>
  <p align="center">
    <a href="https://github.com/vivy1024/novelfork/releases/latest"><img src="https://img.shields.io/github/v/release/vivy1024/novelfork?style=flat-square&color=blue" alt="Version"></a>
    <img src="https://img.shields.io/badge/platform-Windows%20x64-0078d4?style=flat-square" alt="Platform">
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License"></a>
    <img src="https://img.shields.io/badge/runtime-Bun%20≥1.3-f472b6?style=flat-square" alt="Bun">
    <img src="https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square" alt="TypeScript">
  </p>
</p>

---

## Navigation

[快速开始](#quick-start) · [版本演进](#版本演进) · [架构](#architecture) · [变更日志](CHANGELOG.md) · [GitHub Releases](https://github.com/vivy1024/novelfork/releases)

---

## Highlights

- 🌌 **3D 结晶叙事记忆空间** — Canvas 2D 透视投影 · 测地线粒子网络 · 3D Fact Carousel
- 🧠 **叙事记忆引擎** — 8 通道本地检索 · Wave 算法 · Pending Events 审批 · 管理工具集
- 📚 **经纬 / Lore** — 静态设定库与动态记忆彻底分工 · Canon 保护 · retire 软下线
- ✍️ **写作管线 & 技能落地** — Writing Skill 文件自动发现 (.novelfork/skills/) · scene.spec → pipeline.write · S1–S4 门禁
- 🛠️ **套路与设置** — Skill 文件树折叠浏览 & 弹窗预览 · 供应商单行表格与隐藏模型批量切换 · 脏检测保存 (Dirty Bar) · 消息网关微信扫码 · Web xterm.js 交互终端 · 6 步 SetupWizard
- 🖥️ **IDE 写作工作台** — 三栏布局 · Tab · 侧栏可配置显示/收纳 · 经纬/章节/工具面板
- 🔌 **多模型** — Anthropic / OpenAI / DeepSeek / Codex / NUG 反代 / 兼容 API
- 🔒 **本地优先** — 数据与密钥在本机；完整 Runtime 能力不随公开仓库分发

---

## Changelog（最近）

| 版本 | 日期 | 主题 |
|------|------|------|
| **v3.6.0** | 2026-08-08 | 经纬权威源收敛 · 写作工作台重构 · 工具结果 Renderer · Runtime Overlay 与七平台发版门禁 |
| **v3.5.1** | 2026-08-06 | Runtime v0.5.21 · 子代理压缩重启与 400 根因修复 · Writing Skills 硬门禁 |
| **v3.5.0** | 2026-08-06 | 写作链路根因修复 · Writing Skills 物化 · 多平台编译 · 隔离验证 |
| **v3.4.0** | 2026-08-06 | 七平台交叉编译 · Runtime Overlay 对齐 · 设置与 Provider 体验统一 |
| **v3.3.x** | 2026-08-01 | Skill 文件树与物化 · 网关/终端/SetupWizard · Runtime v0.5.18 |
| **v3.2.x** | 2026-07-21 | Runtime 产品化 · 叙事记忆管理 · 公开/私有源码边界 |
| **v3.0.0** | 2026-06-25 | 3D 结晶叙事记忆 · 经纬/记忆架构闭合 |
| **v1.x–v2.x** | 2026-05 至 2026-06 | Agent Runtime、经纬、IDE、资源系统、上下文与质量管线持续重构 |

完整记录见 [CHANGELOG.md](CHANGELOG.md)。

## 版本演进

从 `v1.0.0` 到 `v3.6.0`，NovelFork 的主要演进可以概括为：

- **v1.0–v1.4：基础 Runtime 与小说工作台**：完成独立项目发布、Agent Runtime 对齐、经纬与候选稿链路、PGI/UserQuestionGate、Recall、TaskCreate、ToolSearch 与基础安全隔离。
- **v1.5–v1.8：约束写作与资源系统**：重写 System Prompt，统一工具命名与分层，建立 Scene Spec、Pipeline Write、Canon/Dynamic/Reference 分层、统一资源版本系统、IDE 工作台和插件 UI 注册。
- **v1.9–v2.2：质量管线与上下文引擎**：加入对抗式审查、S1–S4 严重度门禁、资源账本、知识边界、时间线、伏笔追踪、上下文预算、推理强度和 Narrative Memory/Wave 检索。
- **v3.0–v3.2：叙事记忆与 Runtime 产品化**：上线 3D 结晶记忆空间，收紧经纬与叙事记忆边界，接入私有 NarraFork Runtime，增加记忆管理工具，并确立公开产品树与私有 Runtime/Overlay 边界。
- **v3.3–v3.5：技能化写作与跨平台交付**：Writing Skills 取代旧 Preset/Beat 入口并物化到作品目录，补齐网关、Web 终端、SetupWizard、Provider 设置与七平台交叉编译，强化写前/写后门禁、Runtime v0.5.21 和隔离验证。
- **v3.6.0：权威源收敛与工作台重构**：统一经纬、章节摘要、写作资源和叙事记忆的权威路径，重构写作工作台与工具结果 Renderer，强化 Core/Bridge/Overlay 契约，并通过全量测试、Parity、七平台编译和当次 EXE 核验。

---

## Requirements

| 依赖 | 版本 | 说明 |
|------|------|------|
| **Bun** | ≥ 1.3 | 运行时与 Windows 单文件编译 |
| **pnpm** | 10.x | 工作区依赖安装 |
| **OS** | Windows x64 / Linux x64 / Linux arm64 / macOS x64 / macOS arm64 | v3.6.0 提供七平台产物；Windows x64 为本机主要核验平台 |
| **浏览器** | Chrome / Edge | 本地 Web 工作台 |

> 从公开源码完整跑通本地产品，需要维护者私有的 Runtime 物化树与 overlay 子仓库权限。普通用户请使用 **Releases 中的 Windows EXE**。

---

## Installation

### Option 1: 下载 EXE（推荐）

从 [GitHub Releases](https://github.com/vivy1024/novelfork/releases/latest) 下载单个平台文件，或下载七平台统一压缩包：

```text
novelfork-vX.Y.Z-7-platforms.zip
novelfork-vX.Y.Z-windows-x64.exe
novelfork-vX.Y.Z-windows-x64-baseline.exe
novelfork-vX.Y.Z-linux-x64
novelfork-vX.Y.Z-linux-x64-baseline
novelfork-vX.Y.Z-linux-arm64
novelfork-vX.Y.Z-macos-arm64
novelfork-vX.Y.Z-macos-x64
```

Windows 用户优先选择 `windows-x64.exe`；不支持 AVX2 的旧 CPU 或部分虚拟机选择 `windows-x64-baseline.exe`。每个产物旁有 `.sha256` 文件，Release 同时提供聚合校验文件。

双击 Windows EXE 运行，无需安装。

### Option 2: 源码开发（维护者）

```bash
git clone https://github.com/vivy1024/novelfork.git
cd novelfork

# 私有 overlay 子仓库（需要仓库权限）
git submodule update --init --recursive

# 本地需已存在可运行的 Runtime 物化树：
# packages/narrafork-runtime-private/  （Git 忽略，不随 clone 提供）

pnpm install
pnpm dev              # 开发模式
```

编译 Windows 产物：

```bash
pnpm compile
# → dist/novelfork-vX.Y.Z-windows-x64.exe
```

---

## Quick Start

```text
1. 启动        双击 EXE 或维护者环境 pnpm dev
2. 打开浏览器  本地工作台（默认由 Runtime / 产品入口提供）
3. 配置供应商  设置 → AI 供应商 → API Key
4. 开始创作    新建书籍 或 开启叙述者对话
```

---

## Architecture

NovelFork **不**在产品层平行实现第二套通用 Agent 引擎；Agent Loop、权限、会话、工具循环与 WebSocket 由 **NarraFork Runtime** 承担。公开仓库只包含产品代码与窄契约。

```text
NovelFork Studio（产品壳）
  ├─ 写作工作台 / 书籍 / 章节 / Lore UI
  ├─ 嵌入叙述者面板（运行时复用 Runtime 宿主）
  └─ /api · WebSocket → Runtime

NarraFork Runtime（本地 ignore 物化树 + 私有 overlay 子仓库）
  ├─ Agent Loop · Provider · 权限 · 会话 · 工具 · WebSocket
  └─ Product Host SPI → 调用产品能力

NovelFork Product Runtime + Novel Plugin + Core
  ├─ 可信书籍绑定 · 产品路由 · 产品权限
  └─ 章节 · Lore · Narrative Memory · 写作业务
```

### 公开仓库包含什么

| 路径 | 说明 | Git |
|------|------|-----|
| `packages/core/` | 通用基础设施 | 公开跟踪 |
| `packages/studio/` | 产品前端 | 公开跟踪 |
| `packages/novel-plugin/` | 小说领域插件 | 公开跟踪 |
| `packages/novelfork-product-runtime/` | 产品 Runtime 适配 | 公开跟踪 |
| `packages/narrafork-runtime-bridge/` | 与 Runtime 的窄契约 | 公开跟踪 |
| `packages/fitness-plugin/` | 示例插件 | 公开跟踪 |
| `packages/narrafork-runtime-overlay/` | Runtime 适配补丁 / 嵌入面板 | **私有 submodule** |
| `packages/narrafork-runtime-private/` | 完整可运行 Runtime 树 | **本地 ignore** |

### Project Structure

```text
novelfork/
├── packages/
│   ├── core/
│   ├── studio/
│   ├── novel-plugin/
│   ├── novelfork-product-runtime/
│   ├── narrafork-runtime-bridge/
│   ├── fitness-plugin/
│   ├── narrafork-runtime-overlay/   # private submodule
│   └── narrafork-runtime-private/   # local only (gitignored)
├── scripts/
├── docs/
├── CLAUDE.md                        # 维护者开发约定
└── dist/                            # 本地编译产物
```

---

## Build & Release Gate

公开 GitHub Actions **默认不自动构建/测试完整产品**（需私有 Runtime）。发版门禁在维护者本机：

```bash
pnpm install
pnpm test             # 工作区全量测试（需本地 Runtime）
pnpm build            # 产品前端构建
pnpm compile:all      # 七平台交叉编译 + 聚合 SHA256
# 用当次生成的 Windows x64 EXE 做无头功能核验后再上传 Release
```

常用命令：

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 开发入口 |
| `pnpm dev:frontend` | 仅 Studio Vite |
| `pnpm build` | 产品前端构建 |
| `pnpm compile` | Windows x64 单文件 EXE |
| `pnpm compile:windows` | Windows x64 + baseline |
| `pnpm compile:linux` | Linux x64 + baseline + arm64 |
| `pnpm compile:macos` | macOS arm64 + x64 |
| `pnpm compile:all` | 全部 7 个平台并生成 `SHA256SUMS` |
| `pnpm typecheck` | 全量类型检查（发布/集成门禁） |
| `pnpm test` | 全量工作区测试（发布/集成门禁） |
| `pnpm typecheck:changed` | 按改动包及下游包执行增量类型检查；高影响改动自动回退全量 |
| `pnpm test:changed` | 按改动包执行增量测试；高影响改动自动回退全量 |
| `pnpm verify:changed` | 默认增量类型检查 + 测试；传 `--build` 时追加产品构建 |

---

## Writing Pipeline（概要）

```text
cockpit / lore / memory / pgi
        ↓
scene.spec → pipeline.write → 对抗审查 → S1–S4 门禁
        ↓
正式章节 · memory.events · 用户审阅
```

核心领域工具包括：`lore.*`、`memory.*`、`scene.spec`、`pipeline.write`、`chapter.*`、`resource.manage`、`presets.*`、`hooks.manage` 等（以当前 `novel-plugin` 实现为准）。

---

## Configuration

| 项目 | 位置 |
|------|------|
| 运行时数据 | 本机用户数据目录（Windows 常见为 AppData 下 NovelFork/NarraFork 相关路径） |
| 应用设置 | 应用内设置页 |
| 项目记忆 | 工作区 `.narrafork/`（若启用） |

---

## Tech Stack

| 层 | 技术 |
|---|---|
| 语言 | TypeScript 5.x |
| 运行时 | Bun ≥ 1.3 |
| 依赖安装 | pnpm workspace |
| 前端 | React 19 · Vite · Tailwind · shadcn/ui |
| 产品 HTTP | Hono（经 Runtime / Product Runtime） |
| 数据 | SQLite |
| 桌面交付 | Bun compile → 单文件 Windows EXE |

---

## Contributing

欢迎 Issue 与 PR（产品层）。涉及完整 Runtime 行为的改动需要私有 Runtime / overlay 权限，请先阅读根目录 [CLAUDE.md](CLAUDE.md)。

```bash
git checkout -b feat/your-feature
pnpm install
# 有本地 Runtime 时再完整跑 dev / test
pnpm typecheck
```

提交信息建议使用 conventional commits。

---

## License

[MIT](LICENSE)

---

<p align="center">
  Built with Bun + React + Hono + SQLite<br>
  <sub>by <a href="https://github.com/vivy1024">vivy1024</a></sub>
</p>
