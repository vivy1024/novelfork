# 长篇驾驶舱 v1 — Requirements

**版本**: v1.0.0
**创建日期**: 2026-04-30
**状态**: 待审批

---

## 前置条件

本 spec 假设 `novel-creation-workbench-complete-flow` Phase 7 剩余 5 项已完成或明确标记为 deferred。如果 Phase 7 未收尾，本 spec 不应开始执行。

---

## Requirement 1：右侧驾驶舱 Shell 必须可用

**User Story:** 作为作者，我需要在工作台右侧看到一个常驻的长篇驾驶舱面板，帮我快速了解当前创作状态，而不是在多个 Tab 之间来回切换。

### Acceptance Criteria

1. 工作台右侧必须新增一个可折叠的"长篇驾驶舱"面板，与现有 BiblePanel / WritingModesPanel / WritingToolsPanel 并列或替代右侧默认视图。
2. 驾驶舱必须包含至少 4 个 Tab：总览、伏笔、设定、AI 运行。
3. 窄屏（<1280px）时驾驶舱收起为抽屉或隐藏，不压缩中间编辑器。
4. 驾驶舱面板不得阻塞资源树或中间编辑区的正常操作。
5. 驾驶舱面板加载失败时显示 InlineError，不崩溃整个 WorkspacePage。

---

## Requirement 2：总览 Tab 必须展示当前创作决策所需信息

**User Story:** 作为作者，我需要在一个页面内回答"下一章该怎么写"，而不是分别打开 5 个文件。

### Acceptance Criteria

1. 总览 Tab 必须展示当前焦点（来自 `current_focus.md`，无内容时显示空状态提示）。
2. 总览 Tab 必须展示最近章节摘要（来自 bible chapter_summaries 或 `chapter_summaries.md`，最多 3 条）。
3. 总览 Tab 必须展示待处理风险卡片（快过期伏笔、审计失败章节、state-degraded），无风险时显示"暂无风险"。
4. 每条风险卡片必须可点击跳转到对应资源节点（章节、伏笔条目、Truth 文件）。
5. 数据来源必须标注 source（文件名或 API 路径），不得伪造来源。
6. 无法解析的数据必须显示 unknown 或 empty，不得显示假内容。

---

## Requirement 3：伏笔 Tab 必须聚合所有伏笔来源

**User Story:** 作为作者，我需要在一个列表中看到所有伏笔的状态、来源和关联，判断哪些需要回收。

### Acceptance Criteria

1. 伏笔 Tab 必须聚合两个来源：经纬 events（eventType=foreshadow）和 `pending_hooks.md` 解析结果。
2. 每条伏笔必须展示：hook id、文本摘要、来源章节、当前状态、来源文件。
3. 伏笔状态至少区分：open（已埋）、reinforced（待强化）、payoff-due（待回收）、expired-risk（过期风险）、resolved（已回收）。
4. 过期风险的判定规则：open 状态且距离来源章节超过 N 章（N 可配置，默认 15）。
5. 点击伏笔必须能跳转到来源资源节点（`pending_hooks.md` viewer 或经纬伏笔条目）。
6. 标记伏笔状态变更必须通过真实 API（经纬 events update 或 pending_hooks.md 编辑），不允许仅 UI 本地改状态。

---

## Requirement 4：设定 Tab 必须展示世界规则和风险

**User Story:** 作为作者，我需要快速看到当前世界规则、战力体系和资源账本，避免下一章写崩设定。

### Acceptance Criteria

1. 设定 Tab 必须展示经纬 settings 条目（按 category 分组：world-rule、location、faction、item）。
2. 设定 Tab 必须展示 `book_rules.md` 内容（如果存在）。
3. 设定 Tab 必须展示 `particle_ledger.md` 摘要（如果存在）。
4. 点击设定条目必须能跳转到经纬编辑器或 Truth 文件 viewer。
5. 无设定数据时显示空状态提示，不显示假规则。

---

## Requirement 5：AI 运行 Tab 必须展示透明的 AI 状态

**User Story:** 作为作者，我需要知道 AI 当前在做什么、用了什么模型、结果去了哪里。

### Acceptance Criteria

1. AI 运行 Tab 必须展示当前 provider / model 状态（来自 model gate）。
2. AI 运行 Tab 必须展示最近一次 AI action 的类型、状态、输出容器（候选稿/草稿/报告/预览）。
3. 候选稿和草稿必须展示 AI metadata（provider、model、runId/requestId）。
4. 模型不可用时必须显示原因，不允许静默失败。
5. route 不存在或未接入时显示 unsupported。

---

## Requirement 6：驾驶舱数据必须来自已有 API，不新增写入能力

**User Story:** 作为开发者，我需要驾驶舱 v1 只做只读聚合，不引入新的写入路径，避免破坏现有数据流。

### Acceptance Criteria

1. 驾驶舱 v1 不得新增任何修改章节、候选稿、草稿、经纬或 Truth 文件的 API。
2. 驾驶舱数据必须通过前端聚合已有 API 获取（books、chapters、candidates、drafts、bible、truth-files、story-files、providers/status）。
3. 如果需要新增 API，只允许新增只读聚合接口（如 `GET /api/books/:id/cockpit/snapshot`），且该接口不修改任何数据。
4. 驾驶舱中的"跳转"操作必须复用现有资源树节点选择机制，不新增独立导航体系。

---

## Requirement 7：驾驶舱必须有测试覆盖

**User Story:** 作为开发者，我需要驾驶舱的每个 Tab 都有 UI 测试，防止回归。

### Acceptance Criteria

1. 每个 Tab 必须有至少一个 UI 测试覆盖：有数据、无数据、加载失败三种状态。
2. 跳转到资源节点的交互必须有测试覆盖。
3. 伏笔过期风险计算必须有单元测试。
4. 如果新增 cockpit snapshot API，必须有 route 测试覆盖有数据、空数据、book 不存在三种情况。
5. typecheck 必须通过。

---

## Non-goals

- 不做章节作战卡生成（Phase 2 目标）。
- 不做主线偏航分析（Phase 3 目标）。
- 不做人物反差 Tab（Phase 2 目标，数据模型需要扩展）。
- 不做章节影响 Tab（Phase 3 目标，依赖 RuntimeStateDelta）。
- 不做驾驶舱内的直接编辑操作（所有编辑回到已有 editor）。
- 不做 Cockpit Snapshot API（Phase 2 目标，v1 用前端聚合）。
- 不做多用户、云同步、桌面安装器。
