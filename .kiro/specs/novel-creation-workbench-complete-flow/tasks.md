# Implementation Plan

## Overview

本任务清单从已确认的 `requirements.md` 与 `design.md` 生成，按 NovelFork 当前执行主线推进：先把已完成能力写入 docs，再修复 UI 主题和可辨识度，然后做实小说资源管理器，最后补齐章节、草稿、候选稿、经纬、大纲、AI 写作模式、发布检查和导出闭环。

执行时必须遵守 `.kiro/specs/README.md`：旧前端只修阻塞问题；新工作台不得恢复 mock/fake/noop 假成功；AI 输出必须先进入预览、候选稿或草稿，用户确认后才影响正式章节；未接入能力使用 transparent unsupported。

## Traceability Map

- Phase 0 → Requirement 1、Requirement 11；对应 docs 事实源、mock 清理验收、文档一致性检查。
- Phase 1 → Requirement 2、Requirement 11；对应 Tailwind theme token、组件状态可辨识、浏览器视觉验收。
- Phase 2 → Requirement 3、Requirement 4、Requirement 5、Requirement 8、Requirement 9、Requirement 10、Requirement 11；对应小说资源树、editor/viewer registry、新建章节、草稿、候选稿、story/truth viewer。
- Phase 3 → Requirement 4、Requirement 5、Requirement 6、Requirement 7、Requirement 10、Requirement 11；对应章节导入、writing modes 安全应用、AI actions、非破坏性候选稿流转。
- Phase 4 → Requirement 8、Requirement 9、Requirement 10、Requirement 11；对应经纬资料、大纲、发布检查、导出。
- Phase 5 → Requirement 10、Requirement 11；对应统一状态、真实统计、typecheck 阻塞修复。
- Phase 6 → Requirement 1 到 Requirement 11；对应 mock scan、浏览器闭环验收、最终测试报告。

## Tasks

### Phase 0：文档事实源与已实现能力沉淀

- [x] 1. 建立 Studio 当前能力总览文档
  - 创建 `docs/02-核心架构/02-Studio工作台/01-Studio功能现状总览.md`。
  - 按功能名称、用户入口、API/组件入口、数据来源、持久化状态、当前状态、已知限制、验证文件记录已实现能力。
  - 覆盖 provider runtime store、runtime model pool、session chat runtime、资源管理器、章节编辑、候选稿、writing tools、writing modes、transparent placeholders、internal demo。
  - 对齐 `packages/studio/src/api/lib/mock-debt-ledger.ts`，不得把 transparent-placeholder 写成真实可用。
  - 验证：人工对照 ledger、recent commits 与现有 route/UI 测试。

- [ ] 2. 建立小说创作流程总览文档
  - 创建 `docs/02-核心架构/02-Studio工作台/02-小说创作流程总览.md`。
  - 用用户视角描述创建作品、资源管理器、章节创建/导入、正文编辑保存、AI 候选稿、候选稿处理、经纬资料、写作工具、发布检查和导出流程。
  - 每一步标注当前状态：真实可用、透明过渡、内部示例、待迁移。
  - 明确 `process-memory`、`prompt-preview`、`chunked-buffer`、`unsupported` 的限制。
  - 验证：文档中所有“真实可用”条目必须能找到对应 API/组件/测试。

- [x] 3. 建立创作工作台 API 文档
  - 当前文档体系已迁移到 `docs/06-API与数据契约/02-创作工作台接口.md`。
  - 整理作品、章节、候选稿、草稿、story/truth 文件、经纬、writing modes、writing tools、providers/models、export 相关 API。
  - 标注请求体、响应体、持久化边界、错误语义和 transparent unsupported 语义。
  - 明确 writing modes 当前 prompt-preview 与后续 apply route 的边界。
  - 验证：API 文档路径必须能映射到 `packages/studio/src/api/routes/*` 或明确写为规划中的本 spec 目标。

- [x] 4. 建立真实运行时与 mock 清理验收报告
  - 当前文档体系已迁移到 `docs/08-测试与质量/02-真实运行时与Mock清理验收报告.md`。
  - 记录 `project-wide-real-runtime-cleanup` 的 30 个任务完成口径、mock scan 摘要、ledger 状态统计和剩余 transparent placeholders。
  - 写入浏览器 UI 审计结论：Tailwind token 未生成导致按钮同色。
  - 写入当前 `pnpm run typecheck` 失败项：`routes`、`novelfork-context`、`use-tabs` 类型问题。
  - 验证：报告中的 scan 摘要与 `mock-debt-scan.test.ts` 当前期望一致。

