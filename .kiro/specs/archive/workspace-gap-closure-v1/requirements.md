# 工作台缺口收敛 v1 — Requirements

**版本**: v1.0.0
**创建日期**: 2026-05-01
**状态**: 待审批

---

## 前置条件

本 spec 假设以下条件已满足：
1. `novel-creation-workbench-complete-flow` Phase 0-7 已完成（53/53 ✅）
2. `studio-frontend-rewrite` Phase 1+2 已完成
3. 所有 archived spec 的核心 API 底座可用

本 spec 只处理已有设计中未实现的部分，以及设计盲区。不引入新的架构方向。

---

## Requirement 1：写作模式必须能真正生成 AI 内容

**User Story:** 作为作者，我在工作台选择"续写当前段落"后，应该拿到 AI 实际续写的内容，而不是一段提示词说明。

**当前事实**: `novel-creation-workbench-complete-flow` Task 28 完成了 UI 侧的预览→目标选择→确认→写入流程，但 6 种写作模式（续写/扩写/补写/对话/多版本/大纲分支）的生成端点仍只返回 `promptPreview`，没有调用 LLM 生成真实正文。

### Acceptance Criteria

1. WHEN 用户在 InlineWritePanel 中选择续写模式并点击生成 THEN 系统 SHALL 调用 LLM 生成真实续写正文，将结果放入 preview 区域。
2. WHEN 用户选择扩写模式 THEN 系统 SHALL 基于当前场景生成扩写内容。
3. WHEN 用户选择对话生成模式 THEN 系统 SHALL 基于选定角色和场景生成符合角色性格的对话。
4. WHEN 用户选择多版本模式 THEN 系统 SHALL 生成 2-5 个不同版本供对比。
5. WHEN 用户选择大纲分支 THEN 系统 SHALL 生成 2-3 条走向建议。
6. WHEN 模型不可用时 THEN 系统 SHALL 返回 AI gate 结果并展示原因，不得假生成或静默失败。
7. WHEN 生成完成后 THEN 结果 SHALL 可通过 apply route 写入候选稿或草稿，不得直接覆盖正文。
8. THE 生成结果 SHALL 携带 provider、model、usage 等 AI metadata。

---

## Requirement 2：三个 AI 动作按钮必须从 unsupported 变为真实可用

**User Story:** 作为作者，我点击"审校当前章""去 AI 味""连续性检查"三个按钮后，应该拿到真实的 AI 分析结果。

**当前事实**: `novel-creation-workbench-complete-flow` Task 30 将这三种 action 标注为"没有真实 route 的返回 unsupported"。但对应的 API 底座均已存在：`POST /api/books/:id/audit/:chapter`（连续性审校）、`POST /api/books/:id/detect/:chapter`（AI 痕迹检测）。审校的连续性检查可直接复用 audit route，去 AI 味可复用 detect route + filter report。

### Acceptance Criteria

1. WHEN 用户在工作台点击"审校当前章" THEN 系统 SHALL 调用 audit route 对当前章节运行连续性审计，返回问题列表和建议。
2. WHEN 用户点击"去 AI 味" THEN 系统 SHALL 调用 detect route 运行 AI 痕迹检测，返回检测报告和消味建议。
3. WHEN 用户点击"连续性检查" THEN 系统 SHALL 运行连续性检查并输出冲突信息。
4. WHEN 章节尚未保存/不存在 THEN 系统 SHALL 返回明确错误，不假成功。
5. WHEN 模型不可用时 THEN 系统 SHALL 显示 AI gate 原因。
6. THE 分析结果 SHALL 以面板或弹窗形式展示，不得只返回"已启动"状态。

---

## Requirement 3：Truth/Story 文件名必须中文化

**User Story:** 作为作者，我在资源树"Story 文件"下看到的是 `pending_hooks.md`、`chapter_summaries.md` 而不是"待处理伏笔""章节摘要"，完全看不懂。

