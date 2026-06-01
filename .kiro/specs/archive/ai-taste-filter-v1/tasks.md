# Implementation Plan

## Overview

AI 味过滤器 v1（强制核心）。7 个主任务，约 5-7 个工作日。**前置**：`storage-migration`。可与 `novel-bible-v1` 并行。

## Tasks

- [x] 1. Schema 与基础设施
  - 在 `packages/core/src/storage/schema.ts` 追加 `filter_report` 表
  - migration `0005_filter_v1.sql`（编号在 bible Phase A/B/C 之后；若实际开发先于 bible Phase B 落库则调整为 0003）
  - 新建 `packages/core/src/filter/types.ts`：`FilterReport` / `RuleHit` / `ZhuqueResult`
  - `repositories/filter-report-repo.ts`：insert / listByBook / listByChapter / latestByChapter

- [x] 2. Tokenizer 与 AC 基础
  - 中文分句 / 分段（`tokenizer.ts`）：按 `。！？…` 与换行切分
  - `ac-matcher.ts`：Aho-Corasick（支持 utf-16 中文）
  - 构建词典加载器（懒加载 + 模块级缓存）
  - 单测：分句边界 / 空文本 / 超长文本
  - 单测：AC 命中 / 重叠 / Unicode

- [x] 3. 12 规则实现
  - 每条规则一个文件 `rules/r01~r12.ts`，实现统一接口 `{ id, run(text, ctx): RuleHit | null }`
  - 词典文件：`dictionaries/ai-vocabulary.json` / `empty-words.json` / `dialogue-colloquial.json`
  - 方差类规则（r06/r07）：短文本自动跳过
  - r12（伪人感综合）：基于 r01-r11 加权
  - 单测：**每条规则至少 3 正例 3 反例**

- [x] 4. 评分融合与引擎入口
  - `engine/index.ts`：`runFilter(text, options) → FilterReport`
  - 规则并行执行（`Promise.all`）
  - 权重融合：可通过 `kv_store.filter:book:<bookId>:weights` 覆盖
  - level 映射：clean <30 / mild 30-50 / moderate 50-70 / severe >70
  - 性能断言：5000 字 <200ms
  - 金本位 fixture：
    - 人类段落：如《凡人修仙传》片段 → 评分 <30
    - LLM 段落：典型 GPT 输出 → 评分 >50

- [x] 5. 朱雀 API 客户端
  - `zhuque/client.ts`：fetch + AbortSignal.timeout + 重试
  - 配置存 `kv_store.settings:zhuque:{apiKey, endpoint, timeoutMs}`
  - 失败 → FilterReport.zhuque = { status: "failed", error }
  - Settings UI 编辑 + 测试连接按钮
  - 单测：mock fetch 超时 / 5xx / 正常响应
  - 可选 SHA256 缓存层

- [x] 6. 写作管线集成 + REST API + UI
  - 管线钩子 `integration/pipeline-hook.ts`：AI 生成章节后自动扫描并写 filter_report
  - **跨 spec 接口**：
    - 扫描完成后将 `filter_report.id` 回写 `bible_chapter_summary.metadataJson.filterReportId`
    - 检查 `ctx.metadata.pgi_answers` → 写入 `filter_report.details.pgiUsed`
    - 未走 PGI 的章节在报告中标注 `pgiUsed: false`
  - REST API：`/api/filter/scan` / `/api/books/:bookId/filter/report` / `/api/books/:bookId/filter/report/:chapter` / `/api/filter/suggest-rewrite` / `/api/books/:bookId/filter/batch-rescan`
  - 全书报告支持 `?groupByPgi=true` 参数：返回 PGI/non-PGI 分组对比
  - 7 招预设 `suggestions/seven-tactics.ts` + API 返回
  - UI：
    - `AiTasteBadge.tsx`：章节列表徽章
    - `FilterReportTab.tsx`：全书报告（折线 + 柱状图 + PGI 分组对比卡）
    - `ChapterDetailPanel.tsx`：规则命中 + 高亮原文
    - `SevenTacticsDrawer.tsx`：建议抽屉
    - Settings 面板：朱雀 API 配置

- [x] 7. 测试、性能、文档
  - 运行 `pnpm test` / `typecheck`
  - 性能断言：5000 字 <200ms / 批量 100 章 <20s（worker）
  - E2E：写一章 → 保存 → 看 Badge → 点详情 → 触发 7 招建议
  - 新建 `docs/04-开发指南/AI味过滤器开发指引.md`：规则扩展 / 词典编辑 / 朱雀对接
  - 更新 07 调研文档路线图
  - 记忆 MCP remember：12 规则表 / 权重默认值 / 朱雀 API 约束

## Done Definition

- 12 条规则全部实现且每条有正反例单测
- 金本位 fixture：人类段落 <30 且 LLM 段落 >50
- 朱雀降级路径测试通过
- 写作管线集成生效，保存章节后自动生成 filter_report
- UI：章节列表徽章 / 全书报告 / 单章详情 / 7 招建议 均可用
- typecheck 通过
- 性能达标：5000 字 <200ms
- 文档更新
- 跨 spec：filterReportId 正确回写 bible_chapter_summary + pgiUsed 正确标注
- 至少一次真实烟测：用 AI 生成一章 → 评分 severe → 应用第 4 招（人工改写）→ 二次扫描评分降至 mild
