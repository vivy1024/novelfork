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

[中文文档](#快速开始) · [技术架构](docs/04-架构与设计/01-系统架构总览.md) · [写作管线](docs/04-架构与设计/03-Agent写作管线.md) · [GitHub Releases](https://github.com/vivy1024/novelfork/releases)

---

## Highlights

- 🧠 **生产级 Agent Runtime** — max_output 自动恢复 + model fallback + 3 级 budget pressure + in-flight microcompact
- 📚 **经纬系统** — 16 分类 + Canon/Dynamic/Reference 三层 + SQLite 全文索引 + PGI 追问
- ✍️ **写作管线 v2** — scene.spec 蓝图 → pipeline.write 生成 → 对抗式 3 视角审查 → S1-S4 门禁
- 🔒 **安全层** — Secret Detector (20+ 模式) + 路径沙箱 + 24 条危险命令规则
- 💾 **智能记忆** — 规则式自动提取 + 30 天半衰期老化 + context.md 自动更新
- 🔌 **多模型** — Anthropic / DeepSeek / OpenAI / 任何兼容 API，自动 fallback
- 📊 **实时上下文** — API 报告 token + 新增消息复合估算，前端实时准确
- 🛠️ **开发者工具** — PROMPT_DUMP 请求体转储 + turn-profiler 计时 + 结构化日志

---

## Changelog

### Recent Releases

| 版本 | 日期 | 主题 | 亮点 |
|------|------|------|------|
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
- Blocking TurnComplete hooks — 验证失败自动修正
- 上下文溢出检测 → microcompact → 413 reactive

</td>
<td width="50%" valign="top">

### 📚 经纬系统

结构化世界观管理，16 分类全覆盖。

- Canon / Dynamic / Reference 三层数据分离
- SQLite FTS5 全文索引 + normalizeCategory 容错
- PGI 追问引擎（生成问题 → 用户确认方向）
- 可见性模型（global/tracked/nested + 章节窗口）
- react-flow 关系图谱 + 5 种视图模式

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
- 动态词频提示 + 长度归一化 + 写后校验

</td>
<td width="50%" valign="top">

### 🔒 安全 & 记忆

多层安全防护 + 零成本记忆提取。

- Secret Detector: 20+ 模式自动脱敏（AWS/GitHub/JWT…）
- 路径沙箱 + 24 条危险命令规则（fork bomb/shutdown…）
- 规则式记忆提取（中英双语模式匹配）
- 30 天半衰期指数衰减 + 自动修剪
- context.md 回合结束自动更新

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🤝 多 Agent 协调

coordinator + peer messaging + streaming executor。

- 有子代理时自动注入协调指令
- Subagent 间消息总线（TTL 10min / 50 条上限）
- Streaming tool executor（只读并行 / 写入独占）
- Content replacement: >8KB 工具结果存引用省 context
- Skill 条件激活（按项目类型动态启用工具）

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
| **Bun** | ≥ 1.2 | 运行时 & 包管理器 |
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
bun install
bun run dev          # 开发模式，热重载
```

编译单文件 exe：

```bash
cd packages/studio && bun run compile
# 产物 → dist/novelfork-vX.Y.Z-windows-x64.exe
```

---

## Quick Start

```
┌─────────────────────────────────────────────────────────────┐
│  1. 启动        双击 exe 或 bun run dev                       │
│  2. 打开浏览器   http://localhost:4567                         │
│  3. 配置供应商   设置 → AI 供应商 → 添加 API Key               │
│  4. 开始创作    新建书籍 或 直接开启叙述者对话                   │
└─────────────────────────────────────────────────────────────┘
```

支持的 AI 供应商：

| 供应商 | 协议 | 说明 |
|--------|------|------|
| Anthropic | Claude API | Claude 3.5 / Opus 4 等 |
| DeepSeek | Anthropic 兼容 | v4-pro 等 |
| OpenAI | Chat Completions | GPT-4o 等 |
| 自定义 | OpenAI 兼容 | 任何兼容 API（本地 / 第三方中转） |

---

## Writing Pipeline

NovelFork 的写作管线 v2 是核心创作链路，由多个专业 Agent 协作完成：

```
cockpit.snapshot ─→ jingwei.read(brief) ─→ pgi.ask ─→ AskUserQuestion
                                                           │
    ┌──────────────────────────────────────────────────────┘
    ▼
scene.spec ─→ jingwei.read(category) ─→ pipeline.write ─→ 候选稿
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
                                         resource.manage(accept)
```

### 核心小说工具

| 工具 | 功能 | 分类 |
|------|------|------|
| `cockpit.snapshot` | 进度/伏笔/候选稿全景快照 | 常驻 |
| `jingwei.read` | 经纬读取（scope: brief/category/search） | 常驻 |
| `jingwei.write` | 经纬写入（layer 分层 + Canon 保护） | 常驻 |
| `pgi.ask` | PGI 追问（生成问题 → 用户确认方向） | 常驻 |
| `scene.spec` | 结构化写作蓝图 | 常驻 |
| `pipeline.write` | 生成管线（Writer → Audit → Revise） | 常驻 |
| `chapter.read` | 读取章节正文 | 常驻 |
| `chapter.audit` | 章节质量审计 | 常驻 |
| `resource.manage` | 资源状态管理（accept/reject/archive…） | 常驻 |
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
│   │       ├── security/                  # Secret Detector + 路径沙箱
│   │       ├── content-replacement.ts     # 大文本引用替代
│   │       ├── streaming-tool-executor.ts # 并发工具执行
│   │       ├── turn-memory-extractor.ts   # 记忆自动提取
│   │       └── prompt-dump.ts             # 调试转储
│   └── novel-plugin/         # 小说领域插件
│       ├── engine/           # Agent / Jingwei / Pipeline / Filter
│       ├── routes/           # HTTP API 路由
│       ├── handlers/         # 业务服务层
│       └── pages/            # 前端组件 (38 组件)
├── docs/                     # 技术文档
├── dist/                     # 编译产物输出
└── scripts/                  # 构建 & Codegraph 脚本
```

---

## Build

```bash
bun install                              # 安装依赖
bun run dev                              # 开发模式（热重载）
bun run typecheck                        # 全包类型检查
cd packages/studio && bun run compile    # 编译单文件 exe
bun run codegraph                        # 生成代码导航图
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     NovelFork Studio                             │
│              React 19 + Hono + Vite + SQLite                    │
├─────────────────────────────────────────────────────────────────┤
│                      Agent Runtime                               │
│  ┌───────────┐  ┌──────────────┐  ┌───────────────────────┐    │
│  │ Turn Loop │  │   Security   │  │    Context Engine     │    │
│  │           │  │              │  │                       │    │
│  │ generate  │  │ secret-det.  │  │ budget pressure      │    │
│  │ tool_use  │  │ path-sandbox │  │ microcompact         │    │
│  │ execute   │  │ cmd-rules    │  │ content-replacement  │    │
│  │ loop/stop │  │ YOLO reflect │  │ tool-output-pruner   │    │
│  └───────────┘  └──────────────┘  └───────────────────────┘    │
│  ┌───────────┐  ┌──────────────┐  ┌───────────────────────┐    │
│  │  Memory   │  │ Multi-Agent  │  │   Provider Adapter   │    │
│  │           │  │              │  │                       │    │
│  │ extractor │  │ coordinator  │  │ Anthropic            │    │
│  │ aging     │  │ peer-msg     │  │ DeepSeek             │    │
│  │ context.md│  │ streaming-ex │  │ OpenAI compat        │    │
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

- **AI 供应商** — 多供应商管理 + 模型池 + 优先级/轮询策略
- **Agent 行为** — 权限模式 / YOLO 模式 / 工具限制 / 子代理模型
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
bun install && bun run dev

# 类型检查确认无误
bun run typecheck

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
