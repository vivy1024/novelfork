# 总览区（作品状态仪表盘） — Requirements

**版本**: v1.0.0
**创建日期**: 2026-06-15
**状态**: draft
**依赖**: `jingwei-data-layer-unify`（追踪族数据已落地 SQLite）

---

## 问题陈述

驾驶舱当前默认落地视图是经纬图谱满屏，不能一眼看到作品整体状态。作者需要频繁切换面板才能了解进度、伏笔回收、质量趋势。已有的 BookHealthSummary 和 DailyProgressCard 是孤儿面板，未接入主视图。

---

## 需求

### R1 默认落地视图
- 驾驶舱默认视图**应**改为"作品状态总览"仪表盘（替代经纬图谱满屏）。

### R2 总览指标
- 总览**应**显示以下状态卡片：
  - 卷推进进度（当前卷已写章数 / 卷规划总章数）
  - 伏笔回收率（已回收数 / 总埋设数）
  - 活跃情节线数（conflicts 中 status=active 的计数）
  - 当日字数 / 累计总字数
  - 平台发布就绪度（绿/黄/红指示灯）

### R3 接入孤儿面板
- 总览**应**集成已有组件：BookHealthSummary（全书健康度）+ DailyProgressCard（每日进度）+ QualityPanel（质量趋势图）。

### R4 数据源
- 总览数据**应**来自经纬追踪族（foreshadowing/outline/conflicts/chapter-summaries）的聚合投影，不另建冗余数据存储。

### R5 平台就绪度
- 平台就绪度**应**从 `/books/:id/compliance/publish-readiness` 端点读取，展示为绿/黄/红指示灯 + 简要说明。

---

## 非目标

- 自定义仪表盘布局（后续）
- 多书横向对比
- 推送通知

---

## 验收标准

- AC1：打开驾驶舱默认显示总览仪表盘，不再是图谱。
- AC2：5 个状态卡片数据正确显示（无假数据/mock）。
- AC3：BookHealthSummary + DailyProgressCard + QualityPanel 正确集成渲染。
- AC4：平台就绪度指示灯从后端 API 读取并正确变色。
- AC5：typecheck 干净 + Browser 截图验证。