- [ ] 5. 合并重复 API 总览、更新过时文档并刷新 docs 索引
  - 对比 `docs/05-API文档/01-Studio API总览.md` 与 `docs/05-API文档/01-Studio接口总览.md`。
  - 保留一个当前 API 总览，另一个删除或移入 `docs/07-测试报告/02-历史归档/` 并标注归档状态。
  - 审计 docs 中仍引用旧前端主线、旧 provider/mock 口径、旧 Bible 用户命名、旧路线图或已被新 spec 替代的内容。
  - 对过时文档执行三选一：更新为当前事实、明确标注历史归档、或迁入 `docs/07-测试报告/02-历史归档/`。
  - 更新 `docs/README.md`、`docs/05-API文档/README.md`、相关目录 README 的文件列表。
  - 验证：docs 目录中不再有两个并列当前口径的 Studio API 总览；快速导航不再指向过时口径。

- [x] 6. 添加 docs 状态一致性检查
  - 复用并验证现有 `bun run docs:verify` 规则，扫描本 spec 新增/更新 docs。
  - 规则：`process-memory` 必须伴随“临时”或“不持久化”；`prompt-preview` 必须伴随“预览”或“未写入”；`unsupported` 不得与“已完成/真实可用”出现在同一功能状态中。
  - 将检查纳入相关 vitest 或 node 脚本。
  - 验证：故意违反规则时测试失败，恢复正确文案后通过。

### Phase 1：UI/UX 主题与组件可辨识度

- [ ] 7. 为 Tailwind theme token 写失败优先测试
  - 新增测试或构建检查，断言生成 CSS 包含 `.bg-primary`、`.text-primary`、`.text-primary-foreground`、`.bg-muted`、`.text-muted-foreground`、`.border-border`、`.bg-card`、`.bg-destructive`。
  - 先运行测试并确认当前失败原因是 Tailwind theme token 未映射。
  - 验证：测试失败输出能定位到缺失类名。

- [ ] 8. 映射 Tailwind 主题色到 CSS variables
  - 修改 `packages/studio/tailwind.config.js`，在 `theme.extend.colors` 中映射 `index.css` 已定义的 background、foreground、card、popover、primary、secondary、muted、accent、destructive、border、input、ring 及 foreground variants。
  - 保持 light/dark 主题继续由 CSS variables 驱动。
  - 验证：第 7 项测试通过，Vite 页面实际生成主题类。

- [x] 9. 统一 Button/Badge/Card 视觉语义测试
  - 为 `Button`、`Badge` 或集中 UI primitives 添加 variant 测试，覆盖 default、outline、secondary、ghost、destructive、link、disabled。
  - 测试主操作、次操作、危险操作、禁用操作的 class 差异。
  - 验证：组件 variant 差异可被测试断言捕捉。

- [x] 10. 迁移 Workspace 顶部和资源树高频按钮
  - 修改 `WorkspacePage` 顶部 `新建章节`、`导出`、`发布就绪`、`预设管理` 和资源树节点 action，使其使用 `Button`/统一语义 class。
  - Active resource node 使用清晰 primary 或 selected state。
  - Disabled action 必须有 title 或文案说明。
  - 验证：`WorkspacePage.test.tsx` 覆盖 active/disabled/primary/outline 状态。

- [x] 11. 迁移 Dashboard 创建/导入高频按钮
  - 修改 `DashboardPage` 创建新书、导入、提交创建、导入章节、导入 URL 等按钮语义。
  - 保持表单行为不变，视觉主次明确。
  - 验证：Dashboard 相关测试覆盖创建/导入按钮可用态与禁用态。

- [x] 12. 迁移写作模式、写作工具和候选稿操作按钮
  - 修改 Writing Modes tabs/actions、Writing Tools tabs/actions、CandidateEditor 合并/替换/另存草稿/放弃操作。
  - 合并/替换确认使用主操作，放弃候选使用 destructive，取消使用 outline。
  - 验证：UI 测试覆盖按钮文案、variant class 和禁用原因。

- [ ] 13. 建立浏览器 UI 可辨识度审计脚本
  - 新增浏览器实测脚本或测试说明，启动 `/app-next` 后读取 CSSOM 和 button computed style。
  - 断言主题类存在，启用按钮、禁用按钮、主操作、active tab 至少有不同 style groups。
  - 将脚本结果写入后续验收报告。
  - 验证：修复前的同色问题会失败，修复后通过。

