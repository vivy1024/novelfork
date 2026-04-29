# Docs System Rearchitecture Requirements

**版本**: v1.0.0
**创建日期**: 2026-04-28
**更新日期**: 2026-04-28
**状态**: 📋 规划中

---

## 背景

当前 `docs/` 已经积累了 51 篇 Markdown 文档，但结构和口径开始失控：当前事实、历史路线、调研参考、开发指南、API 总览和测试报告混在一起，导致多个“当前口径”并存。典型问题包括：

1. 根 `docs/README.md` 仍以“回归 NarraFork 路线”为核心口径，但当前执行主线已经转为 NovelFork 小说创作工作台完整闭环和新前端旁路建设。
2. `docs/05-API文档/01-Studio API总览.md` 与 `docs/05-API文档/01-Studio接口总览.md` 内容几乎一致，形成并列当前口径。
3. `03-代码参考`、`06-部署运维` 等目录存在同号文件并列，例如两个 `07-*` 调研文档、两个 `02-*` 变更记录。
4. 快速开始文档大量保留 `v0.0.1` 与“过渡文档”口径，但仍处在当前导航体系内。
5. 用户侧产品命名已经转为“故事经纬 / 经纬”，但部分用户向文档仍以 `Bible` 作为主称呼。
6. NarraFork、Claude Code、小说写作与 AI 调研等参考资料没有和当前产品事实硬隔离，容易被误读为当前实现承诺。

本 spec 采用“当前事实优先”的 Hub-and-Spoke 文档体系，目标是建立一个长期可维护、LLM 友好、可验证的 NovelFork 文档中心。

## 外部经验依据

本 spec 吸收 GitHub 上相关 Claude skills 的通用做法，但不会直接复制其目录结构：

- `documentation-best-practices`：文档分层、frontmatter、无重复内容、错链与过期元数据检查。
- `three-tier-docs` / `docs-verify`：入口层、上下文层、详情层，以及断链、行数、文件数量验证。
- `documentation-standards`：Hub-and-Spoke、single source of truth、LLM 优先、机器可读契约优先。
- `documentation-specialist`：先按文档意图分类，再加载对应 workflow。
- `review-documentation` / `documentation-auditor`：文档必须反查代码和实际行为，识别 stale doc、incorrect claim、broken link。

## 范围原则

本 spec 只重构 `docs/` 文档体系和文档治理规则，不直接实现 Studio 功能、不调整产品 UI、不改 API 行为。

必须完成：

- 新文档目录体系设计。
- 当前 `docs/` 文件迁移、归并、归档和重命名规则。
- 根 README 和各目录 README 的新导航规则。
- 文档状态、单一事实源、引用和归档规则。
- 文档验证脚本或验证命令，至少覆盖断链、重复编号、README 漏列、状态字段和禁用口径扫描。

不在本 spec 范围内：

- 重写所有历史文档正文。
- 为所有 API 生成逐端点 OpenAPI 文档。
- 继续扩展旧前端 UIUX。
- 修改 `.kiro/specs/` 既有业务 spec 的需求范围。

## 文档状态定义

所有 docs 文档必须归入以下状态之一：

- **current**：当前事实或当前推荐使用方式，可作为根 README 快速入口。
- **planning**：已批准或正在执行的计划，不能冒充已完成事实。
- **reference**：外部项目、竞品、调研、历史经验或设计参考，不代表 NovelFork 当前承诺。
- **archived**：历史记录，仅供追溯；不得从快速导航作为当前入口。
- **deprecated**：已废弃口径或已被替代的方案；必须写明替代入口。

## Requirement 1：建立新的顶层 docs 架构

**User Story:** 作为开发者和 AI agent，我需要一套清晰的顶层文档分类，能立即区分当前事实、用户指南、架构设计、开发指南、API 契约、运行运维、测试质量、参考资料和历史归档。

### Acceptance Criteria

1. `docs/` 顶层目录必须调整为以下结构：
   - `00-文档治理/`
   - `01-当前状态/`
   - `02-用户指南/`
   - `03-产品与流程/`
   - `04-架构与设计/`
   - `05-开发者指南/`
   - `06-API与数据契约/`
   - `07-运行运维/`
   - `08-测试与质量/`
   - `90-参考资料/`
   - `99-历史归档/`
2. 根 `docs/README.md` 必须成为唯一总入口，只列当前事实、推荐入口和目录说明。
3. 每个顶层目录必须有 `README.md`，且 README 文件列表必须与实际文件一致。
4. `01-当前状态/` 必须是当前事实唯一入口，包含产品现状、能力矩阵、透明占位和当前执行主线。
5. `90-参考资料/` 中的内容不得描述为 NovelFork 当前路线，只能作为参考资料。
6. `99-历史归档/` 中的内容不得出现在根 README 的“当前快速导航”中。
7. 原 `docs/00-文档命名整理规则.md` 必须迁入 `00-文档治理/` 并升级为新体系规范。

## Requirement 2：建立单一事实源和引用规则

**User Story:** 作为维护者，我需要每类事实只有一个主文档，其他文档通过链接引用，避免同一事实在多个文档中漂移。

### Acceptance Criteria

