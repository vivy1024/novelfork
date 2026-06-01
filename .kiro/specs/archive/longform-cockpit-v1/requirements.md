# 长篇驾驶舱 v2 — Requirements

**版本**: v2.0.0
**创建日期**: 2026-04-30
**修订日期**: 2026-05-01
**状态**: 待审批

---

## 前置条件

1. `novel-creation-workbench-complete-flow` Phase 0-7 已完成（53/53 ✅）
2. `workspace-gap-closure-v1` 已完成（25/25 ✅）
3. 写作模式真实生成、Truth/Story 中文化、删除功能已交付

---

## 创作流程设计

作者在 NovelFork 中的完整创作流程：

```
打开 NovelFork
  → Dashboard（所有作品 + 日更总览）
    → 进入某本书的 Workspace
      → 右侧默认显示「驾驶舱」总览 Tab
        ├─ 看到：今天写了多少、当前焦点、最近章节摘要、待处理风险
        ├─ 点击风险/伏笔 → 跳转到对应文件或章节
        ├─ 点击「开始写作」→ 编辑器获得焦点
      → 需要管理设定时 → 切换到「经纬」Tab
      → 需要 AI 辅助时 → 切换到「写作」Tab
        ├─ AI 动作按钮（生成下一章/审校/去AI味…）
        ├─ 写作模式（续写/扩写/对话…）
        └─ 写作工具（节奏/钩子/健康…）
      → 准备发布时 → 顶栏「发布就绪」
```

---

## Requirement 1：驾驶舱必须是右侧面板的默认视图

**User Story:** 作为作者，我进入工作台后第一眼看到的应该是当前创作状态和下一步该做什么，而不是空白的经纬面板。

**当前事实**: 右侧面板默认显示 BiblePanel（经纬/资料库），但新书打开时经纬是空的——第一眼看到的是空白列表。

### Acceptance Criteria

1. 右侧面板的三个顶级 Tab 重排为：**驾驶舱** / 经纬 / 写作。
2. 驾驶舱 Tab 必须是默认选中。
3. 窄屏（<1280px）时驾驶舱收起为抽屉或隐藏，不压缩中间编辑器。
4. 驾驶舱面板加载失败时显示 InlineError，不崩溃整个 WorkspacePage。

---

## Requirement 2：总览 Tab 必须回答「下一章该怎么写」

**User Story:** 作为作者，我需要在总览 Tab 一个页面内获得当前创作决策所需的所有信息。

### Acceptance Criteria

1. **日更进度条**（来自 writing tools progress API）：今日字数 / 日更目标、连续达标天数、本周累计。
2. **当前焦点**（来自 `current_focus.md`）：无内容时显示"尚未设置当前焦点，可在真相文件中编辑"。
3. **最近章节摘要**（来自 bible chapter_summaries，最多 3 条）：展示最近完成的章节标题 + 一句话摘要。
4. **待处理风险卡片**：
   - 快过期/已过期伏笔（距来源章节 >10 章亮黄，>15 章亮红）
   - 审计失败章节（status 包含 "audit-failed" 或 auditIssues 非空）
   - 无风险时显示"暂无风险 ✓"
5. 每条风险卡片可点击跳转到对应资源节点。
6. 每条数据标注来源（文件名或 API 路径）。

---

## Requirement 3：伏笔 Tab 必须聚合所有伏笔来源

**User Story:** 作为作者，我需要在一个列表中看到所有伏笔的状态，判断哪些需要回收。

### Acceptance Criteria

1. 聚合两个来源：经纬 events（eventType=foreshadow）和 `pending_hooks.md` 解析结果。
2. 每条伏笔展示：hook id、文本摘要、来源章节、状态、来源文件（使用中文 label）。
3. 伏笔状态：open（已埋）、payoff-due（待回收，距来源 >10 章）、expired-risk（过期风险，>15 章）、resolved（已回收）。
4. 支持按状态过滤。
5. 点击伏笔跳转到来源资源节点。
6. 过期风险计算使用可配置的阈值，默认 15 章。

---

## Requirement 4：设定 Tab 必须展示世界规则和资源

**User Story:** 作为作者，我需要快速看到世界规则、战力体系和资源账本，避免写崩设定。

### Acceptance Criteria

1. 展示经纬 settings 条目（按 category 分组）。
2. 展示 `book_rules.md` 内容摘要（前 500 字）。
3. 展示 `particle_ledger.md` 摘要（前 500 字）。
4. 所有 Truth 文件标题使用中文本地化 label。
5. 点击条目跳转到经纬编辑器或 Truth 文件 viewer。
6. 无数据时显示空状态。

---

## Requirement 5：AI 运行 Tab 必须展示透明的 AI 状态和最近活动

**User Story:** 作为作者，我需要知道 AI 当前是否可用、最近做了什么、结果去了哪里。

### Acceptance Criteria

1. 展示 provider / model 状态（来自 model gate，可用/不可用/原因）。
2. 展示最近生成/审校/检测的摘要（来自候选稿 metadata + AI 动作记录）。
3. 候选稿和草稿展示 AI metadata（provider、model、来源 action）。
4. 模型不可用时显示原因和快速配置入口（跳转设置页）。
5. route 不存在或未接入时显示 unsupported。

---

## Requirement 6：驾驶舱只做只读聚合，不增写入

**User Story:** 作为开发者，驾驶舱 v2 只做只读聚合，不引入新的写入路径。

### Acceptance Criteria

1. 不新增任何修改章节、候选稿、草稿、经纬或 Truth 文件的 API。
2. 数据通过前端并行调用已有 API 获取。
3. 跳转操作复用现有 `setSelectedNodeId` 机制。
4. 不新增独立导航体系或路由。

---

## Requirement 7：必须有测试覆盖

**User Story:** 作为开发者，驾驶舱每个 Tab 都有 UI 测试。

### Acceptance Criteria

1. 每个 Tab 至少有 UI 测试覆盖：有数据、无数据、加载失败三种状态。
2. 跳转交互有测试覆盖。
3. 伏笔过期风险计算有单元测试。
4. typecheck 全量通过。
5. `bun run test` 全量通过。

---

## Non-goals

- 不做章节作战卡生成（Phase 2 目标）
- 不做主线偏航分析（Phase 3 目标）
- 不做人物反差 Tab（Phase 2 目标）
- 不做章节影响 Tab（Phase 3 目标）
- 不做驾驶舱内的直接编辑（所有编辑回到已有 editor）
- 不做 Cockpit Snapshot API（v2 用前端聚合）
- 不做多用户、云同步
- **不做 ChatWindow 嵌入**（独立评估，不在本 spec）