### Phase 2：小说资源管理器做实

- [x] 14. 扩展资源节点类型与 adapter 测试
  - 扩展 `packages/studio/src/app-next/workspace/resource-adapter.ts` 的 node kind，覆盖 bible-entry、story-file、truth-file、material、publish-report。
  - 先写 `resource-adapter.test.ts` 用真实输入断言章节、候选稿、草稿、大纲、经纬、story/truth、素材、发布报告节点都生成。
  - 验证：新增测试先因缺节点类型或缺数据映射失败，再实现通过。

- [x] 15. 设计并实现 Workspace resource snapshot 数据结构
  - 新增共享类型 `WorkspaceResourceSnapshot` 或等价 contract。
  - 聚合 book、chapters、candidates、drafts、outline、bible summaries、storyFiles、truthFiles、materials、publishReports。
  - 首版可由前端并行 API 聚合；若新增 `/books/:id/resources`，route 必须返回同一结构。
  - 验证：类型和 adapter 测试覆盖空数据和有数据两类场景。

- [x] 16. 实现资源节点 editor/viewer registry
  - 在 Workspace 中抽出 `renderResourceNode` 或等价 registry。
  - 每个主要 node kind 必须映射到 ChapterEditor、CandidateEditor、DraftEditor、OutlineEditor、BibleCategoryView、BibleEntryEditor、MarkdownViewer、MaterialViewer、PublishReportViewer 或 UnsupportedCapability。
  - 删除静默 fallback 到空壳详情的路径。
  - 验证：UI 测试点击每类节点后都能看到明确 editor/viewer/unsupported。

- [ ] 17. 实现 Story/Truth 文件列表与读取 API
  - 新增或复用 route：列出 story files、truth files，并读取指定 Markdown/Text 文件。
  - 首批覆盖 `pending_hooks.md`、`chapter_summaries.md`、style/profile、book rules。
  - 文件不存在返回明确 empty/404 语义，不能返回假内容。
  - 验证：route 测试覆盖存在文件、缺失文件和路径安全边界。

- [ ] 18. 实现 Markdown/Text viewer
  - 新增 Workspace viewer 组件展示 story/truth/material 文本内容。
  - 支持加载中、错误、空内容、只读状态。
  - 点击 `pending_hooks.md` 时能显示真实内容或明确空态。
  - 验证：UI 测试覆盖 viewer 加载成功、404、空内容。

- [x] 19. 实现新建章节 route
  - 新增 `POST /books/:bookId/chapters` 或复用现有 route，实现创建新章节记录和正文存储。
  - 支持默认标题和用户传入标题。
  - 创建后更新章节索引并返回 `ChapterSummary`。
  - 验证：route 测试覆盖默认标题、自定义标题、重新实例化后章节仍存在。

- [x] 20. 接入 Workspace 新建章节 UI
  - 将 `新建章节` 从 disabled 改为真实操作。
  - 用户触发后创建章节，刷新资源树，自动选中新章节并打开 ChapterEditor。
  - 创建失败显示真实错误，不能产生前端假节点。
  - 验证：`WorkspacePage.test.tsx` 覆盖新建章节成功、失败、自动选中。

- [x] 21. 实现草稿 API 和存储边界
  - 新增或补齐 drafts list/read/write API。
  - 草稿必须包含 id、bookId、title、content、updatedAt、wordCount。
  - 候选稿另存草稿时必须创建可读取草稿。
  - 验证：route 测试覆盖草稿创建、读取、更新、重新实例化后仍存在。

- [x] 22. 接入 DraftEditor 与资源树草稿节点
  - 资源树从真实 drafts 数据生成草稿节点，不再永久使用 `drafts: []`。
  - 点击草稿打开 DraftEditor，可查看和保存草稿。
  - 候选稿另存草稿后刷新资源树并显示新草稿。
  - 验证：UI 测试覆盖草稿列表、打开、保存、由候选稿另存后出现。

- [x] 23. 做实候选稿正文读取与展示
  - 确认 candidate 存储包含正文内容；缺正文的候选稿显示真实错误或迁移提示。
  - CandidateEditor 加载并展示真实候选正文，不使用空 textarea 冒充内容。
  - 合并/替换/另存/放弃后刷新 candidate 状态和资源树。
  - 验证：route/UI 测试覆盖候选正文展示、状态变化和资源树刷新。

