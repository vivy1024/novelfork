# NovelFork

> AI 辅助中文网文创作工作台 — 本地优先、约束驱动、Agent 协作

**v1.1.0** | TypeScript + Bun + React 19 + Hono + SQLite + AI Agents

[![Release](https://img.shields.io/github/v/release/vivy1024/novelfork)](https://github.com/vivy1024/novelfork/releases/latest)

---

## 项目简介

NovelFork 是一个专注中文网文创作的本地 AI 工作台。完全本地运行，数据不出本机。

核心特性：
- **约束驱动写作**：Scene Spec 结构化蓝图 → Writer → AuditRevise，硬约束保证不出错
- **经纬三层分离**：Canon（不可变真相）/ Dynamic（每章更新）/ Reference（按需查阅）
- **核心包 + 按需读取**：模型默认只读 4000 tokens 核心包，按分类分页补读细节
- **10 个核心工具**：从 48 个精简到 10 个，模型认知负担降低 60%
- **Provider 健康管理**：熔断、错误分类、自动降级、用户可读错误提示
- **Token 预算硬约束**：上下文不会膨胀到 180k tokens，工具输出自动截断

---

## 快速开始

### 方式一：下载 exe（推荐）

从 [GitHub Release](https://github.com/vivy1024/novelfork/releases/latest) 下载 `novelfork-v1.1.0-windows-x64.exe`，双击运行。

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
│  • Session 管理 + 消息持久化 + 断线恢复                       │
│  • Agent Turn Loop（generate → tool_use → execute → continue）│
│  • Context Budget Manager（token 预算硬约束）                 │
│  • Provider Health Manager（熔断 + 错误分类 + fallback）      │
│  • Tool Executor（权限检查 + YOLO mode + 安全反思）           │
│  • Compaction（阈值检测 → 截断/LLM 压缩）                    │
├─────────────────────────────────────────────────────────────┤
│  Novel Plugin（小说领域插件）                                  │
│  • 经纬系统（Canon/Dynamic/Reference 三层）                   │
│  • 写作管线（SceneSpec → Writer → AuditRevise）              │
│  • PGI 追问 + Scene Spec 结构化蓝图                          │
│  • 审计（Canon check + POV check + AI 味 + 节奏）            │
│  • 预设/节拍/伏笔/叙事线/驾驶舱/健康度                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心工具（v2）

| 工具 | 功能 |
|------|------|
| `cockpit.snapshot` | 进度/伏笔/候选稿/健康度全景 |
| `jingwei.read` | 经纬读取（scope=brief/category/search） |
| `jingwei.write` | 经纬写入（Canon 不可变保护 + 删除） |
| `pgi.ask` | PGI 追问（生成问题 + AskUserQuestion 格式） |
| `scene.spec` | 结构化写作蓝图（H4 硬约束校验） |
| `pipeline.write` | 精简写作管线（2 次 LLM 调用） |
| `chapter.read` | 读章节正文 |
| `chapter.audit` | 审计（Canon + POV + 软约束） |
| `rewrite.segment` | 选段改写（续写/扩写/去AI味/风格改写） |
| `hooks.manage` | 伏笔生命周期（埋设/回收/删除） |

---

## 写作流程（PEV）

```
1. cockpit.snapshot     → 了解当前进度
2. jingwei.read(brief)  → 读取经纬核心包 + 分类目录
3. pgi.ask              → 生成追问，用户确认方向
4. scene.spec           → 生成结构化写作蓝图
5. jingwei.read(category) → 按蓝图补读相关经纬
6. pipeline.write       → Writer 生成 + AuditRevise 审修
7. 候选稿保存           → 用户审核后合并到正式章节
```

---

## 硬约束体系

| ID | 约束 | 违反后果 |
|----|------|---------|
| H1 | Token ≤ 模型窗口 × 80% | 拒绝构造，触发 compact |
| H2 | Canon 不可变 | 审计阻断 |
| H3 | AI 生成只进候选区 | 权限拦截 |
| H4 | 没有 Scene Spec 不能写章节 | pipeline 拒绝 |
| H5 | 写章节前必须用户确认 | PGI 门禁 |
| H6 | 经纬写入只走工具 | permission deny |
| H7 | 角色不能知道视角外信息 | POV 检测 |

---

## 经纬系统

三层数据分离：

| 层 | 内容 | 行为 |
|----|------|------|
| Canon | 故事基线/世界规则/写作约束 | 只能追加，不能修改 |
| Dynamic | 角色状态/伏笔/矛盾/章节摘要 | 每章可更新 |
| Reference | 角色档案/地点/势力/能力体系 | 按需查阅 |

14 个标准分类：premise / world-model / characters / relationships / factions / locations / power-system / timeline / chapter-summaries / foreshadowing / conflicts / props / rules / reference

---

## 仓库结构

```
novelfork/
├── packages/
│   ├── core/             # 通用基础设施（storage/llm/state/mcp）
│   ├── studio/           # Web 工作台（React 19 + Hono + Vite）
│   ├── cli/              # CLI 工具
│   └── novel-plugin/     # 小说领域插件（engine/routes/handlers/pages）
├── docs/
│   ├── learning/         # 学习中心（22 篇）
│   ├── 04-架构与设计/    # 系统架构、Agent 管线、经纬系统
│   └── 05-开发者指南/    # 存储层、经纬开发指引
└── dist/                 # 编译产物
```

---

## 开发

```bash
# 类型检查
pnpm -r typecheck

# 测试
pnpm --dir packages/cli test
pnpm --dir packages/studio exec vitest run

# 编译
cd packages/studio && bun run compile
```

---

## License

MIT