**当前事实**: `storage.ts` 中 `TRUTH_FILES` 常量定义 18 个英文文件名，API 直接返回原始文件名作为 title，前端 resource-adapter 直接使用未做映射。两个分组节点的标题（"Story 文件""Truth 文件"）已是中文，但内部文件标题全是英文。

### Acceptance Criteria

1. WHEN 系统列出 story/truth 文件 THEN 每个文件的用户可见标题 SHALL 使用中文本地化名称。
2. THE 系统 SHALL 为以下文件提供中文名映射（文件名 → 中文名）：
   - `story_bible.md` → 故事经纬
   - `volume_outline.md` → 卷大纲
   - `current_state.md` → 当前状态
   - `particle_ledger.md` → 资源账本
   - `pending_hooks.md` → 待处理伏笔
   - `chapter_summaries.md` → 章节摘要
   - `subplot_board.md` → 支线看板
   - `emotional_arcs.md` → 情绪弧线
   - `character_matrix.md` → 角色矩阵
   - `style_guide.md` → 风格指南
   - `setting_guide.md` → 设定指南
   - `parent_canon.md` → 原著设定（同人）
   - `fanfic_canon.md` → 二设记录（同人）
   - `book_rules.md` → 书籍规则
   - `author_intent.md` → 创作意图
   - `current_focus.md` → 当前焦点
   - `market_radar.md` → 市场雷达
   - `web_materials.md` → 网络素材
3. WHEN 文件没有预定义映射 THEN 系统 SHALL 使用原始文件名（去 `.md` 后缀）作为 fallback。
4. THE 映射 SHALL 在后端（storage.ts / API 响应）或前端（resource-adapter.ts）单一位置完成，不得两头各做一半。

---

## Requirement 4：章节/草稿/候选稿/经纬条目/文件必须可删除

**User Story:** 作为作者，我需要能删除不需要的章节、草稿、AI 生成的候选稿以及经纬条目。这是任何管理工具的基础功能。

**当前事实**: 所有 18 个 archived spec 的 requirements 中，提到删除的只有经纬条目的软删除 API（`DELETE /jingwei/entries/:id`）和整书删除（`DELETE /api/books/:id`）。章节、草稿、候选稿、truth/story 文件的删除不在任何 spec 的 requirements 里。

### Acceptance Criteria

1. WHEN 用户在资源树中右键章节节点 THEN 系统 SHALL 显示"删除章节"选项。
2. WHEN 用户确认删除章节 THEN 系统 SHALL 删除对应 Markdown 文件、从章节索引中移除、刷新资源树。
3. WHEN 用户查看草稿列表 THEN 每条草稿 SHALL 有删除按钮。
4. WHEN 用户查看候选稿 THEN 候选稿 SHALL 有删除按钮（区别于"放弃"——放弃只标记状态，删除会物理移除文件）。
5. WHEN 用户查看经纬分类列表 THEN 每条经纬条目 SHALL 有删除按钮（复用现有软删除 API）。
6. WHEN 删除操作不可逆 THEN 系统 SHALL 显示确认对话框，明确提示后果。
7. ALL 删除 API SHALL 返回操作结果，失败时返回真实错误。

---

## Requirement 5：设置页空壳分区必须有真实内容或明确降级标记

**User Story:** 作为用户，打开设置页看到的分区不应该是空壳。每个分区要么有真实配置，要么明确说明为什么还没有。

**当前事实**: `studio-frontend-rewrite` R7 要求 10 个分区，R12 要求每个分区有具体功能。但 tasks 中只有供应商页（A2）、项目配置（B6）和设置页导航（A3）有实现任务。模型配置详情、AI 代理详情、服务器与系统、使用历史等分区没有对应的实现任务。

### Acceptance Criteria

