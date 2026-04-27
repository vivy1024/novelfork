# Requirements Document

## Introduction

本 spec 用来收口 NovelFork 对 NarraFork 平台栈的学习与升级路线。目标不是把 NovelFork 变成 coder 向 NarraFork 复刻版，而是学习 NarraFork 已验证的 **Bun 本地单体 + Hono 服务 + React 产品壳 + SQLite/drizzle 持久化 + WebSocket 恢复 + 工具权限治理** 这一套平台底座，并把它改造成适合中文网文作者的本地 AI 写作工作台。

当前判断：NovelFork 已经基本学习了 NarraFork 的平台方向，剩余核心问题不是“要不要学 NarraFork”，而是把历史依赖、存储一致性、启动验证、恢复链和作者向产品边界继续清干净。

优先级定义：

- **P0**：影响 Bun 启动、数据一致性、基础写作路径、可发布验证的项目，必须优先完成。
- **P1**：提升 NarraFork parity、稳定性、诊断能力和高级工作台体验的项目，可在 P0 稳定后推进。
- **暂不学 / 非目标**：NarraFork 的 coder 向 UI、Mantine/TanStack/Terminal/Admin 一等入口等，不作为当前作者向默认 UI 目标。

## 当前统筹关系

| 关系 | 当前平衡点 |
|---|---|
| 学平台栈 vs 照抄 UI | 学平台栈，不照抄 UI 库和 coder 向入口 |
| Bun-only vs 历史 Node 工具链 | 产品运行时 Bun-only；历史开发脚本逐步清理，不允许进入运行时链路 |
| 速度 vs 长期质量 | P0 优先解决启动、数据一致性、验证链；不为快速兼容写双实现屎山 |
| NarraFork 通用 AI 工作台 vs NovelFork 作者工作台 | 内核能力向 NarraFork 学，默认 UI 服务作者写作心智 |

## Requirements

### Requirement 1：Bun-only 运行时契约

**User Story：** 作为 NovelFork 维护者，我希望核心运行时明确只服务 Bun，避免 Node/Bun 双实现导致后续维护复杂化和兼容屎山。

#### Acceptance Criteria

1. WHEN Studio 通过源码启动 THEN THE SYSTEM SHALL 使用 `bun run main.ts` 作为首选运行方式。
2. WHEN 核心存储层初始化 THEN THE SYSTEM SHALL 不加载 `better-sqlite3`、`node:sqlite` 或任何 Node-only SQLite 驱动。
3. WHEN 运行时日志输出 THEN THE SYSTEM SHALL 明确显示 `runtime: "bun"`、静态资源来源、数据库路径、迁移结果和 WebSocket 注册状态。
4. WHEN package metadata 描述 core 运行时 THEN THE SYSTEM SHALL 以 Bun 为目标引擎，不再把 Node 当产品运行时前提。
5. WHEN 历史脚本仍调用 Node THEN THE SYSTEM SHALL 被视为开发工具链残留，不得影响 Studio 启动、存储、WebSocket 或打包运行链。
6. WHEN 发现运行时路径仍依赖 Node-only 包 THEN THE SYSTEM SHALL 将其列为 P0 阻断项。

### Requirement 2：SQLite + drizzle 存储底座 Bun 化

**User Story：** 作为本地写作工作台用户，我希望软件的数据存储稳定、可迁移、可恢复，并且不会因为 native Node 模块导致 Bun 启动失败。

#### Acceptance Criteria

1. WHEN 创建存储数据库 THEN THE SYSTEM SHALL 使用 `bun:sqlite`。
2. WHEN 使用 drizzle ORM THEN THE SYSTEM SHALL 使用 `drizzle-orm/bun-sqlite`。
3. WHEN 业务 repository 访问 SQLite THEN THE SYSTEM SHALL 通过统一的同步 facade 使用 `.prepare/.transaction/.exec/.pragma/.open/.close`，避免驱动细节扩散。
4. WHEN 运行 migration THEN THE SYSTEM SHALL 记录 `drizzle_migrations`，并保持幂等。
5. WHEN 执行事务 THEN THE SYSTEM SHALL 使用 Bun SQLite 同步事务，不引入异步 race。
6. WHEN 执行验证 THEN THE SYSTEM SHALL 提供 Bun 原生验证脚本，证明 migration、transaction、pragma 与 checkpoint 行为可用。
7. WHEN lockfile 或依赖树仍出现 `better-sqlite3` THEN THE SYSTEM SHALL 确认它不是 workspace importer 依赖，也不会被运行时代码 import；若会被加载则列为 P0。

### Requirement 3：文件书籍与 SQLite 结构化索引一致

**User Story：** 作为作者，我希望创建一本本地书籍后，书籍总览、故事经纬、会话、章节和后续 AI 上下文都能看到同一本书，而不是文件系统有书但数据库查不到。

#### Acceptance Criteria

1. WHEN 用户创建本地书籍 THEN THE SYSTEM SHALL 同步写入文件书籍 scaffold 与 SQLite `book` 记录。
2. WHEN 书籍已存在于文件系统但 SQLite 缺少记录 THEN THE SYSTEM SHALL 在启动或访问时执行非破坏性补录。
3. WHEN 故事经纬 API 查询新书 THEN THE SYSTEM SHALL 能从 SQLite 识别该 bookId，并返回对应经纬栏目。
4. WHEN 删除或归档书籍 THEN THE SYSTEM SHALL 明确文件层与 SQLite 层的删除 / 软删策略，避免孤儿数据。
5. WHEN 书籍 ID 包含中文、空格或平台特殊字符 THEN THE SYSTEM SHALL 明确 slug / display title 的边界，避免 URL、安全校验和 DB 主键不一致。

