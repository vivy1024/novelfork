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

[快速开始](#quick-start) · [架构](#architecture) · [变更日志](CHANGELOG.md) · [GitHub Releases](https://github.com/vivy1024/novelfork/releases)

---

## Highlights

- 🌌 **3D 结晶叙事记忆空间** — Canvas 2D 透视投影 · 测地线粒子网络 · 3D Fact Carousel
- 🧠 **叙事记忆引擎** — 8 通道本地检索 · Wave 算法 · Pending Events 审批 · 管理工具集
- 📚 **经纬 / Lore** — 静态设定库与动态记忆彻底分工 · Canon 保护 · retire 软下线
- ✍️ **写作管线** — scene.spec → pipeline.write → 对抗式审查 → S1–S4 门禁
- 🖥️ **IDE 写作工作台** — 三栏布局 · Tab · 搜索替换 · 经纬/章节编辑器
- 🔌 **多模型** — Anthropic / OpenAI / DeepSeek / Codex / 兼容 API
- 🔒 **本地优先** — 数据与密钥在本机；完整 Runtime 能力不随公开仓库分发

---

## Changelog（最近）

| 版本 | 日期 | 主题 |
|------|------|------|
| **v3.3.0** | 2026-08-01 | Writing Skills 取代旧 Preset/Beat · 叙事线审批闭环 · Runtime v0.5.18 兼容 |
| **v3.2.1** | 2026-07-23 | 公开仓库边界：Runtime 历史清理 · overlay 私有子仓库 · 本地发版门禁 |
| **v3.2.0** | 2026-07-21 | Runtime 产品化接入 · 叙事记忆管理工具 · Lore retire |
| **v3.0.0** | 2026-06-25 | 3D 结晶叙事记忆 · 经纬/记忆架构闭合 |
| **v2.x** | 2026-06 | 上下文修复 · IDE · 管线与质量机制 |

完整记录见 [CHANGELOG.md](CHANGELOG.md)。

---

## Requirements

| 依赖 | 版本 | 说明 |
|------|------|------|
| **Bun** | ≥ 1.3 | 运行时与 Windows 单文件编译 |
| **pnpm** | 10.x | 工作区依赖安装 |
| **OS** | Windows x64 | 主要支持与发版平台 |
| **浏览器** | Chrome / Edge | 本地 Web 工作台 |

> 从公开源码完整跑通本地产品，需要维护者私有的 Runtime 物化树与 overlay 子仓库权限。普通用户请使用 **Releases 中的 Windows EXE**。

---

## Installation

### Option 1: 下载 EXE（推荐）

从 [GitHub Releases](https://github.com/vivy1024/novelfork/releases/latest) 下载：

```text
novelfork-vX.Y.Z-windows-x64.exe
```

双击运行，无需安装。

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
pnpm test          # 工作区测试（需本地 Runtime 时再跑完整能力）
pnpm build         # 产品前端等
pnpm compile       # Windows x64 EXE
# 用生成的 EXE 做功能核验后再上传 Release 资产
```

常用命令：

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 开发入口 |
| `pnpm dev:frontend` | 仅 Studio Vite |
| `pnpm build` | 产品前端构建 |
| `pnpm compile` | Windows 单文件 EXE |
| `pnpm typecheck` | 各包类型检查 |
| `pnpm test` | 递归测试 |

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