1. WHEN 用户打开设置页 THEN 每个导航分区 SHALL 在右侧显示对应内容。
2. FOR 模型分区：系统 SHALL 整合现有 RuntimeControlPanel 中的模型默认值、模型池配置和模型列表入口为一个可操作页面。
3. FOR AI 代理分区：系统 SHALL 展示默认权限模式、最大轮次、上下文阈值、WebFetch 代理模式等 RuntimeControlPanel 中已有的代理配置。
4. FOR 关于分区：系统 SHALL 展示版本号、commit hash、运行时信息（来自 ReleaseOverview 和启动日志）。
5. FOR 尚未有后端配置源的分区（如通知、外观界面、存储空间）：系统 SHALL 显示"此功能尚未开放"的明确文案和后续计划提示，不得显示空白区域或"暂无"。
6. THE 设置页 SHALL NOT 有分区点了之后右边完全空白。

---

## Requirement 6：首用引导流程必须有回归测试保障

**User Story:** 作为开发者，我需要确保新用户首次打开 NovelFork 后的"配置模型→创建第一本书→写第一章"流程不会在任何一步卡住。

**当前事实**: `onboarding-and-story-jingwei` Task 1（建立回归测试基线）和 Task 20（真实烟测）均为未勾选 [ ] 状态。首次欢迎弹窗（FirstRunDialog）、7 步任务清单（GettingStartedChecklist）、模型未配置降级建书——这些核心入门路径没有自动化测试覆盖。

### Acceptance Criteria

1. WHEN 系统无已配置模型 THEN FirstRunDialog SHALL 正确展示三个入口卡片（配置模型/创建第一本书/了解工作台模式）。
2. WHEN 用户点击"创建第一本书"且无模型 THEN 系统 SHALL 允许本地建书并给出模型配置引导（非硬阻断）。
3. WHEN 用户完成模型配置 THEN GettingStartedChecklist SHALL 更新完成状态。
4. WHEN 用户完成所有 7 个任务 THEN 清单 SHALL 显示全部完成状态。
5. THE 测试 SHALL 通过 vitest（UI 组件测试）执行，覆盖空状态、部分完成、全部完成三种状态。
6. THE 测试 SHALL 通过 vitest 或 Playwright 执行浏览器级烟雾测试，覆盖从首次打开到建书完成的完整路径。

---

## Requirement 7：资源树分组节点中文标题一致性

**User Story:** 作为作者，资源树中的所有分组名称应该统一使用中文，不出现英文或中英混合。

**当前事实**: 资源树顶层分组已在 resource-adapter.ts 中中文化（"已有章节""生成章节""草稿""经纬/资料库"等）。但 "Story 文件""Truth 文件" 两个分组标题仍是中英混合。

### Acceptance Criteria

1. WHEN 用户查看资源树 THEN "Story 文件"分组标题 SHALL 显示为"故事文件"。
2. WHEN 用户查看资源树 THEN "Truth 文件"分组标题 SHALL 显示为"真相文件"。
3. THE 资源树中 SHALL NOT 出现英文单词作为分组标题。

---

## Requirement 8：测试必须通过

**User Story:** 作为开发者，所有新增功能必须有对应的测试覆盖。

### Acceptance Criteria

1. ALL 新增 API routes SHALL 有对应的 route 层测试。
2. ALL 新增 UI 组件或修改的组件 SHALL 有对应的 UI 测试覆盖成功态、空数据态、加载失败态。
3. `bun run typecheck` SHALL 通过。
4. `bun run test` SHALL 通过（全量测试套件）。
5. 新增能力不得引入新的 mock/fake/noop 假成功。

---

## Non-goals

- 不做 ChatWindow 嵌入工作台布局（此改动影响三栏布局架构，需独立评估）
- 不做引导式创作流程串联（问卷/追问/核心变更的 Workspace UI 整合属于 `longform-cockpit-v1` 或后续 spec）
- 不做全文搜索功能
- 不做写作模式之外的新 AI 能力
- 不做设置页全新分区开发（只补齐已有骨架）
- 不做多用户、云同步
