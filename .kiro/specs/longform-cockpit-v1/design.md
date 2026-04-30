# 长篇驾驶舱 v1 — Design

**版本**: v1.0.0
**创建日期**: 2026-04-30
**状态**: 待审批

---

## 设计定位

长篇驾驶舱 v1 是 WorkspacePage 右侧的只读聚合面板。它不替代 BiblePanel、WritingModesPanel 或 WritingToolsPanel，而是在它们之上提供"当前创作决策"视图。

v1 的核心约束：**只读、只聚合、只跳转**。所有写入操作回到已有 editor/API。

---

## 1. UI 架构

### 1.1 面板位置

驾驶舱面板位于 WorkspacePage 右侧，与现有三个面板（BiblePanel、WritingModesPanel、WritingToolsPanel）共享右侧区域。

方案：在右侧区域顶部增加一级 Tab 切换：

```text
右侧面板
├─ [经纬] — 现有 BiblePanel
├─ [写作] — 现有 WritingModesPanel + WritingToolsPanel
└─ [驾驶舱] — 新增 CockpitPanel
```

CockpitPanel 内部再有二级 Tab：

```text
CockpitPanel
├─ 总览
├─ 伏笔
├─ 设定
└─ AI
```

### 1.2 响应式

- `xl` (>=1280px)：右侧面板常驻，宽度 20rem（当前值）。
- `<1280px`：右侧面板收起为抽屉按钮。
- 驾驶舱不改变现有 grid 布局 `xl:grid-cols-[16rem_minmax(0,1fr)_20rem]`。

### 1.3 组件结构

```text
CockpitPanel (新组件)
├─ CockpitOverviewTab
│   ├─ CurrentFocusCard
│   ├─ RecentSummariesCard
│   └─ RiskCardsSection
├─ CockpitHooksTab
│   ├─ HookStatusFilter
│   └─ HookEntryList
├─ CockpitSettingsTab
│   ├─ SettingsCategoryList
│   ├─ BookRulesCard
│   └─ ParticleLedgerCard
└─ CockpitAiTab
    ├─ ModelGateStatus
    ├─ LastActionCard
    └─ AiMetadataCard
```

所有组件放在 `packages/studio/src/app-next/workspace/cockpit/` 目录下。

---

## 2. 数据流

### 2.1 数据获取策略

v1 不新增后端聚合接口。前端通过已有 `useApi` hook 并行获取：

```typescript
// CockpitPanel 内部
const focus = useApi<TruthFileDetail>(`/books/${bookId}/truth-files/current_focus.md`);
const summaries = useApi<{ summaries: BibleChapterSummary[] }>(`/books/${bookId}/bible/chapter-summaries`);
const events = useApi<{ events: BibleEvent[] }>(`/books/${bookId}/bible/events`);
const settings = useApi<{ settings: BibleSetting[] }>(`/books/${bookId}/bible/settings`);
const hooks = useApi<TruthFileDetail>(`/books/${bookId}/story-files/pending_hooks.md`);
const rules = useApi<TruthFileDetail>(`/books/${bookId}/truth-files/book_rules.md`);
const ledger = useApi<TruthFileDetail>(`/books/${bookId}/truth-files/particle_ledger.md`);
const providerStatus = useApi<ProviderRuntimeStatus>(`/providers/status`);
```

### 2.2 伏笔聚合逻辑

复用 `resource-view-registry.tsx` 中已有的 `parsePendingHookEntries()` 函数，加上经纬 events 中 `eventType === "foreshadow"` 的条目，合并为统一列表。

伏笔过期风险计算：

```typescript
function computeHookRisk(hook: CockpitHookEntry, currentChapter: number, threshold: number): HookRiskLevel {
  if (hook.status === "resolved") return "resolved";
  if (hook.status === "frozen") return "frozen";
  const gap = currentChapter - (hook.sourceChapter ?? 0);
  if (gap >= threshold) return "expired-risk";
  if (gap >= threshold * 0.7) return "payoff-due";
  return "open";
}
```

这个函数需要独立测试。

### 2.3 SourceRef 模型

每条驾驶舱数据项携带来源引用：

```typescript
interface CockpitSourceRef {
  kind: "truth-file" | "bible-entry" | "bible-event" | "bible-setting" | "chapter" | "provider";
  id: string;
  file?: string;
  label: string;
}
```

UI 中 source 渲染为可点击链接，点击后调用 `onSelectNode(nodeId)` 跳转到资源树对应节点。

### 2.4 跳转机制

驾驶舱中的跳转复用 WorkspacePage 已有的 `setSelectedNodeId` 机制：

