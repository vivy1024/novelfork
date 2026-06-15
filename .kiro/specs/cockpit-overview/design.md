# 总览区（作品状态仪表盘） — Design

**版本**: v1.0.0
**创建日期**: 2026-06-15
**对应 Requirements**: `requirements.md` R1-R5

---

## 设计总览

DefaultCockpitView 重写为仪表盘：上部状态卡片网格 + 下部质量趋势。新增后端聚合端点提供数据。已有孤儿面板提升为仪表盘子组件。

---

## 后端

### `/books/:id/overview-stats` 端点

```ts
// novel-plugin/src/routes/ai.ts 或新建 overview.ts
GET /books/:id/overview-stats
Response: {
  volumeProgress: { current: number; total: number; volumeName: string }
  foreshadowingRate: { resolved: number; total: number }
  activePlotLines: number
  wordCount: { today: number; total: number }
  publishReadiness: "green" | "yellow" | "red"
}
```

数据聚合逻辑：
- volumeProgress：从 outline 条目中取当前卷，统计已写章 / 规划章
- foreshadowingRate：count(status=resolved) / count(category=foreshadowing)
- activePlotLines：count(category=conflicts AND status=active)
- wordCount.today：今日 chapter-summaries 的字数和；total：全书章节字数和
- publishReadiness：转发 `/books/:id/compliance/publish-readiness` 结果

---

## 前端

### DefaultCockpitView 重写

```
┌─────────────────────────────────────────────────┐
│  StatCard Grid (2x3)                            │
│  ┌──────┐ ┌──────┐ ┌──────┐                    │
│  │ 卷进度│ │伏笔率│ │情节线│                    │
│  └──────┘ └──────┘ └──────┘                    │
│  ┌──────┐ ┌──────┐ ┌──────┐                    │
│  │ 今日字│ │总字数│ │就绪度│                    │
│  └──────┘ └──────┘ └──────┘                    │
├─────────────────────────────────────────────────┤
│  BookHealthSummary (半宽) │ DailyProgressCard   │
├─────────────────────────────────────────────────┤
│  QualityPanel (全宽，已接入)                     │
└─────────────────────────────────────────────────┘
```

### StatCard 组件

```ts
interface StatCardProps {
  label: string
  value: string | number
  subtext?: string
  status?: "green" | "yellow" | "red" | "neutral"
  icon: ReactNode
}
```

### ExpandablePanel 扩展

现有 ExpandablePanel 的 PanelType 扩展：
- 加 `"health"` → 渲染 BookHealthSummary
- 加 `"progress"` → 渲染 DailyProgressCard

---

## 数据流

```
DefaultCockpitView mount
  → fetch /books/:id/overview-stats
  → StatCard Grid 渲染
  → BookHealthSummary / DailyProgressCard / QualityPanel 各自 fetch 或共享数据
```

---

## 非破坏性

- 原图谱入口移至 jingwei-settings-ui spec 处理（本 spec 不删图谱代码）
- BookHealthSummary / DailyProgressCard 原文件不动，只在新视图中 import
- QualityPanel 已接入保持不变
