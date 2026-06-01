# Novel Creation Workbench Complete Flow Requirements

**版本**: v1.0.0
**创建日期**: 2026-04-28
**更新日期**: 2026-04-28
**状态**: 📋 规划中

---

## 背景

此前 `project-wide-real-runtime-cleanup` 已完成反 mock 清理：生产源码剩余 mock 命中均已登记、允许或透明化，`must-replace` 项为 0。但浏览器实测暴露出新的产品层问题：

1. UI 主题 token 未生效，`bg-primary`、`text-primary`、`border-border` 等 Tailwind 类未生成，导致大量按钮呈现为同一类透明背景、黑字、灰边。
2. 资源管理器已经存在，但仍偏“章节树入口”，还不能稳定查看小说全部主要资源。
3. 小说创作闭环不完整：新建章节、导出、草稿查看、写作模式安全应用、经纬资料完整编辑等仍有断点。
4. 已实现能力没有被准确沉淀到 docs，部分 docs 重复、过时或无法反映真实边界。

本 spec 的目标是把 Studio 从“功能点分散可用”推进到“用户能围绕小说资源完成完整创作流程”的工作台。

## 范围原则

本 spec 采用“大而全小说创作工作流”范围，但按阶段落地：

- Phase 0：先把已完成能力和边界写入 docs，修正文档口径。
- Phase 1：修复 UI/UX 基础主题与组件可辨识度。
- Phase 2：做实小说资源管理器。
- Phase 3：补齐小说创作闭环。
- Phase 4：统一流程状态与数据一致性。
- Phase 5：建立测试、浏览器实测与验收报告。

资源管理器优先做“小说资源树级”，不做通用 IDE 文件浏览器。后续可扩展高级文件系统视图，但不是本 spec 的首轮目标。

## 状态定义

所有功能、文档和测试必须使用一致状态：

- **真实可用**：有真实 API、持久化或真实 runtime 调用，失败时返回真实错误。
- **透明过渡**：UI/接口明确标注未接入、process-memory、prompt-preview 或 unsupported；不会假装完成。
- **内部示例**：只用于开发/测试/demo，不能作为生产入口。
- **待废弃/待迁移**：已有替代路线，仍存在兼容入口但不应继续扩展。

## Requirement 1：文档必须真实反映当前能力

**User Story:** 作为开发者和使用者，我需要从 docs 中准确看到 Studio 当前真实可用能力、透明占位和未接入功能，避免根据过时文档误判产品状态。

### Acceptance Criteria

1. 新增 `docs/02-核心架构/02-Studio工作台/01-Studio功能现状总览.md`，列出已真实接入、透明过渡、内部示例、待废弃能力。
2. 新增 `docs/02-核心架构/02-Studio工作台/02-小说创作流程总览.md`，从用户视角说明创建作品、资源浏览、章节写作、AI 候选、经纬资料、检查和导出的完整流程。
3. 新增 `docs/05-API文档/02-创作工作台接口.md`，整理创作工作台相关真实 API、请求/响应、持久化边界和透明过渡语义。
4. 新增 `docs/07-测试报告/03-真实运行时与Mock清理验收报告.md`，记录反 mock 清理结果、mock scan 摘要、浏览器 UI 审计结论和仍需后续处理的透明过渡项。
5. 合并或归档重复 API 总览文档，不能保留两个内容几乎一致的 `01-Studio API总览.md` 与 `01-Studio接口总览.md` 作为并列当前口径。
6. 审计并更新过时文档；凡是仍引用旧前端主线、旧 provider 口径、旧 mock 状态、旧 Bible 用户命名或已废弃路线图的文档，必须改为当前事实、标注历史归档，或移入 `docs/07-测试报告/02-历史归档/`。
7. docs 不得把 `process-memory` 写成持久化，不得把 `prompt-preview` 写成真实写入，不得把 `unsupported` 写成已完成。
8. 每篇新增文档必须符合 `docs/00-文档命名整理规则.md` 的 header 和目录规范。

## Requirement 2：UI 主题 token 和组件状态必须可辨识

**User Story:** 作为用户，我需要能一眼分辨主按钮、次按钮、当前选中、禁用、危险、未接入等状态，不能所有组件看起来都是同一种颜色。

### Acceptance Criteria

1. Tailwind 必须生成项目主题类，包括 `bg-primary`、`text-primary`、`text-primary-foreground`、`bg-muted`、`text-muted-foreground`、`border-border`、`bg-card`、`bg-destructive`。
2. `tailwind.config.js` 必须映射 `index.css` 中的 CSS variable color tokens。
3. `/app-next` 浏览器实测时，关键按钮 computed style 不得集中为同一种透明背景、黑字、灰边样式。
4. Workspace、Dashboard、Settings、Routines 的高频裸 `<button>` 必须优先迁移到统一 Button/Badge/Card 语义，或至少使用与 Button variant 一致的 class。
5. 主操作、次操作、危险操作、禁用操作、透明占位操作必须有不同视觉状态。
6. Disabled 按钮必须有明显禁用态、不可点击 cursor 和原因文案或 title。
7. Active route、active section、active resource node、active tab 必须有清晰选中态。
8. 透明占位必须使用 `UnsupportedCapability` 或等价 dashed/unsupported 视觉语义。

