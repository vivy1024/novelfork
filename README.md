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

- 🧠 **三层知识体系** — 经纬（静态设定：角色/世界观/力量/卷纲/伏笔）· 叙事记忆（动态事实：时间线/事件/状态）· 写作技能（通用方法论：文风/节奏/钩子/平台），写前查、写后沉淀、循环治愈长篇遗忘
- 🗺️ **剧情线状态卡** — 从当前章有效事实按主体聚合"每条剧情线停在哪"，随写前上下文注入（宏观层轻量版）
- 📚 **经纬智能注入** — 关键词触发 · 章号可见窗口 · 关联条目一级级联 · 同组互斥 · Token 预算逐条降级
- ✍️ **写作管线 & 技能落地** — Runtime Agent 显式提交蓝图与正文 · 工具只校验落盘 · Writing Skills 物化 + 加载证据 + 写后合规校验
- 📋 **投稿风险自检** — 敏感词/AI 味/格式/连续性证据化汇总，带规则来源与原文定位，只供人工复核不替平台做结论
- 🖥️ **IDE 写作工作台** — 三栏布局 · Tab · 经纬侧栏（Markdown 导入 + AI 注入预览）
- 🔌 **多模型** — Anthropic / OpenAI / DeepSeek / Codex / NUG 反代 / 兼容 API
- 🔒 **本地优先** — 数据与密钥在本机；完整 Runtime 能力不随公开仓库分发

---

## Changelog（最近）

| 版本 | 日期 | 主题 |
|------|------|------|
| **v0.0.2** | 2026-08-14 | 投稿风险自检重构 · 叙事记忆全链路与图谱工作区 · 自研 nf-* 作品级技能 · 经纬侧栏工具条收敛 · 每日进度下线 |
| **v0.0.1** | 2026-08-12 | 版本自 v3.6.1 重起算 · 经纬中文 Bigram FTS5 · 写作管线收敛为 Runtime Agent 单环 · loadedSkills 技能证据 · 旧 /api/ai/* 与内部调模型工具下线 |
| **v3.6.x 及更早** | 2026-05 至 2026-08 | 长期开发 Beta 期：Agent Runtime、经纬/叙事记忆架构、Writing Skills、七平台编译、写作工作台（详见 CHANGELOG） |

完整记录见 [CHANGELOG.md](CHANGELOG.md)。

## 版本演进

版本号自 **v0.0.1** 重新起算：长期开发暴露出经纬检索、写作管线与 Runtime 边界的基础缺陷，继续沿用 v3.x 会错误传达产品成熟度。历史 v1.x–v3.x 追溯视为 Beta：

- **Beta v1.0–v3.6**：完成 Agent Runtime 对齐、经纬与叙事记忆架构、Writing Skills 物化、S1–S4 门禁、七平台交叉编译与写作工作台重构（详见 CHANGELOG）。
- **v0.0.1**：收敛写作管线为 Runtime Agent 单环（Agent 显式提交蓝图与正文，工具只校验落盘）；Skill 生效证据改为 Runtime 注入的 loadedSkills；下线旧 /api/ai/* 路由与内部调模型工具；经纬中文 Bigram FTS5 检索；正式章节文件权威源与遗留 accepted 资源安全物化。
- **v0.0.2**：
  - **投稿风险自检**：重定位为客观证据汇总，移除 AI 率估算与保存硬阻断；
  - **叙事记忆全链路**：LLM 抽取、作者编辑、纰漏检测、同章结算幂等与完整记忆图谱工作区；
  - **自研写作技能**：收敛为作品级 `nf-*` 体系，经纬 UI 收敛至侧栏工具条并支持关联级联与剧情线状态卡；
  - **架构与包边界**：下线每日打卡与重复配置，迁回核心测试，全平台 7 产物可靠发布。


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
写前：write.preflight → lore.read（经纬静态）→ memory.*（叙事记忆动态）→ Skill 读取写作技能
        ↓
写作：Runtime Agent 显式提交 scene.spec 蓝图（工具校验）→ 生成正文提交 pipeline.write（校验+落盘+结算）
        ↓
写后：叙事记忆自动结算沉淀 → writing-skills.check_compliance 技能合规校验 → 新设定 lore.write 待作者确认
```

核心领域工具包括：`lore.*`、`memory.*`、`write.preflight`、`scene.spec`、`pipeline.write`、`chapter.*`、`rewrite.apply`、`writing-skills.*`、`hooks.manage`、`outline.volume`、`arc.character`、`book.dissect`、`publish.check`（投稿风险自检）等（以当前 `novel-plugin` 实现为准）。

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
