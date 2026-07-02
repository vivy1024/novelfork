# Requirements Document

## Introduction

NovelFork 当前进入做减法阶段。软件主体已经定型，后续重点不是继续扩展写作中间态，而是收口现有模型、删除候选稿/草稿主概念、统一章节存储语义，并把真实代码结构沉淀为可长期查阅的 CodeWiki。

本 spec 的目标是完成当前精简工作，并在任务最后完善真正的代码百科型 CodeWiki。同时将 docs 顶层的 `01-当前状态` 调整为 `01-codewiki`，让 CodeWiki 成为后续理解项目状态的第一入口。

## Requirements

### Requirement 1: 删除候选稿与草稿主概念

**User Story:** 作为作者，我不希望系统继续维护候选稿/草稿这类中间对象，以避免写作流程和数据模型过重。

#### Acceptance Criteria

1. WHEN 用户查看主要写作流程 THEN 系统不应再把候选稿/草稿作为推荐路径。
2. WHEN 工具产生文本结果 THEN 结果应进入正式章节、多版本、配置建议或叙事记忆事件，而不是候选稿/草稿中心。
3. WHEN 代码中仍存在候选稿/草稿兼容路径 THEN 它们必须被标记为待废弃并有迁移任务。

### Requirement 2: 保留正式章节作为结果层

**User Story:** 作为作者，我仍然需要正式章节作为可编辑、可发布、可回溯的正文产物。

#### Acceptance Criteria

1. WHEN 文档描述章节 THEN 正式章节必须被定义为结果层对象。
2. WHEN 写作动作完成 THEN 最终稳定结果应落到正式章节或多版本结算流程。
3. WHEN 正式章节发生事实性变化 THEN 应有叙事记忆回写或校验路径。

### Requirement 3: 统一文件系统为章节主存储

**User Story:** 作为维护者，我希望章节正文以文件系统作为主存储，避免 SQLite 与文件系统双主语义。

#### Acceptance Criteria

1. WHEN 设计章节存储 THEN 文件系统必须是正式章节主语义存储。
2. WHEN SQLite 继续存在 THEN 它只能承担运行时状态、索引、诊断日志等非章节正文主语义职责。
3. WHEN 旧 writing-resource 资源系统仍存在 THEN 必须列出清理路径与风险。

### Requirement 4: 重新定位写作工具

**User Story:** 作为作者，我需要保留文风提取、选段扩写、改写、多版本等用户体验能力，但不希望这些工具再制造新的中间对象层。

#### Acceptance Criteria

1. WHEN 文风提取完成 THEN Agent 应询问用户是否加入写作预设，用户可选择新增、覆盖或手动编辑。
2. WHEN 选段扩写或改写完成 THEN 结果应作为编辑动作结果或版本结果，不应自动变成候选稿/草稿。
3. WHEN 多版本功能设计 THEN 它必须作为独立 UX 功能域处理，包括比较、选择、合并、回退和结算。
4. WHEN 章节结算发生 THEN 它应更新正式章节并触发必要的叙事记忆回写。

### Requirement 5: 建立真正的代码百科型 CodeWiki

**User Story:** 作为维护者，我希望以后能通过 CodeWiki 直接理解模块、API、数据流、UI 与清理状态，而不是每次重新梳理。

#### Acceptance Criteria

1. WHEN 查看 CodeWiki THEN 它必须包含真实代码路径、主要函数/路由/handler、输入输出、当前问题和维护规则。
2. WHEN 页面描述模块 THEN 它必须能反查到实际文件或 codegraph/CODEMAP 信息。
3. WHEN 旧概念需要删除 THEN CodeWiki 必须有对应删除清单和迁移记录。
4. WHEN 文档引用代码路径 THEN `bun run docs:drift` 必须通过。

### Requirement 6: 调整 docs 入口结构

**User Story:** 作为维护者，我希望 docs 顶层第一个入口就是 CodeWiki，避免当前状态文档和 CodeWiki 分散。

#### Acceptance Criteria

1. WHEN 查看 `docs/` 顶层目录 THEN `01-当前状态` 应被调整为 `01-codewiki`。
2. WHEN 查看 `docs/README.md` THEN 目录表必须指向新的 `01-codewiki`。
3. WHEN 旧文档引用 `01-当前状态` THEN 必须更新引用或保留明确迁移说明。
4. WHEN 调整完成 THEN 文档漂移检查必须通过。

## Non-Goals

- 不做微服务拆分。
- 不引入 DeepWiki/OpenDeepWiki 等新平台作为主依赖。
- 不在本阶段重新设计所有 UI 交互细节。
- 不删除正式章节概念。
- 不删除经纬和叙事记忆。