## Requirement 3：资源管理器必须成为查看小说的主入口

**User Story:** 作为作者，我需要在工作台左侧资源管理器中看到并打开小说的主要资源，而不是只能看到少量章节入口或空壳分类。

### Acceptance Criteria

1. 资源管理器必须展示当前作品、卷、正文章节、AI 候选稿、草稿、大纲、经纬资料、Story 文件、Truth 文件、素材和发布检查结果。
2. 每个资源节点点击后必须进入明确的 editor、viewer 或 unsupported 状态；不得无反应。
3. 正文章节节点必须打开可编辑正文，并能保存。
4. AI 候选稿节点必须打开候选稿正文，并显示合并、替换、另存草稿、放弃等非破坏性操作。
5. 草稿节点必须来自真实数据源；不得永久使用 `drafts: []` 作为产品状态。
6. 大纲节点必须能查看真实大纲文件或结构化大纲；若不存在，应提供创建入口或明确空状态。
7. 经纬资料分类必须能进入列表/详情视图，不得只显示数量壳子。
8. Story/Truth 文件节点至少支持 Markdown/Text viewer；关键文件如 `pending_hooks.md`、`chapter_summaries.md`、style/profile、book rules 必须可查看。
9. 素材节点必须能查看已导入素材或明确显示暂无素材。
10. 资源树刷新后必须反映新建章节、导入章节、生成候选稿、另存草稿、写入 hook 等真实变化。
11. 资源管理器第一版不要求浏览任意项目文件系统。

## Requirement 4：章节创建、编辑、保存和导入必须形成闭环

**User Story:** 作为作者，我需要能创建新章节、导入已有稿件、编辑正文并可靠保存。

### Acceptance Criteria

1. `新建章节` 不得继续作为 disabled 占位；必须能创建章节记录和章节正文文件/存储记录。
2. 新建章节时应支持默认标题，也可让用户输入标题。
3. 新建章节完成后，资源树必须出现该章节并自动打开编辑器。
4. 章节编辑器必须保留当前保存状态：加载中、未修改、未保存、保存中、已保存、失败。
5. 保存失败时不得丢失用户未保存正文。
6. 导入章节文本后，章节必须进入资源树，并可逐章打开。
7. URL 导入若未真实完成，必须明确标注 unsupported 或透明过渡；不得返回假成功。
8. 章节 word count、章节状态和更新时间必须从真实章节数据计算或展示 unknown。

## Requirement 5：AI 候选稿和草稿必须非破坏性管理

**User Story:** 作为作者，我需要 AI 生成内容先进入候选区或草稿区，经我确认后才能影响正式章节。

### Acceptance Criteria

1. AI 生成下一章的结果必须进入候选稿列表，不得直接覆盖正式章节。
2. 候选稿必须保存正文内容、来源动作、目标章节、生成时间和状态。
3. 候选稿打开时必须展示真实候选正文，不得使用空 textarea 冒充正文。
4. 合并候选稿到正式章节前必须有确认步骤，并说明追加/合并范围。
5. 替换正式章节前必须有确认步骤，并说明影响范围。
6. 另存草稿后，草稿必须在资源树中出现并可打开。
7. 放弃候选稿后，候选稿状态必须变更为 rejected 或 archived，并从默认候选列表中隐藏。
8. AI 失败时不得生成假候选稿。

## Requirement 6：写作模式必须从 prompt-preview 升级到安全应用流程

**User Story:** 作为作者，我希望续写、扩写、对话生成、多版本、大纲分支等写作模式能够帮助我生成内容，并在确认后写入指定位置。

### Acceptance Criteria

1. 当前 `prompt-preview` 模式必须在 docs 和 UI 中明确标注为过渡态。
2. 每个写作模式必须支持生成结果预览或继续保持明确 prompt-preview，不得假装已写入正文。
3. 写作模式真实应用时必须走：生成/预览 → 选择应用位置 → 用户确认 → 写入章节/候选稿/草稿。
4. 应用到正式章节必须保留原内容可恢复策略，至少通过确认和非破坏性候选稿路径保护。
5. Inline write、dialogue generate、variant compare、outline branch 的应用按钮不得是 noop。
6. 如果某个模式暂未接入真实生成或写入，按钮必须 disabled 并说明原因。

## Requirement 7：AI 动作必须接真实 route 或明确未接入

**User Story:** 作为作者，我点击 AI / 经纬面板中的动作时，需要真实结果、候选稿或明确错误，而不是“即将推出”掩盖假功能。