1. 每个主题必须指定一个 single source of truth 文档，重复内容必须删除、归并或改为链接。
2. Studio API 总览只能保留一个 current 文档；重复的 `01-Studio API总览.md` / `01-Studio接口总览.md` 必须合并或归档。
3. NovelFork 版本变更记录只能保留一个 current 文档；重复历史变更记录必须归档或并入。
4. 小说写作与 AI 调研的精炼版和 archive 版必须明确分离：精炼版放入参考资料，archive 版放入历史归档或参考资料子归档，不得同号并列。
5. 用户侧文档必须使用“故事经纬 / 经纬”作为主称呼；`Bible` 只能出现在技术兼容说明、代码符号或历史引用中。
6. 当前状态文档不得复制大段架构、API、测试报告正文，只能摘要并链接到对应事实源。
7. 引用路径必须使用相对链接，且在验证中可解析。

## Requirement 3：区分当前事实、计划、参考和历史

**User Story:** 作为使用者，我需要从文档状态上明确知道某篇文档是当前可用事实、规划中能力、外部参考还是历史归档。

### Acceptance Criteria

1. 所有迁移后的 docs 文档 header 必须包含：版本、创建日期、更新日期、状态、文档类型。
2. 文档类型必须是：`current`、`planning`、`reference`、`archived`、`deprecated` 之一。
3. `planning` 文档必须引用对应 `.kiro/specs/<feature>/`，不能独立承诺未实现功能。
4. `reference` 文档必须在开头说明“仅供参考，不代表当前实现或承诺”。
5. `archived` 文档必须在开头说明归档原因和归档日期。
6. `deprecated` 文档必须写明替代文档入口。
7. 根 README 不得把 `reference`、`archived`、`deprecated` 文档列为当前事实入口。

## Requirement 4：迁移现有 docs 内容到新体系

**User Story:** 作为维护者，我需要把现有 51 篇文档有计划地迁移到新体系，而不是在旧体系上继续修补。

### Acceptance Criteria

1. 必须先生成迁移清单，列出每个旧路径的新路径、处理方式和原因。
2. 处理方式必须是以下之一：`move`、`merge`、`archive`、`delete-after-merge`、`rewrite-current`、`keep-reference`。
3. 已确认重复或过时的文档不得继续留在原目录作为 current 文档。
4. 快速开始文档必须重写为当前真实启动方式；若某些内容只适合历史环境，必须归档。
5. NarraFork 依赖参考、NarraFork 更新日志、NarraFork UIUX 调研必须进入 `90-参考资料/`，不得作为当前架构主线入口。
6. 平台迁移方案、平台回正规划、旧路线图失效说明等必须按实际状态移入 `99-历史归档/` 或保留为 `planning/reference`，不能混入当前使用指南。
7. 测试报告必须分为当前测试状态和历史报告，历史报告移入 `99-历史归档/测试报告归档/`。
8. 迁移完成后，旧顶层目录 `01-快速开始` 到 `07-测试报告` 不得继续作为 docs 当前体系顶层目录存在。

## Requirement 5：根 README 和目录 README 必须成为导航索引

**User Story:** 作为新读者，我需要通过 README 快速知道该看哪篇文档，并能判断文档是否当前有效。

### Acceptance Criteria

1. 根 README 必须包含：项目文档定位、当前推荐阅读路径、当前事实入口、目录结构、文档状态说明、维护规则入口。
2. 根 README 的“快速导航”只能指向 `current` 或明确标注的 `planning` 文档。
3. 每个目录 README 必须包含：目录职责、适合阅读的人、文件列表、状态列、维护说明。
4. README 文件列表必须与实际文件一致，不得漏列或列出不存在文件。
5. README 不得复制子文档长正文，只能摘要和链接。
6. 如果某目录下存在 `reference` 或 `archived` 文档，README 必须明确标注其非当前事实属性。

## Requirement 6：建立文档验证与质量门禁

**User Story:** 作为开发者和 AI agent，我需要在提交前自动或半自动发现断链、重复编号、过时状态和禁用口径，避免文档体系再次腐化。

### Acceptance Criteria

1. 必须提供固定文档验证入口：`scripts/verify-docs.ts`，并在 `package.json` 暴露 `docs:verify` 脚本，执行命令为 `bun run docs:verify`。
2. 验证必须检查所有 Markdown 相对链接是否指向存在的文件或锚点所在文件。
3. 验证必须检查同一目录内编号前缀是否重复，README 除外。
4. 验证必须检查每个顶层目录是否有 README。
5. 验证必须检查 docs header 是否包含版本、创建日期、更新日期、状态和文档类型。
6. 验证必须扫描根 README 快速导航，不允许指向 `archived`、`deprecated` 文档。
7. 验证必须扫描用户侧 current 文档，不允许把 `Bible` 作为主称呼；允许代码符号、数据库表和历史引用。
8. 验证必须扫描禁用口径，包括把 `process-memory` 写成持久化、把 `prompt-preview` 写成真实写入、把 unsupported 写成已完成、把 mock/fake/noop 假成功写成真实能力。
9. 验证失败时必须输出具体文件、问题类型和修复建议。
10. 完成迁移前必须运行验证并记录结果。

## Requirement 7：迁移过程必须保护历史和 Git 可审查性

**User Story:** 作为项目维护者，我需要文档重构可审查、可追踪，不能因为一次迁移导致历史信息丢失或 diff 不可读。

### Acceptance Criteria

1. 迁移必须分批执行，优先迁移治理、当前状态、README 和重复文档。
2. 删除文档前必须确认其内容已合并、归档或确认为无价值重复。
3. 大规模移动必须保留迁移映射文档，便于追踪旧路径到新路径。
4. 历史文档不要求全部重写，但必须在新位置标明历史属性。
5. 当前事实文档必须优先对照代码、spec、测试或已知运行状态，不得凭旧文档改写。
6. 迁移完成后必须保留一份验收报告，记录迁移数量、合并数量、归档数量、删除数量和验证结果。
