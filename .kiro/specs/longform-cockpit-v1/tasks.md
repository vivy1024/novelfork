# 长篇驾驶舱 v1 — Tasks

**版本**: v1.0.0
**创建日期**: 2026-04-30
**状态**: 待审批

---

## 前置条件

- `novel-creation-workbench-complete-flow` Phase 7 剩余 5 项已完成或明确 deferred。
- 当前 typecheck、vitest、docs:verify 全部通过。

---

## Phase 0：类型基础与风险计算（3 tasks）

- [ ] 1. 定义驾驶舱类型系统
  - 新建 `cockpit/cockpit-types.ts`，定义 `CockpitSourceRef`、`CockpitSignal<T>`、`CockpitHookEntry`、`CockpitSettingEntry`、`CockpitRiskCard`、`HookRiskLevel`。
  - 类型必须与已有 `BibleEvent`、`BibleSetting`、`TruthFileDetail` 兼容。
  - 验证：typecheck 通过。

- [ ] 2. 实现伏笔过期风险计算函数
  - 新建 `cockpit/cockpit-risk.ts`，实现 `computeHookRisk(hook, currentChapter, threshold)`。
  - 默认 threshold = 15 章。
  - 新建 `cockpit/cockpit-risk.test.ts`，TDD 覆盖：open 且未过期、open 且接近过期（payoff-due）、open 且已过期（expired-risk）、resolved、frozen。
  - 验证：`vitest run cockpit-risk.test.ts` 通过。

- [ ] 3. 实现驾驶舱数据聚合 hooks
  - 新建 `cockpit/cockpit-hooks.ts`，实现 `useCockpitData(bookId)` hook。
  - 内部并行调用已有 API：current_focus、chapter-summaries、events、settings、pending_hooks.md、book_rules.md、particle_ledger.md、providers/status。
  - 返回 `CockpitSignal` 包装的各项数据。
  - 验证：typecheck 通过；hook 可在测试中 mock 验证调用路径。

---

## Phase 1：驾驶舱 Shell 与总览 Tab（3 tasks）

- [ ] 4. 实现 CockpitPanel Shell
  - 新建 `cockpit/CockpitPanel.tsx`，包含 4 个 Tab 切换（总览/伏笔/设定/AI）。
  - 接入 WorkspacePage 右侧面板区域，与 BiblePanel / WritingModesPanel / WritingToolsPanel 并列为顶级 Tab。
  - 窄屏时不渲染驾驶舱（复用现有 xl breakpoint 逻辑）。
  - 验证：UI 测试覆盖 Tab 切换、窄屏隐藏。

- [ ] 5. 实现总览 Tab
  - 新建 `cockpit/CockpitOverviewTab.tsx`。
  - 展示当前焦点（current_focus.md 内容或空状态）。
  - 展示最近 3 条章节摘要（bible chapter-summaries）。
  - 展示风险卡片（伏笔过期风险、审计失败章节）。
  - 风险卡片可点击跳转到资源节点。
  - 验证：UI 测试覆盖有数据、无数据、加载失败三种状态；跳转交互测试。

- [ ] 6. 接入 WorkspacePage 跳转机制
  - CockpitPanel 接收 `onNavigate(nodeId)` 回调。
  - WorkspacePage 传入 `setSelectedNodeId` 作为 onNavigate。
  - 点击驾驶舱中的来源链接触发资源树节点选择。
  - 验证：UI 测试覆盖点击伏笔来源后资源树选中对应节点。

---

## Phase 2：伏笔 Tab（2 tasks）

- [ ] 7. 实现伏笔 Tab
  - 新建 `cockpit/CockpitHooksTab.tsx`。
  - 聚合经纬 events（foreshadow）和 pending_hooks.md 解析结果。
  - 每条伏笔展示：hook id、文本、来源章节、状态（open/payoff-due/expired-risk/resolved）、来源文件。
  - 支持按状态过滤。
  - 过期风险使用 `computeHookRisk` 计算。
  - 验证：UI 测试覆盖有伏笔、无伏笔、混合来源、过期风险高亮。

- [ ] 8. 伏笔跳转与来源追踪
  - 点击伏笔条目跳转到对应资源节点（pending_hooks.md story-file 或经纬伏笔 bible-entry）。
  - 来源标注 `CockpitSourceRef`。
  - 验证：UI 测试覆盖点击跳转。

---

## Phase 3：设定 Tab（2 tasks）

- [ ] 9. 实现设定 Tab
  - 新建 `cockpit/CockpitSettingsTab.tsx`。
  - 展示经纬 settings 条目（按 category 分组）。
  - 展示 `book_rules.md` 内容（如果存在）。
  - 展示 `particle_ledger.md` 摘要（如果存在）。
  - 点击条目跳转到经纬编辑器或 Truth 文件 viewer。
  - 验证：UI 测试覆盖有设定、无设定、有 book_rules、无 book_rules。

- [ ] 10. 设定来源跳转
  - 设定条目点击跳转到 `bible:settings` 或 `truth-file:book_rules.md` 资源节点。
  - 验证：UI 测试覆盖跳转。

---

## Phase 4：AI 运行 Tab（2 tasks）

- [ ] 11. 实现 AI 运行 Tab
  - 新建 `cockpit/CockpitAiTab.tsx`。
  - 展示 provider / model 状态（来自 providers/status）。
  - 展示最近候选稿的 AI metadata（provider、model、runId）。
  - 模型不可用时显示原因。
  - 验证：UI 测试覆盖模型可用、不可用、有候选稿 metadata、无候选稿。

- [ ] 12. AI 运行 unsupported 与错误状态
  - route 不存在时显示 unsupported。
  - 加载失败时显示 InlineError。
  - 验证：UI 测试覆盖 unsupported 和 error 状态。

---

## Phase 5：集成验证（3 tasks）

- [ ] 13. 全量 typecheck 与测试通过
  - `pnpm typecheck` 通过。
  - `pnpm --dir packages/studio exec vitest run` 全量通过。
  - `pnpm docs:verify` 通过。
  - 验证：三个命令 exit 0。

- [ ] 14. 更新文档与 spec README
  - 更新 `docs/01-当前状态/02-Studio能力矩阵.md`，新增驾驶舱能力行。
  - 更新 `docs/04-架构与设计/06-长篇驾驶舱设计.md`，标注 Phase 1 已完成。
  - 更新 `.kiro/specs/README.md`，新增 `longform-cockpit-v1` spec 状态。
  - 验证：`pnpm docs:verify` 通过。

- [ ] 15. 最终验证与提交
  - `git diff --check` 无 whitespace error。
  - 所有新增文件已暂存。
  - 提交信息格式：`feat(studio): add longform cockpit v1 read-only panel`。
  - 验证：`git status` 干净。
