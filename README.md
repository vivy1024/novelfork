# NovelFork

> 通用 Coding Agent 工作台 + 网文创作插件 — 本地优先、约束驱动、插件化架构

**v1.8.0** | TypeScript + Bun + React 19 + Hono + SQLite + AI Agents

[![Release](https://img.shields.io/github/v/release/vivy1024/novelfork)](https://github.com/vivy1024/novelfork/releases/latest)

---

## 项目简介

NovelFork 本体是通用 Coding Agent 工作台（对标 Claude Code / NarraFork），网文创作能力通过插件提供。完全本地运行，数据不出本机。

核心特性：
- **通用 Agent 底座**：Session 管理 + 断线恢复 + 工具分层 + 插件 UI 注册 + MCP 扩展
- **网文插件**：经纬三层分离 / Scene Spec 结构化蓝图 / 写作管线 / 预设节拍 / 资源管理
- **工具精简**：24 个活跃小说工具（从 48 精简），核心 13 个常驻 + 其余 ToolSearch 按需
- **插件 UI 注册**：插件可向套路页注册配置面板（预设/节拍/辅助工具统一入口）
- **System Prompt 架构**：Markdown 分节 + 静态/动态分界 + Anthropic Prompt Caching

---

## 快速开始

### 方式一：下载 exe（推荐）

从 [GitHub Release](https://github.com/vivy1024/novelfork/releases/latest) 下载最新 `novelfork-vX.Y.Z-windows-x64.exe`，双击运行。

### 方式二：从源码构建

```bash
git clone https://github.com/vivy1024/novelfork.git
cd novelfork
bun install

# 开发模式
bun run dev

# 编译单文件 exe
cd packages/studio && bun run compile
```

首次打开配置 AI 供应商（设置 → AI 供应商 → 填入 API Key）。支持 Anthropic / DeepSeek / 任何 OpenAI 兼容 API。

---

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│  NovelFork Studio（Web 工作台）                               │
│  React 19 + Hono + Vite + SQLite                            │
├─────────────────────────────────────────────────────────────┤
│  Agent Runtime（通用 Coding Agent 底座）                      │
│  • Session 管理 + 消息持久化 + WebSocket 断线恢复             │
│  • Agent Turn Loop（generate → tool_use → execute → loop）  │
│  • System Prompt Builder（分节 + Markdown + 缓存分界）       │
│  • 工具分层（CORE 常驻 + ToolSearch 按需发现）               │
│  • 插件 UI Section 注册（uiSections + section-registry）     │
│  • Provider 适配（Anthropic/DeepSeek/OpenAI/Codex 协议）     │
│  • Compaction（阈值检测 → 截断/LLM 压缩）                    │
├─────────────────────────────────────────────────────────────┤
│  Novel Plugin（小说领域插件）                                  │
│  • 经纬系统（Canon/Dynamic/Reference 三层 + SQLite 索引）    │
│  • 写作管线 v2（scene.spec → pipeline.write → audit+revise） │
│  • 资源管理（resource.manage — 候选/草稿/章节状态转换）       │
│  • 预设/节拍合并工具（presets.read/write + beat.read/write）  │
│  • PGI 追问 + 驾驶舱快照 + 伏笔管理 + 叙事线                │
│  • 写作配置统一面板（套路页插件 section）                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心小说工具（v2 合并形态）

| 工具 | 功能 |
|------|------|
| `cockpit.snapshot` | 进度/伏笔/候选稿全景快照 |
| `jingwei.read` | 经纬读取（scope=brief/category/search） |
| `jingwei.write` | 经纬写入（layer 分层 + Canon 保护） |
| `pgi.ask` | PGI 追问（生成问题 → AskUserQuestion） |
| `scene.spec` | 结构化写作蓝图 |
| `pipeline.write` | 精简写作管线（Writer → AuditRevise） |
| `chapter.read` / `chapter.audit` | 读章节 / 审计 |
| `presets.read` / `presets.write` | 预设查看 / 配置（scope/action 分发） |
| `beat.read` / `beat.write` | 节拍查看 / 配置 |
| `resource.manage` | 资源管理（list/accept/reject/archive/restore/delete/create_draft） |
| `hooks.manage` | 伏笔生命周期管理 |

---

## 写作流程

```
1. cockpit.snapshot       → 了解当前进度
2. jingwei.read(brief)    → 读取经纬核心包 + 分类目录
3. pgi.ask                → 生成追问，用户确认方向
4. scene.spec             → 生成结构化写作蓝图
5. jingwei.read(category) → 按蓝图补读相关经纬
6. pipeline.write         → Writer 生成 + AuditRevise 审修
7. resource.manage(accept)→ 用户审核后接受为正式章节
```

---

## 仓库结构

```
novelfork/
├── packages/
│   ├── core/             # 通用基础设施（storage/llm/state/plugins）
│   ├── studio/           # Web 工作台（React 19 + Hono + Vite）
│   └── novel-plugin/     # 小说领域插件（engine/routes/handlers/pages）
├── docs/                 # 文档（学习中心/架构/开发指南）
└── dist/                 # 编译产物
```

---

## 开发

```bash
# 类型检查
bun run typecheck

# 测试
cd packages/studio && npx vitest run

# 编译
cd packages/studio && bun run compile
```

---

## License

MIT
