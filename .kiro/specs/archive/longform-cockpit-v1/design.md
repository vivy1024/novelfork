# 长篇驾驶舱 v2 — Design

**版本**: v2.0.0
**创建日期**: 2026-04-30
**修订日期**: 2026-05-01
**状态**: 待审批

---

## 设计定位

长篇驾驶舱 v2 是 WorkspacePage 右侧面板的**默认视图**。它不替代 BiblePanel、WritingModesPanel 或 WritingToolsPanel，而是在它们之上提供「当前创作决策」的一站式视图。

核心约束：**只读、只聚合、只跳转**。所有写入操作回到已有 editor/API。

---

## 1. UI 架构

### 1.1 右侧面板重新布局

右侧面板区域现有 2 个顶级 Tab（经纬、写作）。v2 改为 3 个，驾驶舱为默认：

```text
右侧面板（Tabs）
├─ [驾驶舱] ← 默认选中
│   ├─ 总览
│   ├─ 伏笔
│   ├─ 设定
│   └─ AI
├─ [经纬]
│   └─ 现有 BiblePanel
└─ [写作]
    └─ 现有 WritingModesPanel + WritingToolsPanel
```

### 1.2 响应式

- `xl` (>=1280px)：右侧面板常驻，宽度 20rem。
- `<1280px`：右侧面板收起为抽屉按钮。
- 不改变现有 `xl:grid-cols-[16rem_minmax(0,1fr)_20rem]` 布局。

### 1.3 组件结构

```text
CockpitPanel (新，顶层 Tab 切换)
├─ CockpitOverviewTab
│   ├─ DailyProgressBar（复用 writing tools progress API）
│   ├─ CurrentFocusCard（current_focus.md）
│   ├─ RecentSummariesCard（bible chapter-summaries）
│   └─ RiskCardsSection（伏笔过期 + 审计失败章节）
├─ CockpitHooksTab
│   ├─ HookStatusFilter
│   └─ HookEntryList（聚合经纬 events + pending_hooks.md）
├─ CockpitSettingsTab
│   ├─ SettingsCategoryList（经纬 settings by category）
│   ├─ BookRulesCard（book_rules.md 摘要）
│   └─ ParticleLedgerCard（particle_ledger.md 摘要）
└─ CockpitAiTab
    ├─ ModelGateStatus（provider/model 可用性）
    ├─ RecentCandidateCards（候选稿 metadata）
    └─ UnsupportedNotice（未接入时）
```

所有组件放在 `packages/studio/src/app-next/workspace/cockpit/` 目录下。

---

## 2. 数据流

### 2.1 数据获取策略

v2 不新增后端聚合接口。前端通过已有 `useApi` hook 并行获取：

```typescript
// CockpitPanel 内部
const progress = useApi(`/progress`);                              // 日更进度
const focusFile = useApi(`/books/${bookId}/truth-files/current_focus.md`);
const summaries = useApi(`/books/${bookId}/bible/chapter-summaries`);
const events = useApi(`/books/${bookId}/bible/events`);
const settings = useApi(`/books/${bookId}/bible/settings`);
const hooksFile = useApi(`/books/${bookId}/story-files/pending_hooks.md`);
const rulesFile = useApi(`/books/${bookId}/truth-files/book_rules.md`);
const ledgerFile = useApi(`/books/${bookId}/truth-files/particle_ledger.md`);
const providerStatus = useApi(`/providers/status`);
const chapters = useApi(`/books/${bookId}`);                       // 获取章节索引中的 auditIssues
const candidates = useApi(`/books/${bookId}/candidates`);           // AI metadata
```

Truth/Story 文件标题使用 `storage.ts` 中的 `TRUTH_FILE_LABELS` 映射。

### 2.2 伏笔聚合逻辑

```
经纬 events（eventType=foreshadow）
  ∪ pending_hooks.md 解析结果（parsePendingHookEntries）
  → 统一 HookEntryList
  → computeHookRisk（基于当前章节号和阈值）
  → 按状态过滤/排序
```

### 2.3 伏笔过期风险计算

```typescript
function computeHookRisk(hook: CockpitHookEntry, currentChapter: number, threshold = 15): HookRiskLevel {
  if (hook.status === "resolved") return "resolved";
  const gap = currentChapter - (hook.sourceChapter ?? 0);
  if (gap > threshold) return "expired-risk";
  if (gap > threshold * 0.7) return "payoff-due";
  return "open";
}
```

当前章节号来自 books API 返回的 `chapters` 数组长度或 `nextChapter` 字段。

### 2.4 SourceRef 模型

```typescript
interface CockpitSourceRef {
  kind: "truth-file" | "bible-entry" | "bible-event" | "bible-setting" | "chapter" | "provider";
  id: string;
  file?: string;
  label: string;  // 使用 TRUTH_FILE_LABELS 映射后的中文名
}
```

### 2.5 跳转机制

复用 WorkspacePage 的 `setSelectedNodeId`：

```text
用户点击驾驶舱中的来源链接
  → CockpitPanel 调用 onNavigate(resourceNodeId)
  → WorkspacePage 调用 setSelectedNodeId(resourceNodeId)
  → 资源树高亮 + 中间区打开对应 editor/viewer
```

---

## 3. 已有能力复用

### 3.1 已完工的基础设施（workspace-gap-closure-v1 交付）

| 能力 | 驾驶舱用途 |
|------|-----------|
| Truth/Story 文件中文 label | CockpitSourceRef.label 使用中文名 |
| AI 动作返回真实数据 | AI Tab 展示实际 audit/detect 结果 |
| 写作模式真实生成 | 总览 Tab 风险卡片引用真实章节状态 |

### 3.2 Core 包可直接复用的函数

| 函数 | 驾驶舱 Tab |
|------|-----------|
| `parsePendingHookEntries` | 伏笔 Tab |
| `buildPovDashboard` | 总览 Tab（后续） |
| `detectToneDrift` | 总览 Tab 风险卡片（后续） |

### 3.3 已有 UI 组件

| 组件 | 驾驶舱用途 |
|------|-----------|
| `InlineError` | 加载失败 |
| `UnsupportedCapability` | 未接入能力 |
| `Badge` | 状态标签 |
| `Button` | 操作按钮 |
| `Card` / `CardHeader` / `CardContent` | 卡片容器 |

---

## 4. 文件结构

```text
packages/studio/src/app-next/workspace/cockpit/
├─ CockpitPanel.tsx          # 驾驶舱主面板（Tab 切换）
├─ CockpitPanel.test.tsx     # 主面板 UI 测试
├─ CockpitOverviewTab.tsx    # 总览 Tab
├─ CockpitHooksTab.tsx       # 伏笔 Tab
├─ CockpitSettingsTab.tsx    # 设定 Tab
├─ CockpitAiTab.tsx          # AI 运行 Tab
├─ cockpit-types.ts          # 类型定义
├─ cockpit-risk.ts           # 风险计算
└─ cockpit-risk.test.ts      # 风险计算单元测试
```

---

## 5. 约束与边界

1. 不新增写入 API。
2. 不新增后端聚合接口。
3. 不替换现有 BiblePanel / WritingModesPanel / WritingToolsPanel。
4. AI 输出不得绕过候选稿/草稿机制。
5. 未接入能力使用 UnsupportedCapability，不假成功。
6. 数据来源必须标注 source。
7. unknown 不显示为 passed 或 available。
8. 驾驶舱面板崩溃不得影响主编辑区。
