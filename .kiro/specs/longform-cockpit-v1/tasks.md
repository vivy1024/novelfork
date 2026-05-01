# 长篇驾驶舱 v2 — Tasks

**版本**: v2.0.0
**创建日期**: 2026-04-30
**修订日期**: 2026-05-01
**状态**: 待审批

---

## 前置条件

- `novel-creation-workbench-complete-flow` 已完成。
- `workspace-gap-closure-v1` 已完成（写作模式真生成、中文化、删除功能）。
- 当前 typecheck、vitest 全部通过。

---

## Phase 0：类型基础与风险计算（3 tasks）

- [ ] 1. 定义驾驶舱类型系统
  - 新建 `cockpit/cockpit-types.ts`
  - 定义 `CockpitSourceRef`、`CockpitSignal<T>`、`CockpitHookEntry`、`CockpitSettingEntry`、`CockpitRiskCard`、`HookRiskLevel`
  - 类型与已有 `BibleEvent`、`BibleSetting` 兼容
  - SourceRef.label 使用 `TRUTH_FILE_LABELS` 映射（从 storage.ts 导出或共享）
  - 验证：typecheck 通过

- [ ] 2. 实现伏笔过期风险计算
  - 新建 `cockpit/cockpit-risk.ts`，实现 `computeHookRisk(hook, currentChapter, threshold=15)`
  - 新建 `cockpit/cockpit-risk.test.ts`，TDD 覆盖：
    - open 且未过期（gap < 10）
    - payof-due（10 < gap ≤ 15）
    - expired-risk（gap > 15）
    - resolved（已回收）
  - 当前章节号来自 books API 的 `chapters.length` 或 `nextChapter`
  - 验证：`vitest run cockpit-risk.test.ts` 通过

- [ ] 3. 扩展右侧面板顶部 Tab，增加驾驶舱入口
  - 修改 WorkspacePage.tsx 右侧面板区域
  - 新增顶级 Tab：[驾驶舱] / [经纬] / [写作]
  - 驾驶舱为默认选中 Tab
  - 现有 BiblePanel 和 WritingModesPanel+WritingToolsPanel 保持在各自 Tab 内不变
  - 验证：WorkspacePage 测试覆盖 Tab 切换、默认选中驾驶舱

---

## Phase 1：总览 Tab（4 tasks）

- [ ] 4. 实现日更进度卡片
  - 在 CockpitOverviewTab 中展示
  - 调用 `/api/progress` API，展示：今日字数 / 日更目标、连续天数、本周累计
  - 无数据或加载中时显示占位
  - 验证：UI 测试覆盖有数据、无数据、加载失败

- [ ] 5. 实现当前焦点卡片
  - 读取 `current_focus.md` 内容（前 300 字）
  - 无内容时显示"尚未设置当前焦点" + 编辑入口（跳转到 truth-file 节点）
  - 验证：UI 测试覆盖有内容、无内容

- [ ] 6. 实现最近章节摘要
  - 调用 bible chapter-summaries API
  - 展示最近 3 条（章节号、标题、一句话摘要）
  - 每条可点击跳转到对应章节节点
  - 无摘要时显示"暂无章节摘要"
  - 验证：UI 测试覆盖有摘要、无摘要、跳转

- [ ] 7. 实现风险卡片区域
  - 调用 `/books/:id` 获取章节索引中的 `auditIssues`
  - 展示：过期/快过期伏笔数量 + 审计失败章节列表
  - 每条风险可点击跳转
  - 无风险时显示"暂无风险 ✓"
  - 验证：UI 测试覆盖有风险、无风险、跳转

---

## Phase 2：伏笔 Tab（2 tasks）

- [ ] 8. 实现伏笔聚合列表
  - 聚合两个来源：经纬 events（foreshadow）和 `pending_hooks.md` 解析结果（复用 `parsePendingHookEntries`）
  - 每条展示：hook id、文本摘要、来源章节、状态、来源文件（中文 label）
  - 状态标签使用 `computeHookRisk` 计算结果着色
  - 支持按状态过滤（全部/open/payoff-due/expired-risk/resolved）
  - 验证：UI 测试覆盖有伏笔、无伏笔、混合来源、过期高亮、状态过滤

- [ ] 9. 伏笔跳转
  - 点击伏笔 → 跳转到来源资源节点
  - 经纬伏笔 → `bible-entry` 节点
  - pending_hooks.md → `story-file:pending_hooks.md` 节点
  - 验证：UI 测试覆盖两种跳转

---

## Phase 3：设定 Tab（2 tasks）

- [ ] 10. 实现设定聚合展示
  - 展示经纬 settings 条目，按 category 分组（world-rule/location/faction/item）
  - 展示 `book_rules.md` 内容摘要（前 500 字）
  - 展示 `particle_ledger.md` 内容摘要（前 500 字）
  - 所有文件标题使用中文本地化 label
  - 验证：UI 测试覆盖有设定、无设定、有 book_rules、无 book_rules

- [ ] 11. 设定跳转
  - 经纬 setting → bible-entry 节点
  - Truth 文件 → truth-file 节点
  - 验证：UI 测试覆盖跳转

---

## Phase 4：AI 运行 Tab（2 tasks）

- [ ] 12. 实现 AI 运行状态展示
  - 展示 provider / model 状态（来自 `/providers/status`）
  - 模型可用时显示 provider + model 名称，不可用时显示原因 + 配置入口
  - 展示最近 5 条候选稿的 AI metadata（provider、model、runId、生成时间）
  - 展示最近一次 AI 动作的摘要（来自 WorkspacePage 中保存的 action result data）
  - 验证：UI 测试覆盖模型可用、不可用、有候选稿、无候选稿

- [ ] 13. AI 运行错误与 unsupported 状态
  - route 不存在时显示 unsupported
  - 加载失败时显示 InlineError
  - 验证：UI 测试覆盖 unsupported 和 error 状态

---

## Phase 5：集成验证（3 tasks）

- [ ] 14. 全量 typecheck 与测试通过
  - `bun run typecheck` 通过
  - `bun run test` 全量通过
  - 验证：typecheck + vitest 均 exit 0

- [ ] 15. 更新文档
  - 更新 `docs/01-当前状态/02-Studio能力矩阵.md`，新增驾驶舱能力行
  - 更新 `.kiro/specs/README.md`，更新 `longform-cockpit-v1` 状态为已完成
  - 验证：`bun run docs:verify` 通过

---

## Done Definition

1. 右侧面板有三个 Tab：驾驶舱（默认）/ 经纬 / 写作
2. 总览 Tab 展示日更进度、当前焦点、最近摘要、风险卡片
3. 伏笔 Tab 聚合所有伏笔来源，支持状态过滤和跳转
4. 设定 Tab 展示世界规则和资源账本
5. AI Tab 展示模型状态和最近活动
6. 所有数据来源标注，所有文件使用中文 label
7. `bun run typecheck` + `bun run test` 全量通过
8. 无新增 mock/fake/noop 假成功
