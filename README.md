# NovelFork

> AI 辅助中文网文创作工作台 — 本地优先、作者驱动、平台合规

---

## 项目定位

**NovelFork** 是一个专注中文网文创作的本地 AI 工作台，目标是让作者在一个软件内完成：**构思 → 大纲 → 写作 → 审计 → 去 AI 味 → 上架**。

核心理念：
- **故事经纬（内部 legacy Bible 命名兼容保留）**：结构化管理角色 / 事件 / 设定 / 章节摘要 / 矛盾 / 世界模型 / 故事基线 / 角色弧线，AI 按可见性规则精准注入上下文
- **强制 AI 味过滤**：12 本地特征规则 + 可选腾讯朱雀 API 双检 + 消 AI 味 7 招预设，写作管线必经一层（起点 / 晋江 / 番茄平台合规刚需）
- **引导式创作**：问卷系统引导建书、CoreShift 变更协议管理核心设定漂移、PGI（Pre-Generation Interrogation）在每章生成前用启发式问题把作者意图显性化
- **本地优先**：Bun 单入口 + Hono 本地服务 + React 19 工作台 + SQLite（`bun:sqlite`）+ drizzle，`bun compile` 单可执行文件分发

---

## 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | Bun |
| 前端 | React 19 + Vite + TailwindCSS |
| 后端 | Hono（本地 HTTP + WebSocket） |
| 存储 | SQLite（bun:sqlite）+ drizzle ORM |
| AI | 多 Agent 写作管线（规划 → 编排 → 写作 → 审计 → 修订） |
| 分发 | `bun compile` → 单可执行文件 |

> 方向边界：NovelFork 学的是 NarraFork 已验证的平台底座（Bun / Hono / React 19 / SQLite + drizzle / WebSocket / 诊断链），不是照抄 NarraFork 的 Mantine、TanStack Router 或 coder 向默认 UI 依赖。

---

## 仓库结构

```
novelfork/
├── packages/
│   ├── core/          # 写作引擎、Bible、Filter、存储层
│   ├── studio/        # React + Hono 本地 Web 工作台
│   └── cli/           # CLI 入口（novelfork 命令）
├── .kiro/
│   ├── specs/         # Kiro-style 需求 / 设计 / 任务 spec
│   └── steering/      # 项目规则与指引
├── docs/              # 文档中心
└── CLAUDE.md          # AI 协作规则
```

---

## 快速开始

```bash
git clone https://github.com/vivy1024/novelfork.git
cd novelfork
pnpm install              # 当前仓库仍用 pnpm 管理 workspace 依赖
bun run main.ts           # 源码启动首选口径（Bun runtime）
pnpm --dir packages/studio dev  # 仅前端开发时使用 Vite HMR
```

首次打开 Studio 时，建议先配置 AI 模型；但这不是强制前置。未配置模型时，你仍然可以继续创建本地书籍、整理故事经纬、编辑章节正文。AI 续写、评点、深度 AI 味检测和工作台 Agent 任务会在真正调用时再提示配置模型。

产物构建与分发：

```bash
pnpm build        # 生产构建
pnpm bun:compile  # 编译为单可执行文件
```

---

## 当前开发状态

### 已完成
- **平台收口**：NarraFork 风格回归完成（Bun 单入口 / `bun compile` / WebSocket / 537 测试），归档于 `.kiro/specs/archive/novelfork-narrafork-closure/`
- **存储迁移**（进行中）：JSON 文件 → SQLite + drizzle ORM，session / message / kv 核心表已落地，Tasks 1-5 完成

### 进行中 — P0 三个 Spec

| Spec | 状态 | 范围 |
|---|---|---|
| **storage-migration** | Tasks 1-7 ✅ | SQLite 接入 + migration runner + Repository 层 + 并发验证 + JSON 导入 + 扩展指引 |
| **novel-bible-v1** | Spec 完成，待实现 | 内部 spec 名仍为 `novel-bible-v1`，用户可见层统一叫“故事经纬 / 经纬”；范围为可见性 + 上下文引擎 → Conflict + WorldModel + Premise + CharacterArc → Questionnaire + CoreShift + PGI |
| **ai-taste-filter-v1** | Spec 完成，待实现 | 12 规则检测 + 朱雀 API + 7 招建议 + 管线集成 + 跨故事经纬/PGI 接口 |

### Migration 编号规划

```
0001_storage_base.sql      ← storage-migration（已落地）
0002_bible_v1.sql          ← novel-bible-v1 Phase A
0003_bible_phaseB.sql      ← novel-bible-v1 Phase B
0004_bible_phaseC.sql      ← novel-bible-v1 Phase C
0005_filter_v1.sql         ← ai-taste-filter-v1
```

---

## 文档入口

| 目标 | 入口 |
|---|---|
| 文档中心 | [docs/README.md](./docs/README.md) |
| 系统架构 | [docs/02-核心架构/01-系统架构/](./docs/02-核心架构/01-系统架构/) |
| 小说写作与 AI 调研 | [docs/03-代码参考/07-小说写作与AI调研.md](./docs/03-代码参考/07-小说写作与AI调研.md) |
| 存储层开发指引 | [docs/04-开发指南/存储层开发指引.md](./docs/04-开发指南/存储层开发指引.md) |
| Spec 文档 | [.kiro/specs/](./.kiro/specs/) |

---

## 许可证

MIT