- [x] 24. 建立资源树 mutation 后刷新机制
  - 统一处理新建章节、导入章节、生成候选、另存草稿、放弃候选、写入 hook 后的资源快照刷新。
  - 避免前端只插入临时节点而不确认后端保存。
  - 验证：UI 测试覆盖每类 mutation 后重新读取 API 并更新资源树。

### Phase 3：章节、AI 候选、写作模式闭环

- [x] 25. 补齐章节导入与资源树联动测试
  - 覆盖 Dashboard 章节文本导入后，Workspace 资源树可看到导入章节。
  - URL 导入若未完成，改为明确 unsupported 或透明过渡响应。
  - 验证：导入章节 route/UI 测试通过，URL 未接入路径不会假成功。

- [x] 26. 为 writing modes apply 写失败优先测试
  - 新增 route 测试覆盖 `POST /books/:bookId/writing-modes/apply` 或等价应用端点。
  - 覆盖目标为 candidate、draft、chapter-insert、chapter-replace 的请求语义。
  - 首版正式章节 insert/replace 可转为 candidate，但必须返回非破坏性结果。
  - 验证：测试先因端点缺失或 noop 失败。

- [x] 27. 实现 writing modes 安全应用 route
  - 实现生成/预览结果写入 candidate 或 draft 的安全路径。
  - 正式章节写入必须经过确认；首版将 insert/replace 转成 candidate，避免编辑器 range 风险。
  - 返回写入目标、resource id、status 和可追踪 metadata。
  - 验证：第 26 项测试通过，AI 失败不产生假结果。

- [ ] 28. 接入 writing modes UI 应用流程
  - InlineWritePanel、DialogueGenerator、VariantCompare、OutlineBrancher 的应用按钮不再是 noop。
  - UI 显示预览、目标选择、确认、写入结果和错误状态。
  - 未接真实生成的模式保持 disabled 或 prompt-preview 透明说明。
  - 验证：UI 测试覆盖应用到 candidate/draft、错误展示、disabled 原因。

- [ ] 29. 建立 Workspace AI action route map 测试
  - 为 `write-next`、`continue`、`audit`、`rewrite`、`de-ai`、`continuity` 建立 action 到 route/result 的测试表。
  - 未实现 route 必须返回 unsupported，并在 UI 上透明显示。
  - 验证：测试防止 action 再次回到“即将推出”或本地假成功。

- [ ] 30. 补齐 Workspace AI action 实现或 unsupported 语义
  - `write-next` 保持真实生成候选稿路径。
  - `continue` 接 writing modes apply 或 preview/candidate 路径。
  - `audit`、`rewrite`、`de-ai`、`continuity` 接现有真实 route；没有真实 route 的返回 unsupported。
  - 每个 action 必须经过 runtime model gate，并显示运行中、成功、失败状态。
  - 验证：route/UI 测试覆盖成功、模型不可用、adapter unsupported、上游失败。

- [ ] 31. 记录 AI 结果 metadata
  - 候选稿、草稿、报告类 AI 结果保存 provider、model、run id 或 request metadata。
  - UI 中显示最小来源信息，便于用户知道结果来自哪个模型。
  - 验证：测试断言 metadata 被保存和返回。

### Phase 4：经纬、大纲、发布检查与导出

- [ ] 32. 修复 Workspace 经纬面板 404 并接入真实经纬数据
  - 检查 `BiblePanel` 使用的 API 路径与 `api/routes/bible.ts` 实际路径。
  - 修正路径或新增兼容 route，避免浏览器实测中的 404。
  - 验证：UI 测试和 route 测试覆盖人物/事件/设定/摘要加载成功或明确空态。

- [ ] 33. 实现 BibleCategoryView 与 BibleEntryEditor
  - Workspace 中点击人物、地点、势力、物品、伏笔、世界规则后显示真实列表。
  - 支持新建、查看、编辑条目，并持久化。
  - 未接的高级能力使用 UnsupportedCapability，不返回假成功。
  - 验证：UI/route 测试覆盖新建、编辑、刷新后仍存在。

- [ ] 34. 建立伏笔与 pending hooks 的可追踪关系
  - 在 hook 应用或经纬伏笔条目中记录来源章节、hook id、写入文件或结构化记录。
  - 资源树中 `pending_hooks.md` viewer 和伏笔列表能展示相关信息。
  - 验证：测试覆盖 hook apply 后可在 story file viewer 和伏笔视图中追踪。

