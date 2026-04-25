# Design Document

## Overview

本设计把 NovelFork 对 NarraFork 的学习拆成四类：

1. **已经学习并保留**：Bun 本地单体、Hono、React 19、SQLite/drizzle、WebSocket、结构化启动日志、provider 后置。
2. **需要 P0 升级**：Bun-only 运行时契约、SQLite 一致性、文件书籍与 DB 同步、启动 / 发布验证链、文档口径清理。
3. **需要 P1 学习**：WebSocket 恢复链、请求历史、更新机制、权限体验、高级工作台模式。
4. **暂不学习 / 不照抄**：Mantine、TanStack Router、NarraFork coder 向 Terminal / Browser / Admin 一等 UI、节点图作为作者默认工作流。

核心原则：NovelFork 学 NarraFork 的平台底座，不复制 NarraFork 的 coder 产品形态。NovelFork 默认仍是中文网文作者工作台。

## NarraFork 平台栈收益与 NovelFork 学习状态

| 能力 | NarraFork 做法 | 好处 | NovelFork 当前状态 | 优先级 | NovelFork 处理策略 |
|---|---|---|---|---|---|
| Bun 单体运行时 | Bun + 本地服务 + 单文件分发 | 启动快、部署简单、产品壳清晰 | 已采用，但历史 Node 口径残留 | P0 | 运行时 Bun-only；开发工具链逐步清理 |
| Hono 本地服务 | Hono 提供 API / WS | 轻量、适合内嵌产品 | 已采用 | 保持 | 保持，不重构 |
| React 19 产品壳 | SPA 管理台 | 交互成熟 | 已采用 | 保持 | 继续 React 19 + Vite |
| SQLite + drizzle | 本地结构化存储 + migration | 可恢复、可查询、可演进 | 已采用 | P0 | 落地为 `bun:sqlite + drizzle` |
| better-sqlite3 同步心智 | 同步 prepare/transaction | 事务简单 | 依赖本身不适合 Windows Bun | 已优化 | 不学包名，学同步心智；用 facade 保留 API |
| WebSocket 恢复 | 会话/工具流恢复 | 刷新、断线更稳 | 已有 WS，恢复链不足 | P1 | 补消息边界、buffer queue、失败恢复 |
| Provider 管理 | 配置后置、状态透明 | 首用不被 API Key 卡死 | 已有 gate 雏形 | P0/P1 | P0 保证不阻断；P1 优化模型池和错误体验 |
| 结构化启动日志 | runtime/assets/db/ws/provider 全可见 | 排障快 | 已有 | P0 | 作为发布验证门槛 |
| PTY / Terminal | bun-pty + xterm | coder 工作台强 | 未完整学习 | P1（高级模式） | 不进作者默认 UI，仅工作台模式可选 |
| Browser / 抓取 | puppeteer-core/readability | 调研抓取强 | 市场雷达方向已有 | P1 | 服务市场/题材/素材，不照搬 Browser UI |
| UI 库 | Mantine/TanStack/xyflow | 快速搭管理台 | 未采用 | 暂不学 | 保持 shadcn/Base UI，避免 UI 栈迁移 |
| 更新机制 | updater/changelog | 本地产品持续升级 | 不完整 | P1 | 做稳定/测试通道和更新日志入口 |

## P0 升级范围

### P0-1 Bun-only 运行时收口

目标：消除产品运行时里的 Node 依赖心智。允许历史构建工具短期存在，但不得进入 Studio 启动、存储、WebSocket、AI gate、单文件分发链。

落地项：

- `main.ts` 是 Bun 源码启动入口。
- `packages/core` 引擎声明为 Bun。
- `packages/core/src/storage/db.ts` 使用 `bun:sqlite`。
- 所有运行时路径不得 import `better-sqlite3`。
- 启动日志必须显示 `runtime: "bun"`。

验收信号：

```bash
bun run main.ts --port=4571
```

日志包含：

- `storage.sqlite ok=true`
- `runtime="bun"`
- `websocket.register ok=true`
- provider missing 只作为 skipped / warning

### P0-2 SQLite / drizzle 一致性

目标：让 NovelFork 的结构化状态真正以 SQLite/drizzle 为基础，而不是文件系统和 DB 各走一套。

当前风险：本地建书流程可能只创建文件 scaffold，但 `story jingwei` API 依赖 SQLite `book` 表，导致“页面有书 / DB 查不到书”。

设计：

```text
BookCreate / storage route
  → writeLocalBookScaffold()
  → upsert book row in SQLite
  → apply jingwei template
  → create default session/window if needed
```

要求：

- 文件层保存可手动编辑的正文 / 配置。
- SQLite 层保存书籍索引、经纬栏目、经纬条目、会话状态。
- 启动时提供非破坏性补录：文件里有书但 DB 没有时补 `book` row。
- 删除书籍必须明确文件和 DB 的删除策略。

### P0-3 Bun 验证链

目标：每次平台升级都能用 Bun 原生命令证明可运行。

推荐验证命令：

