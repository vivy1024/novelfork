# 总览区（作品状态仪表盘） — Tasks

**对应 Design**: `design.md`
**执行顺序**: 1 → 2 → 3 → 4 → 5

---

## Task 1：后端 `/books/:id/overview-stats` 端点
- [x] 新建路由（或在 ai.ts 中加入）
- [x] 聚合逻辑：从经纬条目统计 volumeProgress / foreshadowingRate / activePlotLines
- [x] wordCount：从 chapter-summaries 统计今日/总字数
- [x] publishReadiness：转发合规端点结果
- [ ] curl 验证返回数据正确

## Task 2：DefaultCockpitView 重写为仪表盘
- [x] StatCard 组件（label/value/subtext/status/icon）
- [x] StatCard Grid 布局（2x3 响应式网格）
- [x] fetch overview-stats 数据绑定

## Task 3：接入 BookHealthSummary + DailyProgressCard
- [ ] import 两个孤儿组件
- [ ] 仪表盘下半部两栏布局渲染
- [ ] 确认数据源正常加载

## Task 4：ExpandablePanel 扩展 PanelType
- [ ] PanelType 加 "health" | "progress"
- [ ] 对应渲染逻辑映射

## Task 5：验证
- [ ] typecheck 全量干净
- [ ] Browser 截图：仪表盘全貌 / 卡片数据 / 子面板