- [ ] 35. 实现大纲 viewer/editor
  - 大纲节点打开真实大纲内容；无大纲时显示创建入口。
  - 支持创建和保存大纲 Markdown 或结构化 outline 记录。
  - 大纲分支生成进入 preview/candidate，不直接覆盖正式大纲。
  - 验证：route/UI 测试覆盖查看、创建、保存、生成预览。

- [ ] 36. 做实发布检查数据来源
  - 发布检查读取真实章节、字数、敏感词、AI 痕迹、连续性指标或 unknown。
  - 不能固定成功、固定满分或隐藏 unknown。
  - 结果可在资源树 publish-report 节点查看。
  - 验证：route/UI 测试覆盖有问题、无问题、unknown 指标三类结果。

- [ ] 37. 实现导出 route
  - 新增 `POST /books/:bookId/export` 或等价 route。
  - 首版支持全书 Markdown 和 TXT 导出，内容来自已保存章节。
  - 返回 fileName、contentType、content 或下载响应。
  - 验证：route 测试覆盖 markdown、txt、空书、章节读取失败。

- [ ] 38. 接入 Workspace 导出 UI
  - 将 `导出` 从 disabled 改为真实入口。
  - 支持选择格式并触发导出；失败显示真实错误。
  - 导出范围首版至少支持全书；如果支持单章，UI 必须显示当前范围。
  - 验证：UI 测试覆盖导出成功、失败、按钮状态和下载/内容结果。

### Phase 5：状态模型、统计与类型修复

- [ ] 39. 统一作品、章节、候选稿、经纬状态类型
  - 建立或收敛 BookStatus、ChapterStatus、CandidateStatus、BibleEntryStatus 类型。
  - API/repository 返回状态必须使用统一枚举或明确映射。
  - 前端只展示 API 状态，不在本地伪造业务状态。
  - 验证：类型测试和 route 测试覆盖有效状态、未知状态 fallback。

- [ ] 40. 让资源树 badge 和统计来自真实数据
  - 章节字数、候选稿数量、草稿数量、经纬数量、发布报告数量从 resource snapshot/API 计算。
  - 暂不能计算的指标显示 unknown 或空态，不固定为成功。
  - 验证：resource adapter 测试覆盖统计和 badge 显示。

- [ ] 41. 修复当前 typecheck 阻塞
  - 修复 `routes` 模块缺失、`novelfork-context` 模块缺失、`use-tabs.ts` 的 `Route`/`never` 类型问题。
  - 确认修复不违反旧前端冻结边界；旧前端只做类型/构建阻塞修复。
  - 验证：`pnpm --dir packages/studio run typecheck` 通过，或剩余失败被记录为本 spec 新阻塞任务。

### Phase 6：全链路测试与最终验收

- [ ] 42. 扩展 mock debt scan 防回归
  - 新增本 spec 新功能涉及的 mock/fake/noop 高风险词扫描规则或登记项。
  - 确认新增 transparent placeholders 都在 ledger 或 docs 中有明确状态。
  - 验证：`mock-debt-scan.test.ts` 与 `mock-debt-ledger.test.ts` 通过，新增未登记高风险命中会失败。

- [ ] 43. 建立最小创作闭环浏览器验收
  - 启动 `/app-next`，执行：创建作品 → 新建章节 → 写正文 → 保存 → 刷新打开 → 生成候选 → 另存草稿 → 合并/替换 → 健康检查 → 导出 Markdown/TXT。
  - 同时执行 CSSOM 与 computed style 检查。
  - 保存截图或记录关键输出到测试报告。
  - 验证：流程中任何一步失败都不能标记本 spec 完成。

- [ ] 44. 更新最终验收测试报告和 docs 索引
  - 更新 `docs/07-测试报告/03-真实运行时与Mock清理验收报告.md` 或新增后续验收章节。
  - 记录 vitest、typecheck、browser audit、mock scan、git diff check 的实际结果。
  - 更新 docs README 和相关目录 README 文件列表。
  - 验证：文档状态与实际测试结果一致。

- [ ] 45. 执行最终验证并整理剩余透明过渡项
  - 运行本 spec 涉及的 route/UI/unit 测试集合。
  - 运行 `pnpm --dir packages/studio run typecheck`。
  - 运行 mock debt scan。
  - 运行浏览器 UI/流程验收。
  - 运行 `git diff --check`。
  - 输出最终报告，列出真实完成项、仍保留的 transparent placeholders、未纳入范围的 non-goals。