```bash
bun "packages/core/node_modules/typescript/bin/tsc" -p "packages/core/tsconfig.json" --noEmit
bun "packages/studio/node_modules/typescript/bin/tsc" -p "packages/studio/tsconfig.json" --noEmit
bun "packages/studio/node_modules/typescript/bin/tsc" -p "packages/studio/tsconfig.server.json" --noEmit
bun "scripts/verify-bun-storage.ts"
bun run main.ts --port=4571
```

后续应整理为一个明确脚本，例如：

```bash
bun run scripts/verify-bun-runtime.ts
```

该脚本负责聚合：typecheck、storage、server smoke、provider gate smoke。

### P0-4 Provider 后置不阻断

目标：模型配置是推荐第一步，但不能阻断本地使用。

保留规则：

- 启动、首页、建书、经纬、章节编辑不需要 provider。
- AI 写作、AI 初始化、AI 味检测、Agent 会话需要 provider gate。
- gate 必须保留输入和上下文。

### P0-5 文档口径清理

目标：后来的人不会继续按旧口径把 `better-sqlite3`、Node runtime、UI 照抄作为方向。

需要同步：

- README 技术栈。
- 存储层开发指引。
- 平台迁移 / 技术栈选型历史文档。
- NarraFork 依赖参考中补一句：参考快照记录的是 NarraFork 的包组合，NovelFork 实际落地为 Bun-only `bun:sqlite + drizzle`。

## P1 学习范围

### P1-1 WebSocket / 会话恢复链

学习 NarraFork：中断恢复、消息边界、工具输出重放、buffer queue 持久化。

NovelFork 映射：

- 写作会话消息流可恢复。
- 工具执行链有最近状态和失败原因。
- 页面刷新后恢复到已确认消息边界。
- AI 生成失败后保留草稿输入。

### P1-2 请求历史与成本观测

学习 NarraFork：API 请求历史、TTFT、tokens、成本、凭据筛选。

NovelFork 映射：

- 作者能看到最近 AI 请求是否成功、用了哪个模型、耗时、token 估算。
- 管理中心保留请求历史，但默认作者首页不暴露复杂指标。

### P1-3 高级工作台模式

学习 NarraFork：工具权限、Terminal、Browser、Admin、MCP 可视化。

NovelFork 映射：

- 默认作者模式隐藏这些入口。
- 高级工作台模式可打开：工具调用、权限、日志、会话恢复、诊断。
- 每个工具入口必须有权限提示。

### P1-4 更新机制与版本反馈

学习 NarraFork：版本提示、更新日志、自动更新通道。

NovelFork 映射：

- 本地桌面/单文件版本能显示当前版本、commit、更新通道。
- changelog 面向作者解释“新增什么写作能力”。

### P1-5 市场 / 抓取能力作者化

学习 NarraFork：Browser / readability / 抓取基础设施。

NovelFork 映射：

- 服务市场雷达、题材分析、素材整理。
- 不把 Browser 工具作为默认一等入口。

## 暂不学习 / 非目标

| NarraFork 能力 | 不直接学习原因 | NovelFork 当前策略 |
|---|---|---|
| Mantine UI 栈 | NovelFork 已有 shadcn/Base UI，迁移成本高且价值低 | 保持现有 UI 栈 |
| TanStack Router 全量迁移 | 当前路由/Tab 架构已可用 | 后续只在路由复杂度失控时评估 |
| coder 向节点图默认工作流 | 作者写作心智不是 Git worktree 节点图 | 映射为书籍 / 章节 / 经纬 / 写作会话 |
| Terminal 一等入口 | 默认作者不需要终端 | 高级模式可选 |
| NarraForkAdmin 一等入口 | 容易暴露系统复杂度 | 管理中心保留必要诊断，不默认暴露管理员工具 |
| 完整 MCP 工具市场 | 当前主线是写作闭环 | 先完成写作、审稿、经纬和连载能力 |

## 数据与组件边界

```text
packages/core/src/storage/db.ts
  Bun SQLite facade + drizzle client

packages/core/src/storage/repositories/
  session / message / kv repository

packages/core/src/bible + jingwei
  book / story jingwei / questionnaire / filter report

packages/studio/src/api/routes/storage.ts
  file scaffold + SQLite book row sync

packages/studio/src/api/routes/jingwei.ts
  story jingwei sections / entries / context preview

packages/studio/src/api/server.ts
  startup diagnostics + storage init + route registration
```

关键边界：

- `db.ts` 负责驱动细节，不让业务层知道 Bun Statement 差异。
- repository 负责结构化数据，不直接处理 UI 文案。
- storage route 负责文件 scaffold 与 DB book row 同步。
- UI 负责作者心智，不暴露内部 legacy `bible_*` 命名。

## 失衡预警

| 信号 | 意味着什么 | 处理 |
|---|---|---|
| 新增 Node-only runtime 包 | Bun-only 收口失衡 | P0 阻断，必须替换或隔离 |
| 建书后经纬 API 404 | 文件 / DB 一致性失衡 | P0 修复 book row 同步 |
| 首页塞入 Terminal / Browser / Admin | 作者向 UI 失衡 | 移入高级模式 |
| 为兼容写 Node/Bun 双分支 | 长期质量失衡 | 回到 Bun-only facade |
| 文档继续推荐 better-sqlite3 | 口径失衡 | 更新为 bun:sqlite 落地说明 |
