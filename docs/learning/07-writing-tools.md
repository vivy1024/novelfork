---
title: 写作工具
summary: AI 味检测、章节健康度、文风漂移、角色弧线、合规导出等分析与生成工具集
tags: [写作工具, AI味, 健康度, 文风, 合规, 导出, 模板]
routes:
  - /next/workbench/:bookId
---

# 写作工具

> AI 味检测、章节健康度、文风漂移、角色弧线、合规导出等分析与生成工具集。

## 核心概念

写作工具面板集成在工作台画布区，提供数据驱动的作品质量分析。工具分两类：

- **章节级**：AI 味检测、段落节奏、对话比例——需要指定章节
- **全书级**：健康度仪表盘、文风漂移、角色弧线、日更进度——作用于整本书

每个工具调用后端 API 返回结构化结果，前端以可视化卡片呈现。

## 推荐使用流程

1. 写完一章后，跑 **AI 味检测**（12 规则本地扫描 + 朱雀 API），修掉高分段落
2. 用 **段落节奏分析** 检查句长分布，修正节奏单调区域
3. 用 **对话比例** 确认对话占比在 40-60% 区间
4. 每 10 章跑一次 **章节健康度**（ChapterHealthCard）和 **全书健康仪表盘**（BookHealthSummary）
5. 修订阶段用 **文风漂移检测**（StyleDriftPanel）对比各章与目标文风的偏离
6. 中后期用 **角色弧线**（CharacterArcsPanel）检查角色成长是否连贯
7. 定稿后跑 **平台合规**（CompliancePanel）扫描敏感词，通过后用 **导出**（ExportPanel）输出 TXT/Word/ePub
8. 日常关注 **日更进度**（DailyProgressCard + BeatProgressBar）追踪写作节奏

## 最佳实践

- AI 味检测在初稿完成后立即跑，越早修正越省力
- 节奏分析配合修改：连续 5+ 句同长度是明确信号
- 文风检测前先在经纬中声明目标文风，否则无基准可比
- 合规检查在每次导出前必跑，平台规则随时变
- Checkpoint/Rewind 在大改前打快照，改坏了一键回滚

## 常见坑

- **AI 味检测结果为空** → 章节内容不足 500 字，本地规则需要最低文本量
- **健康度评分偏低** → 经纬设定不完整，补充角色/伏笔设定后重跑
- **文风检测不准** → 未在经纬中设置目标文风描述，检测无基准
- **导出格式异常** → 章节标题格式不统一，导出前先跑合规检查
- **模板应用后内容丢失** → 模板只覆盖结构不覆盖正文，但建议先打 Checkpoint

## Agent 查阅提示

- AI 味检测组件：`AiTasteReport`，12 条本地规则 + 朱雀 API 双通道
- 健康度组件：`ChapterHealthCard`（章节级）+ `BookHealthSummary`（全书级）
- 文风漂移：`StyleDriftPanel`，对比当前章与目标文风的向量距离
- 角色弧线：`CharacterArcsPanel`，从经纬角色设定 + 章节内容提取 arc beats
- 合规导出：`CompliancePanel` 扫描 → `ExportPanel` 输出
- 日更进度：`DailyProgressCard` + `BeatProgressBar`
- 模板市场：`TemplateMarketPanel`，模板应用走 resource 层写入
- Checkpoint：`CheckpointPanel`，快照存储在 SQLite，回滚恢复全部资源状态

## 可跳转功能入口

| 功能 | 路径 |
|------|------|
| 写作工作台（含全部工具面板） | `/next/workbench/:bookId` |
