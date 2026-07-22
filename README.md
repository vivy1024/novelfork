<p align="center">
  <h1 align="center">NovelFork Studio</h1>
  <p align="center">
    AI 驱动的网文创作工作台 — 本地优先、经纬驱动、插件化架构
  </p>
  <p align="center">
    <a href="https://github.com/vivy1024/novelfork/releases/latest"><img src="https://img.shields.io/github/v/release/vivy1024/novelfork?style=flat-square&color=blue" alt="Version"></a>
    <img src="https://img.shields.io/badge/platform-Windows%20x64-0078d4?style=flat-square" alt="Platform">
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License"></a>
    <img src="https://img.shields.io/badge/runtime-Bun%20≥1.2-f472b6?style=flat-square" alt="Bun">
    <img src="https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square" alt="TypeScript">
  </p>
</p>

<!-- TODO: Add screenshot here — recommended 1200x700, showing the writing workbench with narrator conversation -->

---

## Navigation

[中文文档](#快速开始) · [技术文档](docs/README.md) · [CodeWiki](docs/01-codewiki/) · [GitHub Releases](https://github.com/vivy1024/novelfork/releases)

---

## Highlights

- 🌌 **3D 结晶叙事记忆空间** — 纯 Canvas 2D 透视投影 · 测地线粒子网络 · 3D Fact Carousel · 零 WebGL 依赖
- 🧠 **叙事记忆引擎** — 8 通道本地检索 · Wave 终局算法（EPA/spike routing/geodesic rerank）· Pending Events 审批
- 📚 **经纬/记忆架构闭合** — 经纬只保留静态 Lore · 动态 Memory 负责关系/时间线/伏笔 · AI 写 canon 强制 evidence · 12 条动态设定迁移
- ✍️ **写作管线 v2** — scene.spec 蓝图 → pipeline.write 生成 → 对抗式 3 视角审查 → S1-S4 门禁
- 🖥️ **IDE 写作工作台** — 三栏布局 + Tab 拖拽 + Ctrl+F 搜索 + 经纬 TipTap 编辑器 + Minimap
- 📊 **上下文管理** — 四字段 token 统一（对齐 Codex/Claude CLI）+ 分层压缩 + 有效窗口扣输出预留
- ⚡ **推理强度系统** — 6 档（none~xhigh）+ 三级优先级（叙述者>供应商>全局）+ 全协议适配
- 🔒 **安全层** — Secret Detector (20+ 模式) + 路径沙箱 + 24 条危险命令规则
- 🔌 **多模型** — Anthropic / DeepSeek / OpenAI / 任何兼容 API，自动 fallback + 自动重试规则

---

## Changelog

### Recent Releases

| 版本 | 日期 | 主题 | 亮点 |
|------|------|------|------|
| **v3.0.0** | 2026-06-25 | 3D 结晶叙事记忆空间 + 架构边界闭合 | 3D Crystalline Orb · 叙事记忆引擎（8 通道 + Wave 算法）· 经纬/记忆边界 · TipTap 吞字修复 · 5 死 Agent 删除 |
| **v2.2.0** | 2026-06-22 | 候选稿废除 + 前端 Bug 修复 + 对话面板改进 | 候选稿/草稿清理 · 24 个前端 bug · 5 个对话面板修复 · 14 spec 归档 |
| **v2.1.0** | 2026-06-22 | 上下文根因修复 + 推理强度 + IDE 打磨 | 四字段 token 统一 · 删除 413 救援 · 6 档推理强度 · 20 项 IDE · 自动重试接线 |
| **v2.0.0** | 2026-06-21 | Bible→Jingwei 重命名 + IDE 工作台 | 5 个死 agent 删除 · bible 路由清理 · IDE 三栏布局 · Command Palette · Writing Resource 文件存储 |
| **v1.11.0** | 2026-06-18 | Agent Harness 全维度强化 | max_output 恢复 · model fallback · budget pressure 3 级 · Secret Detector · blocking hooks · 规则式记忆提取 · content-replacement · coordinator-prompt · turn-profiler |
| **v1.10.0** | 2026-06-15 | 代码库精简与质量提升 | 全库审计 811 文件 · 修复 5 个严重 bug · 删除 4800+ 行废弃代码 · RuntimeStatePanel · CoreShiftPanel · 伏笔看板/日进度接入 |
| **v1.9.0** | 2026-06-14 | 网文质量机制补全 | pipeline.write 崩溃修复 · 对抗式 3 视角审查 · S1-S4 门禁 · 资源账本验算 · 知识边界校验 · 结构化时间线 · 动态词频 |

<details>
<summary>Earlier versions (v1.8.0 and below)</summary>

| 版本 | 日期 | 主题 |
|------|------|------|
| v1.8.0 | 2026-06-10 | resource.manage 工具 + 资源树子目录 |
| v1.7.0 | 2026-06-08 | 小说工具合并精简 (27→24) |
| v1.6.0 | 2026-06-08 | 插件 UI 注册机制 |
| v1.5.0 | 2026-06-03 | System Prompt 架构重写 |
| v1.4.0 | 2026-06-02 | Recall FTS5 + TaskCreate 持久化 |
| v1.0.0 | 2026-05-27 | 写作管线 v2 + 经纬重做 |
| v0.8.0 | 2026-05-16 | 上下文可见性系统 + Artifact 浮现 |
| v0.6.0 | 2026-05-15 | 插件架构真拆分 + 经纬系统重做 |
| v0.1.0 | 2026-05-11 | 首个正式发布 |

[完整变更日志 →](CHANGELOG.md)

</details>

---

## Features

<table>
<tr>
<td width="50%" valign="top">

### 🧠 Agent Runtime

生产级 Turn Loop 引擎，对标 Claude Code。

- max_output_tokens 截断自动续写（3 次 + escalation 64K）
- 主模型 rate_limit/503 自动切备用模型
- Budget pressure 三级渐进提醒（70%/80%/92%）
- 6 档推理强度（none/minimal/low/medium/high/xhigh）
- 三级优先级：叙述者 > 供应商 > 全局默认
- 上下文四字段 token 统一（对齐 Codex/Claude CLI）
- 自动重试规则（HTTP 状态码 + 关键词匹配 + 指数退避）

</td>
<td width="50%" valign="top">

### 📚 经纬 / Lore 系统

作者显式维护的静态设定库，与动态叙事记忆彻底分工。

- 静态 Lore：人物、地点、势力、世界规则、物品、术语、作者备注
- `lore.read` 默认排除 archived / draft / needs-review
- `lore.write` 写 canon/rules 强制 reason + source + evidence
- TipTap 富文本编辑器 + 预览/编辑切换
- 经纬 AI 视角支持多章节交互式预览
- 动态关系、时间线、伏笔状态统一迁移到 Narrative Memory

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🌌 3D 结晶叙事记忆空间

纯 Canvas 2D 透视投影，零 WebGL 依赖，集显稳定 60 FPS。

- 3D 星尘宇宙背景（80 颗呼吸闪烁星尘）
- 测地线粒子网络（Spike Routing 能量流 + 节点霓虹脉冲）
- 3D Fact Carousel（滚轮/键盘阻尼旋转 + 双击翻牌查证据）
- 叙事记忆面板（ContextCard 诊断 + Pending Events 审批）
- 完整记忆图谱工作区（关系图/时间线/伏笔网络/矛盾地图）

</td>
<td width="50%" valign="top">

### 🧠 叙事记忆引擎

动态叙事记忆系统，写作前自动召回 ContextCard。

- 8 通道本地检索（facts/hard/hooks/scene-spec/semantic/state/style/timeline）
- Wave 终局算法（EPA + residual pyramid + spike routing + geodesic rerank）
- Semantic exact cosine 中期层（默认关闭，不引入 vector DB）
- NarrativeEvent 事件日志（canon/高风险事件默认 pending 防 LLM 污染）
- recall@budget benchmark（10 条 fixture 对比 5 种召回策略）

</td>
</tr>
<tr>
<td width="50%" valign="top">

### ✍️ 写作管线

scene.spec 蓝图驱动，多 Agent 协作生成。

- scene.spec → pipeline.write → 对抗式审查 → 门禁
- Writer: creative → observer → settler 三段式
- 对抗式 3 视角审查（连续性/叙事/文本独立跑）
- S1-S4 严重度门禁（S1 阻断 / S2 修订 / S3-4 警告）
- 选中文本 AI 操作（续写/润色/改写/扩写，见章节编辑器 BubbleMenu）

</td>
<td width="50%" valign="top">

### 🖥️ IDE 写作工作台

三栏布局，对标 VS Code。

- ActivityBar + Sidebar + Editor(Tabs) + ChatPanel
- Tab 拖拽排序 + editor-state-cache（切换保滚动位置）
- Ctrl+F 搜索 + Ctrl+H 替换（自研 SearchExtension）
- Command Palette（Ctrl+Shift+P）+ Quick Open（fuzzysort）
- 全局跨文件搜索 + 面包屑可点击跳转
- Minimap + 段落折叠 + 底部面板（问题/输出）

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🔒 安全 & 记忆

多层安全防护 + 零成本记忆提取。

- Secret Detector: 20+ 模式自动脱敏（AWS/GitHub/JWT…）
- 路径沙箱 + 24 条危险命令规则（fork bomb/shutdown…）
- 规则式记忆提取（中英双语模式匹配）
- 30 天半衰期指数衰减 + 自动修剪
- context.md 回合结束自动更新

</td>
<td width="50%" valign="top">

### 🛠️ 开发体验

调试利器，定位问题快人一步。

- `PROMPT_DUMP=1` 完整 LLM 请求体转储
- turn-profiler 每轮计时打点
- 结构化日志（generate/tool/abort/continue）
- Skill activation 按文件类型动态启用
- Codegraph: 811 文件 / 4006 符号导航图

</td>
</tr>
</table>

---

## Requirements

| 依赖 | 版本 | 说明 |
|------|------|------|
| **Bun** | ≥ 1.3 | 运行时 & 包管理器 |
| **OS** | Windows x64 | 主要支持平台 |
| | macOS / Linux | 未经完整测试，理论可用 |
| **浏览器** | Chrome / Edge | 访问本地 Web 工作台 |

---

## Installation

### Option 1: 下载 exe（推荐）

从 [GitHub Releases](https://github.com/vivy1024/novelfork/releases/latest) 下载最新 `novelfork-vX.Y.Z-windows-x64.exe`，双击即可运行，无需安装。

### Option 2: 从源码构建

```bash
git clone https://github.com/vivy1024/novelfork.git
cd novelfork
pnpm install
pnpm dev              # 开发模式，热重载
```

依赖安装统一使用 PNPM；Bun 仅用于运行时与产品单文件编译。

编译单文件 exe：

```bash
pnpm compile
# 产物 → dist/novelfork-vX.Y.Z-windows-x64.exe
```

---

## Quick Start

```
┌─────────────────────────────────────────────────────────────┐
│  1. 启动        双击 exe 或 pnpm dev                          │
│  2. 打开浏览器   http://localhost:4567                         │
│  3. 配置供应商   设置 → AI 供应商 → 添加 API Key               │
│  4. 开始创作    新建书籍 或 直接开启叙述者对话                   │
└─────────────────────────────────────────────────────────────┘
```

支持的 AI 供应商（5 种协议）：

| 供应商 | 协议 | 推理强度 | 说明 |
|--------|------|---------|------|
| Anthropic | Anthropic 原生 | effort→budget_tokens | Claude Opus 4.8 / Fable 5 等 |
| DeepSeek | OpenAI/Anthropic 兼容 | reasoning_effort / output_config | v4-pro 等 |
| OpenAI | Responses | reasoning.effort | GPT-5 等 |
| Codex | Codex | reasoning.effort（已接） | ChatGPT 账号反代 |
| 自定义 | Completions | reasoning_effort 顶层 | 任何 OpenAI 兼容 API |

---

## Writing Pipeline

NovelFork 的写作管线 v2 是核心创作链路，由多个专业 Agent 协作完成：

```
cockpit.snapshot ─→ lore.read(brief) ─→ memory.read(write) ─→ pgi.ask ─→ AskUserQuestion
                                                                              │
    ┌─────────────────────────────────────────────────────────────────────────┘
    ▼
scene.spec ─→ lore.read(category) + memory.read ─→ pipeline.write ─→ 正式章节结果 ─→ memory.events
                                              │
                                    ┌─────────┼─────────┐
                                    ▼         ▼         ▼
                              连续性审查  叙事审查   文本审查
                                    └─────────┼─────────┘
                                              ▼
                                      S1-S4 严重度门禁
                                              │
                              S1 阻断 ← ─ ─ ─ ┼ ─ ─ ─ → S3/S4 通过
                              S2 触发修订      ▼
                                      正式章节结果等待用户审阅
```

### 核心小说工具

| 工具 | 功能 | 分类 |
|------|------|------|
| `cockpit.snapshot` | 进度/伏笔/章节结果全景快照 | 常驻 |
| `lore.read` | 经纬读取（scope: brief/category/search） | 常驻 |
| `lore.write` | 经纬写入（layer 分层 + Canon 保护） | 常驻 |
| `memory.read` | 叙事记忆召回（ContextCard + 8 通道） | 常驻 |
| `memory.graph` | 记忆图谱读取（关系/时间线/弧线/伏笔/矛盾） | 常驻 |
| `memory.events` | Pending NarrativeEvents 管理 | 常驻 |
| `pgi.ask` | PGI 追问（生成问题 → 用户确认方向） | 常驻 |
| `scene.spec` | 结构化写作蓝图 | 常驻 |
| `pipeline.write` | 生成管线（Writer → Audit → Revise） | 常驻 |
| `chapter.read` | 读取章节正文 | 常驻 |
| `chapter.audit` | 章节质量审计 | 常驻 |
| `resource.manage` | 资源状态管理（list/archive/restore/delete） | 常驻 |
| `presets.read/write` | 预设查看与配置 | 常驻 |
| `beat.read/write` | 节拍查看与配置 | 常驻 |
| `hooks.manage` | 伏笔生命周期管理 | 常驻 |
| `pipeline.revise` | 定点修订 | 按需 |
| `rewrite.segment` | 选段改写（去 AI 味/扩写/缩写） | 按需 |
| `style.import` | 文风仿写导入 | 按需 |
| `outline.suggest_next` | 下一章建议 | 按需 |

---

## Project Structure

```
novelfork/
├── packages/
│   ├── core/                 # Storage / LLM / State / Plugins
│   ├── studio/               # Web 工作台 (React 19 + Hono + Vite)
│   │   └── src/api/lib/      # Agent Runtime 核心
│   │       ├── agent-turn-runtime.ts      # Turn Loop 主循环
│   │       ├── provider-adapters/         # 5 协议适配器
│   │       ├── compact/                   # 上下文压缩引擎
│   │       ├── token-utils.ts             # Token 统一计算（四字段）
│   │       ├── security/                  # Secret Detector + 路径沙箱
│   │       └── session-chat-service.ts    # 会话运行时
│   └── novel-plugin/         # 小说领域插件
│       ├── engine/           # Agent / Jingwei / Pipeline / Filter
│       │   ├── narrative-memory/         # 叙事记忆引擎（20+ 模块）
│       │   │   ├── build-narrative-context.ts  # ContextCard 召回
│       │   │   ├── channels/              # 8 通道本地检索
│       │   │   └── wave/                  # Wave 终局算法（EPA/spike routing）
│       │   └── jingwei/                   # 经纬静态 Lore
│       ├── routes/           # HTTP API 路由
│       ├── handlers/         # 业务服务层
│       └── pages/            # 前端组件
│           ├── writing-workbench/         # 写作工作台（40+ 组件）
│           │   ├── ide/                   # IDE 布局（11 组件）
│           │   │   ├── IdeWorkbench.tsx    # 三栏主布局
│           │   │   ├── EditorTabs.tsx      # Tab 拖拽排序
│           │   │   ├── command-palette.tsx  # 命令面板
│           │   │   ├── SearchBar.tsx       # Ctrl+F 搜索
│           │   │   └── SearchExtension.ts  # TipTap 搜索扩展
│           │   ├── jingwei/
│           │   │   └── Crystalline3DView.tsx  # 3D 结晶叙事记忆空间
│           │   ├── NarrativeMemoryPanel.tsx     # 叙事记忆面板
│           │   ├── NarrativeMemoryGraphWorkspace.tsx  # 完整记忆图谱工作区
│           │   └── resource-viewers/       # 编辑器
│           │       ├── ChapterEditor.tsx   # 章节编辑器（TipTap + BubbleMenu）
│           │       └── EditorMinimap.tsx   # Minimap
├── docs/                     # 技术文档
├── dist/                     # 编译产物输出
└── scripts/                  # 构建 & Codegraph 脚本
```

---

## Build

```bash
pnpm install                             # 安装依赖
pnpm dev                                 # 开发模式（热重载）
pnpm typecheck                           # 全包类型检查
pnpm compile                             # 编译单文件 exe
pnpm codegraph                           # 生成代码导航图
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     NovelFork Studio                             │
│              React 19 + Hono + Vite + SQLite                    │
├─────────────────────────────────────────────────────────────────┤
│                   IDE Writing Workbench                           │
│  ┌───────────┐  ┌──────────────┐  ┌───────────────────────┐    │
│  │ActivityBar│  │   Sidebar    │  │   Editor (Tabs)       │    │
│  │ files     │  │ Explorer     │  │ TipTap + SearchBar    │    │
│  │ search    │  │ Jingwei      │  │ Minimap + Folding     │    │
│  │ tools     │  │ Tools        │  │ BubbleMenu (AI)       │    │
│  │ settings  │  │              │  │ CommandPalette        │    │
│  └───────────┘  └──────────────┘  └───────────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│                      Agent Runtime                               │
│  ┌───────────┐  ┌──────────────┐  ┌───────────────────────┐    │
│  │ Turn Loop │  │   Security   │  │    Context Engine     │    │
│  │           │  │              │  │                       │    │
│  │ generate  │  │ secret-det.  │  │ 四字段 token 统一     │    │
│  │ tool_use  │  │ path-sandbox │  │ 有效窗口扣输出预留    │    │
│  │ execute   │  │ cmd-rules    │  │ budget pressure 3级   │    │
│  │ loop/stop │  │ YOLO reflect │  │ auto-compact          │    │
│  └───────────┘  └──────────────┘  └───────────────────────┘    │
│  ┌───────────┐  ┌──────────────┐  ┌───────────────────────┐    │
│  │  Memory   │  │ Multi-Agent  │  │   Provider Adapters   │    │
│  │           │  │              │  │                       │    │
│  │ extractor │  │ coordinator  │  │ Anthropic (5 protocol)│    │
│  │ aging     │  │ peer-msg     │  │ 6档推理强度+3级优先级 │    │
│  │ context.md│  │ streaming-ex │  │ temperature/maxOutput │    │
│  └───────────┘  └──────────────┘  └───────────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│                      Plugin Layer                                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ novel-plugin: 经纬 / 写作管线 / 审查 / 预设 / 驾驶舱     │    │
│  └─────────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│                        Core                                      │
│       Storage (SQLite)  ·  LLM Client  ·  State Machine         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Configuration

| 项目 | 位置 |
|------|------|
| 运行时存储 | `%APPDATA%/novelfork/` (Windows) |
| 用户配置 | `user-config.json`（运行时存储目录内） |
| 应用设置 | 浏览器内设置页覆盖所有配置项 |
| 项目记忆 | `.narrafork/memory/`（工作目录内） |
| Prompt 转储 | `.narrafork/prompt-dumps/`（工作目录内） |

### 环境变量

| 变量 | 说明 |
|------|------|
| `PROMPT_DUMP=1` | 开启 LLM 请求体转储（调试用） |
| `PROMPT_DUMP_DIR=path` | 自定义转储目录（默认 .narrafork/prompt-dumps/） |
| `PORT=4567` | 自定义监听端口 |

### 设置页面

应用内置完整的设置管理界面，覆盖以下配置维度：

- **AI 供应商** — 多供应商管理 + 模型池 + 默认推理强度 + 上下文窗口配置提醒
- **Agent 行为** — 权限模式 / YOLO 模式 / 工具限制 / 子代理模型 / 全局推理强度
- **自动重试** — 规则引擎（HTTP 状态码 + 关键词匹配 + 指数退避 + 抖动）
- **外观** — 亮色/暗色/OLED 纯黑 + 字体 + 代码主题
- **安全** — 目录白名单/黑名单 + 命令白名单/黑名单
- **通知** — 桌面通知 + 钉钉/飞书 Webhook
- **服务器** — 端口 / 监听地址 / TLS 配置

---

## Tech Stack

| 层 | 技术 |
|---|---|
| 语言 | TypeScript 5.x (strict) |
| 运行时 | Bun ≥ 1.2 |
| 前端 | React 19 + Vite + TailwindCSS + shadcn/ui |
| 后端 | Hono (HTTP) + WebSocket (实时) |
| 数据库 | SQLite (bun:sqlite) + FTS5 全文索引 |
| 桌面 | Bun compile → 单文件 exe + Edge/Chrome app mode |
| AI | Anthropic / OpenAI / DeepSeek 多协议适配 |
| 可视化 | react-flow (图谱) + recharts (趋势) |

---

## Contributing

欢迎贡献代码、提交 Issue 或参与讨论。

```bash
# Fork → Clone → Branch
git checkout -b feat/your-feature

# 开发
pnpm install && pnpm dev

# 类型检查确认无误
pnpm typecheck

# 提交（遵循 conventional commits）
git commit -m "feat(scope): description"
```

---

## License

[MIT](LICENSE)

---

<p align="center">
  Built with Bun + React 19 + Hono + SQLite<br>
  <sub>by <a href="https://github.com/vivy1024">vivy1024</a></sub>
</p>