```text
用户点击驾驶舱中的来源链接
  -> CockpitPanel 调用 onNavigate(resourceNodeId)
  -> WorkspacePage 调用 setSelectedNodeId(resourceNodeId)
  -> 资源树高亮 + 中间区打开对应 editor/viewer
```

不新增独立路由或导航体系。

---

## 3. 已有能力复用

### 3.1 Core 包可直接复用的函数

| 函数 | 用途 | 驾驶舱 Tab |
|------|------|-----------|
| `buildConflictMap` | 冲突地图 | 设定 Tab（后续） |
| `detectMainConflictDrift` | 主冲突漂移 | 总览 Tab 风险卡片 |
| `detectStagnantArc` | 角色弧线停滞 | 总览 Tab 风险卡片（后续） |
| `detectToneDrift` | 文风漂移 | 总览 Tab 风险卡片（后续） |
| `buildPovDashboard` | POV 追踪 | 总览 Tab（后续） |
| `parsePendingHookEntries` | 解析 pending_hooks.md | 伏笔 Tab |

### 3.2 已有 UI 组件可复用

| 组件 | 来源 | 驾驶舱用途 |
|------|------|-----------|
| `InlineError` | `app-next/components/feedback` | 加载失败显示 |
| `UnsupportedCapability` | `components/runtime/UnsupportedCapability` | 未接入能力 |
| `Badge` | `components/ui/badge` | 状态标签 |
| `Button` | `components/ui/button` | 操作按钮 |
| `Card` / `CardHeader` / `CardContent` | `components/ui/card` | 卡片容器 |

### 3.3 已有 API 端点

| 端点 | 数据 | 驾驶舱 Tab |
|------|------|-----------|
| `GET /books/:id/bible/events` | 伏笔事件 | 伏笔 Tab |
| `GET /books/:id/bible/settings` | 世界设定 | 设定 Tab |
| `GET /books/:id/bible/chapter-summaries` | 章节摘要 | 总览 Tab |
| `GET /books/:id/truth-files/current_focus.md` | 当前焦点 | 总览 Tab |
| `GET /books/:id/truth-files/book_rules.md` | 书规 | 设定 Tab |
| `GET /books/:id/truth-files/particle_ledger.md` | 资源账本 | 设定 Tab |
| `GET /books/:id/story-files/pending_hooks.md` | 待处理伏笔 | 伏笔 Tab |
| `GET /providers/status` | Provider 状态 | AI Tab |
| `GET /books/:id/candidates` | 候选稿 | AI Tab metadata |
| `GET /books/:id/drafts` | 草稿 | AI Tab metadata |

---

## 4. 状态信号模型

驾驶舱中每条数据项使用统一的信号类型：

```typescript
type CockpitSignal<T> =
  | { status: "available"; value: T; sources: CockpitSourceRef[] }
  | { status: "empty"; reason: string }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "unsupported"; reason: string };
```

UI 根据 status 渲染不同状态，不会把 empty 误解为 available。

---

## 5. 文件结构

```text
packages/studio/src/app-next/workspace/cockpit/
├─ CockpitPanel.tsx          # 驾驶舱主面板（Tab 切换）
├─ CockpitPanel.test.tsx     # 主面板 UI 测试
├─ CockpitOverviewTab.tsx    # 总览 Tab
├─ CockpitHooksTab.tsx       # 伏笔 Tab
├─ CockpitSettingsTab.tsx    # 设定 Tab
├─ CockpitAiTab.tsx          # AI 运行 Tab
├─ cockpit-types.ts          # 驾驶舱类型定义
├─ cockpit-hooks.ts          # 数据聚合 hooks
├─ cockpit-risk.ts           # 风险计算函数
└─ cockpit-risk.test.ts      # 风险计算单元测试
```

---

## 6. 约束与边界

### 6.1 不做的事

- 不新增写入 API。
- 不新增后端聚合接口（v1 前端聚合）。
- 不替换现有 BiblePanel / WritingModesPanel / WritingToolsPanel。
- 不做章节作战卡。
- 不做主线偏航分析。
- 不做人物反差 Tab。
- 不做章节影响 Tab。

### 6.2 必须遵守的规则

- AI 输出不得绕过候选稿/草稿机制。
- 未接入能力使用 UnsupportedCapability，不假成功。
- 数据来源必须标注 source。
- unknown 不显示为 passed 或 available。
- 驾驶舱面板崩溃不得影响主编辑区。

### 6.3 后续扩展方向（不在 v1 范围）

- Phase 2：Cockpit Snapshot API + 人物反差 Tab + 章节作战卡。
- Phase 3：主线偏航分析 + 章节影响 Tab + 长篇风险分析。
- Phase 4：驾驶舱内操作（标记伏笔回收、设定规则优先级）。