### Requirement 4：启动与发布验证链

**User Story：** 作为发布负责人，我希望每次平台栈升级后能用 Bun 证明 Studio 可启动、静态资源可服务、SQLite 可用、WebSocket 已注册，而不是只通过类型检查。

#### Acceptance Criteria

1. WHEN 执行 P0 验证 THEN THE SYSTEM SHALL 至少运行 core typecheck、studio client typecheck、studio server typecheck、Bun storage verification、Studio Bun 启动 smoke。
2. WHEN Studio 启动 smoke 运行 THEN THE SYSTEM SHALL 验证首页可访问、provider 未配置不阻断、书籍创建基础路径可用。
3. WHEN 启动日志发现 `unclean-shutdown`、孤儿 session、外部 worktree 污染 THEN THE SYSTEM SHALL 输出结构化诊断，不得伪装为成功。
4. WHEN 构建单文件产物 THEN THE SYSTEM SHALL 证明 embedded assets 与 `bun compile` 路径均可用。
5. WHEN 验证失败 THEN THE SYSTEM SHALL 记录失败点属于运行时、存储、前端、WebSocket、provider gate 或环境污染哪一类。

### Requirement 5：Provider 后置与 AI gate

**User Story：** 作为第一次打开软件的作者，我希望没配置模型时仍能创建本地书籍、整理故事经纬和编辑章节，只在真正调用 AI 时被提示配置模型。

#### Acceptance Criteria

1. WHEN provider / model 未配置 THEN THE SYSTEM SHALL 允许启动 Studio、打开首页、创建本地书籍、维护故事经纬、编辑章节。
2. WHEN 用户触发 AI 写作、AI 初始化、AI 味检测、Agent 会话等需要模型的动作 THEN THE SYSTEM SHALL 通过统一 gate 拦截。
3. WHEN gate 拦截 THEN THE SYSTEM SHALL 保留用户当前输入、页面位置和上下文，并提供配置模型入口。
4. WHEN provider 缺失出现在启动诊断中 THEN THE SYSTEM SHALL 标记为 skipped / missing，而不是启动失败。
5. WHEN 模型配置失败 THEN THE SYSTEM SHALL 给出可读错误摘要，不影响本地功能。

### Requirement 6：学习 NarraFork 的平台能力，不照抄 UI 依赖

**User Story：** 作为产品负责人，我希望 NovelFork 学 NarraFork 的成熟平台能力，但默认 UI 仍然服务中文网文作者，而不是把 coder 向工作台一等入口全搬过来。

#### Acceptance Criteria

1. WHEN 参考 NarraFork THEN THE SYSTEM SHALL 优先学习 Bun 单体、Hono、本地 SQLite、WebSocket、权限、恢复、更新、诊断这些平台能力。
2. WHEN 选择 UI 技术 THEN THE SYSTEM SHALL 保持 NovelFork 当前 React 19 + Tailwind + shadcn/Base UI 路线，不为 parity 引入 Mantine。
3. WHEN 设计作者默认页面 THEN THE SYSTEM SHALL 隐藏 Terminal、Browser、NarraForkAdmin、Shell 权限、MCP 原始工具等 coder 向入口。
4. WHEN 进入高级工作台模式 THEN THE SYSTEM SHALL 可以逐步暴露工具链能力，但必须有清楚的模式切换、权限提示和返回作者模式路径。
5. WHEN 新增功能来自 NarraFork 启发 THEN THE SYSTEM SHALL 映射成作者心智，例如书籍、章节、故事经纬、写作会话、审稿、连载节奏，而不是照搬叙事线 / 节点图命名。

### Requirement 7：WebSocket、会话和恢复链升级

**User Story：** 作为长期写作用户，我希望 AI 会话、执行链和消息流在刷新、断线、重启后尽量可恢复，不丢失关键上下文。

#### Acceptance Criteria

1. WHEN WebSocket route 注册 THEN THE SYSTEM SHALL 在启动日志中结构化输出所有注册路由。
2. WHEN 会话消息流中断 THEN THE SYSTEM SHALL 能基于 SQLite 持久化状态恢复已确认消息边界。
3. WHEN buffered queue 或工具调用输出未完成 THEN THE SYSTEM SHALL 记录可恢复状态，而不是只保存在内存。
4. WHEN 用户打开会话中心 THEN THE SYSTEM SHALL 能看到会话状态、消息数、上下文预算、最近执行链。
5. WHEN 恢复失败 THEN THE SYSTEM SHALL 显示可读失败原因，并提供重试、归档或新开会话路径。

### Requirement 8：文档和历史口径清理

**User Story：** 作为后续维护者，我希望文档明确 NovelFork 当前学习 NarraFork 的边界，避免后来的人继续引用旧的 Node / better-sqlite3 / UI 照抄口径。

#### Acceptance Criteria

1. WHEN README 描述技术栈 THEN THE SYSTEM SHALL 显示 Bun、Hono、React 19、SQLite（bun:sqlite）+ drizzle。
2. WHEN 存储层开发文档描述驱动 THEN THE SYSTEM SHALL 使用 `bun:sqlite`，并说明 facade 边界。
3. WHEN 历史调研仍提到 `better-sqlite3 + drizzle` THEN THE SYSTEM SHALL 补充当前实际落地为 `bun:sqlite + drizzle`，原因是 Bun-only 运行时兼容。
4. WHEN spec 任务引用 NarraFork THEN THE SYSTEM SHALL 区分“已学习 / 未学习 / 优化过 / 暂不学”。
5. WHEN 发现文档里把 NarraFork UI 库当成必须迁移项 THEN THE SYSTEM SHALL 改成“可参考，不照抄”。
