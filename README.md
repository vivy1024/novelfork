# NovelFork

> 通用 Coding Agent 工作台 + 网文创作插件 — 本地优先、约束驱动、插件化架构

**v1.11.0** | TypeScript + Bun + React 19 + Hono + SQLite + AI Agents

[![Release](https://img.shields.io/github/v/release/vivy1024/novelfork)](https://github.com/vivy1024/novelfork/releases/latest)

---

## 项目简介

NovelFork 本体是通用 Coding Agent 工作台（对标 Claude Code），网文创作能力通过插件提供。完全本地运行，数据不出本机。

核心特性：
- **通用 Agent 底座**：Session 管理 + 工具分层 + 插件 UI 注册 + MCP 扩展
- **生产级 Turn Loop**：max_output_tokens 自动恢复 + model fallback + budget pressure 三级
- **安全层**：Secret Detector（20+ 模式脱敏）+ 路径沙箱 + 危险命令拦截
- **智能记忆**：规则式自动提取决策/教训 + 30 天半衰期老化 + context.md 自动更新
- **网文插件**：经纬三层分离 / Scene Spec 蓝图 / 写作管线 / 对抗式审查 / 资源管理
- **工具精简**：24 个活跃小说工具，核心 13 个常驻 + 其余按需发现

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
│  Agent Runtime（通用 Agent 底座）                             │
│  • Turn Loop: generate → tool_use → execute → loop          │
│    - max_output_tokens 恢复（3次 + escalation 64K）          │
│    - model fallback（rate_limit → 备用模型）                 │
│    - budget pressure 三级（70%/80%/92%）                     │
│    - blocking TurnComplete hooks（验证 → 自修正）            │
│  • Security: secret-detector + path-sandbox + DANGEROUS      │
│  • Memory: 规则式提取 + aging + context.md 自动更新          │
│  • Performance: content-replacement + streaming executor     │
│  • Multi-Agent: coordinator-prompt + peer-messaging          │
│  • DX: prompt-dump + turn-profiler                           │
│  • Provider 适配（Anthropic/DeepSeek/OpenAI 协议）           │
│  • Compaction（阈值检测 → tool-output-pruner → LLM 压缩）   │
├─────────────────────────────────────────────────────────────┤
│  Novel Plugin（小说领域插件）                                  │
│  • 经纬系统（Canon/Dynamic/Reference 三层 + SQLite 索引）    │
│  • 写作管线 v2（scene.spec → pipeline.write → audit+revise） │
│  • 对抗式审查（3视角交叉 + S1-S4 严重度门禁）               │
│  • 资源管理 + 预设/节拍 + PGI 追问 + 驾驶舱                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Agent Runtime 能力清单

| 维度 | 能力 | 评分 |
|------|------|------|
| Turn Loop | max_output_tokens 恢复、model fallback、budget pressure、blocking limit | 10/10 |
| Security | secret-detector(20+模式)、path-sandbox、DANGEROUS_PATTERNS(24条) | 10/10 |
| Hooks | blocking TurnComplete + PreToolUse + PostToolUse（shell 命令） | 10/10 |
| Memory | 规则式提取(中英双语) + aging(30天半衰期) + context.md 自动更新 | 10/10 |
| Multi-Agent | coordinator-prompt + peer-messaging + streaming-executor | 10/10 |
| Performance | content-replacement(>8KB引用) + 并发工具执行 + tool-output-pruner | 10/10 |
| Context | totalTokens含toolCalls + microCompact + Snip + 413 reactive | 10/10 |
| DX | prompt-dump + turn-profiler + skill-activation | 10/10 |

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
| `presets.read` / `presets.write` | 预设查看 / 配置 |
| `beat.read` / `beat.write` | 节拍查看 / 配置 |
| `resource.manage` | 资源管理（list/accept/reject/archive/restore/delete） |
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
│   │   └── src/api/lib/  # Agent Runtime 核心
│   │       ├── agent-turn-runtime.ts    # Turn Loop 主循环
│   │       ├── security/                # 安全层
│   │       ├── content-replacement.ts   # 大文本引用替代
│   │       ├── streaming-tool-executor.ts # 并发工具执行
│   │       ├── turn-memory-extractor.ts # 记忆自动提取
│   │       ├── turn-profiler.ts         # 性能打点
│   │       ├── peer-messaging.ts        # subagent 通信
│   │       ├── coordinator-prompt.ts    # 多 agent 协调
│   │       ├── skill-activation.ts      # 工具条件激活
│   │       └── prompt-dump.ts           # 调试转储
│   └── novel-plugin/     # 小说领域插件（engine/routes/handlers/pages）
├── docs/                 # 文档
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

# 调试 LLM 请求
PROMPT_DUMP=1 bun run dev
# → 完整请求体保存到 .narrafork/prompt-dumps/
```

---

## License

MIT