### Acceptance Criteria

1. `生成下一章` 必须调用真实 route 并进入候选稿。
2. `续写当前段落`、`审校当前章`、`改写选中段落`、`去 AI 味`、`连续性检查` 必须接真实 route、生成候选/报告，或明确显示 unsupported。
3. 每个 AI 动作必须通过 runtime model gate 检查可用模型。
4. 模型不可用、凭据缺失、adapter unsupported 时必须显示真实错误，不得生成假内容。
5. AI 结果必须包含 provider/model/run metadata 或可追踪来源。
6. 运行中、成功、失败状态必须在 UI 上清晰显示。

## Requirement 8：经纬资料必须能在工作台内查看和编辑

**User Story:** 作为作者，我需要在写作过程中查看和维护人物、地点、势力、物品、伏笔、世界规则等经纬资料，并让它们参与上下文。

### Acceptance Criteria

1. Workspace 中的经纬资料分类必须打开真实列表，不得只显示“经纬资料详情”和数量。
2. 用户必须能新建、查看、编辑人物、地点、势力、物品、伏笔、世界规则条目。
3. 经纬条目必须持久化，刷新后仍存在。
4. 经纬面板当前 404 问题必须修复。
5. 经纬条目必须支持与章节或资源关联，至少在详情中展示关联信息。
6. 伏笔条目必须能与 `pending_hooks.md` 或结构化 hook 数据产生可追踪关系。
7. 未接入的高级经纬能力必须透明显示，不得假成功。

## Requirement 9：大纲、发布检查和导出必须接入创作闭环

**User Story:** 作为作者，我需要从大纲规划章节、检查发布准备，并把作品导出成可用格式。

### Acceptance Criteria

1. 大纲节点必须能查看和编辑真实大纲内容。
2. 若没有大纲，必须提供创建入口或明确空状态。
3. 大纲分支生成必须进入预览/候选结构，不得直接覆盖正式大纲。
4. 发布检查必须读取真实章节、字数、敏感词、AI 痕迹、连续性/unknown 指标，不能固定成功。
5. `导出` 不得继续 disabled；至少支持全书 Markdown 和 TXT 导出。
6. 导出必须支持全书、单卷或单章中的至少一种首版范围，并在 docs 中说明。
7. 导出失败必须显示真实错误。
8. 导出内容必须来自当前保存的章节数据。

## Requirement 10：流程状态和统计必须来自真实数据

**User Story:** 作为作者，我需要看到作品、章节、候选稿、经纬资料的真实状态，而不是 UI 自己伪造的标签。

### Acceptance Criteria

1. 作品状态必须从持久化数据或明确默认状态派生。
2. 章节状态必须支持 draft、writing、ready-for-review、approved、published 中的有效状态。
3. 候选稿状态必须支持 candidate、accepted、rejected、archived。
4. 经纬条目状态必须支持 active、unresolved、resolved、deprecated 或明确等价状态。
5. 资源树 badge、统计卡片、健康面板必须从真实数据计算。
6. 暂不能计算的指标必须显示 unknown，不得固定满分或固定成功。
7. 状态变更必须由 API/repository 统一处理，避免前端单独伪造。

## Requirement 11：测试必须证明真实可用，而不只证明 UI 渲染

**User Story:** 作为维护者，我需要测试覆盖真实数据流、持久化、浏览器视觉和完整创作路径，防止再次出现任务勾选但产品不可用。

### Acceptance Criteria

1. 必须保留并扩展 mock debt scan，确认无新增未登记 high-risk mock。
2. 必须有 docs 状态一致性测试或脚本，防止 docs 把透明占位写成真实完成。
3. 必须有 resource adapter 单元测试覆盖所有节点类型。
4. 必须有 route 测试覆盖章节创建、章节保存、候选稿、草稿、经纬、导出。
5. 必须有 UI 测试覆盖资源树点击、editor/viewer/unsupported 三类落点。
6. 必须有浏览器实测或自动化检查验证 Tailwind token 生效和按钮视觉分层。
7. 必须有最小端到端流程：创建作品 → 新建章节 → 写正文 → 保存 → 刷新打开 → 生成候选 → 另存草稿 → 合并/替换 → 健康检查 → 导出。
8. `pnpm run typecheck` 的既有失败项必须纳入本 spec 修复或明确作为阻塞，不得继续忽略。
9. 完成报告必须列出仍保留的透明过渡项。

## Non-goals

1. 不做通用 IDE 文件浏览器。
2. 不做任意项目文件批量编辑。
3. 不做多用户权限系统。
4. 不做真实第三方平台发布到起点/番茄/飞卢。
5. 不做云同步。
6. 不做桌面安装器。
7. 不强制在本 spec 中接入原生上游 streaming；已有 `chunked-buffer` 透明标注可保留。
8. 不把所有未来高级 AI 能力一次性做满；每个未接入能力必须透明化。
