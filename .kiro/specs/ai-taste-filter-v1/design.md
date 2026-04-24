# Design Document

## Overview

AI 味过滤器 v1 = 本地 12 特征规则引擎 + 可选朱雀 API 集成 + 消 AI 味 7 招建议 + 写作管线必经层 + 检测历史报告。作为 NovelFork 强制核心，默认开启不可在生产模式关闭。

## Goals

- 提供快速本地评分（<200ms / 5000 字）
- 支持朱雀 API 平台级双检
- 与写作管线集成为"必经一层"
- 提供可解释命中清单与修改建议
- 为作者展示全书 AI 味趋势报告

## Non-Goals

- 不做自训练模型
- 不做自动重写（仅建议）
- 不做非中文语言
- 不做图像 / 音频检测

## Architecture

### 分层

```
packages/core/src/filter/
  schema.ts                   ← filter_report 表
  types.ts                    ← FilterReport / RuleHit / AiTasteScore
  engine/
    index.ts                  ← runFilter(text, options)
    rules/
      r01-officialese.ts      ← 规则 1：官腔
      r02-template-structure.ts
      r03-ai-vocabulary.ts    ← 词典匹配
      r04-emotional-vague.ts
      r05-no-quirks.ts
      r06-sentence-length-variance.ts
      r07-paragraph-uniformity.ts
      r08-jargon-density.ts
      r09-adjective-stacking.ts
      r10-empty-words.ts
      r11-dialogue-written-form.ts
      r12-faux-human-composite.ts
    dictionaries/
      ai-vocabulary.json
      empty-words.json
      ...
    tokenizer.ts              ← 中文分句分词
    ac-matcher.ts
  zhuque/
    client.ts                 ← 腾讯朱雀 API
    types.ts
  suggestions/
    seven-tactics.ts          ← 消 AI 味 7 招预设
  integration/
    pipeline-hook.ts          ← 写作管线集成点
  repositories/
    filter-report-repo.ts

packages/studio/src/
  api/routes/filter/
    scan.ts                   ← POST /api/filter/scan
    report.ts                 ← GET /api/books/:bookId/filter/report
    suggest-rewrite.ts        ← POST /api/filter/suggest-rewrite
  components/filter/
    AiTasteBadge.tsx          ← 章节列表的绿/红徽章
    FilterReportTab.tsx       ← 全书报告
    ChapterDetailPanel.tsx    ← 单章命中高亮
    SevenTacticsDrawer.tsx    ← 建议抽屉
```

## Schema

```ts
export const filterReport = sqliteTable("filter_report", {
  id: text("id").primaryKey(),
  bookId: text("book_id").notNull(),
  chapterNumber: integer("chapter_number").notNull(),
  aiTasteScore: integer("ai_taste_score").notNull(),  // 0-100
  level: text("level").notNull(),                     // clean | mild | moderate | severe
  hitCountsJson: text("hit_counts_json").notNull(),   // { r01: 3, r03: 1, ... }
  zhuqueScore: integer("zhuque_score"),               // 0-100 or null
  zhuqueStatus: text("zhuque_status"),                // success | failed | not-configured
  details: text("details").notNull(),                 // full FilterReport JSON
  engineVersion: text("engine_version").notNull(),
  scannedAt: integer("scanned_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => ({
  byChapter: index("idx_filter_report_by_chapter").on(t.bookId, t.chapterNumber, t.scannedAt),
}));
```

## 核心类型

```ts
export interface FilterReport {
  aiTasteScore: number;       // 0-100
  level: "clean" | "mild" | "moderate" | "severe";
  hits: RuleHit[];
  zhuque?: ZhuqueResult;
  engineVersion: string;
  tokensAnalyzed: number;
  elapsedMs: number;
}

export interface RuleHit {
  ruleId: string;             // r01 ~ r12
  name: string;
  severity: "low" | "medium" | "high";
  spans: Array<{ start: number; end: number; matched: string }>;
  suggestion?: string;
  weightContribution: number;
}
```

## 规则引擎流程

```
runFilter(text, options)
  1. tokenize(text) → 句子 / 段落 / 词
  2. 短文本跳过方差类规则（<200 字 → 跳过 r06, r07）
  3. 并行跑 12 条规则 → RuleHit[]
  4. weightedScore = Σ(severity × ruleWeight × hitCount)
  5. normalize 到 0-100
  6. level = mapScoreToLevel(score)
  7. 若朱雀配置 → 异步调用朱雀 API → 合并到 FilterReport
  8. 返回
```

## 规则权重（默认）

| ID | 规则 | 默认权重 | 调优建议 |
|---|---|---|---|
| r01 | 官腔 | 1.0 | 高置信误报低 |
| r02 | 首先其次最后 | 1.2 | 高置信 |
| r03 | AI 词典 | 1.5 | **最强信号** |
| r04 | 情感笼统 | 0.8 | 中 |
| r05 | 无口头禅 | 0.6 | 全文才评 |
| r06 | 句长方差 | 0.7 | 仅长文本 |
| r07 | 段落均匀 | 0.6 | 仅长文本 |
| r08 | 行话密度 | 0.5 | 领域依赖 |
| r09 | 形容词堆叠 | 0.9 | 中 |
| r10 | 空话密度 | 0.8 | 中 |
| r11 | 对话书面语 | 1.1 | 高（网文尤其） |
| r12 | 伪人感综合 | — | 由 r01-r11 派生 |

权重通过 `kv_store.filter:book:<bookId>:weights` 允许按书覆盖。

## 词典与可调资源

- `ai-vocabulary.json`：约 80-150 条典型 AI 词组
- `empty-words.json`：空话短语
- `dialogue-colloquial-markers.json`：口语标记（"呗"、"啊"、"嘛"等）
- 支持用户在 Studio 中编辑本地词典副本

## 朱雀 API 集成

```ts
// zhuque/client.ts
export async function scanWithZhuque(text: string, config: ZhuqueConfig): Promise<ZhuqueResult> {
  const res = await fetch(config.endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text, mode: "text" }),
    signal: AbortSignal.timeout(config.timeoutMs ?? 10_000),
  });
  if (!res.ok) throw new ZhuqueError(`HTTP ${res.status}`);
  const data = await res.json();
  return { score: data.aiProbability * 100, raw: data };
}
```

- 配置通过 Settings UI 填入（不入仓库）
- 超时/失败 → FilterReport.zhuque = { status: "failed", error }
- 可选 `zhuque-cache` 层（同一文本 SHA256 → 结果缓存）

## 消 AI 味 7 招预设

`suggestions/seven-tactics.ts`：

```ts
export const SEVEN_TACTICS: Tactic[] = [
  { id: 1, name: "喂人类范文", type: "preset-prompt", template: "请参考以下人类作家范文，用同样风格重写：\n{referenceText}\n\n要改写的文本：\n{targetText}" },
  { id: 2, name: "明确人格提示词", type: "preset-prompt", template: "你是一位资深网文作者，文风{styleTag}。..." },
  { id: 3, name: "屏蔽鼓励人格", type: "system-prompt-patch", patch: "不需要鼓励性语言，只指出问题和修改方向。" },
  { id: 4, name: "人工改写润色", type: "ui-action", action: "open-diff-editor" },
  { id: 5, name: "朱雀→降重→朱雀 循环", type: "workflow", steps: [...] },
  { id: 6, name: "章节钩子生成器", type: "preset-prompt", template: "..." },
  { id: 7, name: "AI 使用标注", type: "metadata-action", action: "write-frontmatter" },
];
```

## 写作管线集成

```ts
// integration/pipeline-hook.ts
export async function afterChapterGenerated(ctx: WritingContext, generated: string) {
  const report = await runFilter(generated, { bookId: ctx.bookId });
  ctx.writeResult.filterReport = report;           // 附到响应
  await filterReportRepo.insert(ctx.bookId, ctx.chapterNumber, report);
  if (report.level === "severe") {
    ctx.logger.warn(`章节 ${ctx.chapterNumber} AI 味严重（${report.aiTasteScore}）`);
  }
}
```

集成点：
- AI 写作管线 `generate-chapter` 完成后
- 作者手动保存章节到 `bible_chapter_summary` 时（异步扫）

## REST API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/filter/scan` | 临时扫描任意文本（不入库） |
| GET | `/api/books/:bookId/filter/report` | 全书报告（趋势 + 排行） |
| GET | `/api/books/:bookId/filter/report/:chapter` | 单章详情 |
| POST | `/api/filter/suggest-rewrite` | 7 招建议 |
| PUT | `/api/settings/zhuque` | 配置朱雀 API |
| POST | `/api/books/:bookId/filter/batch-rescan` | 全书批量重扫（worker） |

## UI 设计

- 章节列表每行显示 `AiTasteBadge`（颜色：绿 clean / 黄 mild / 橙 moderate / 红 severe）
- 点击 Badge → 单章详情：12 规则命中列表 + 原文高亮 + 7 招建议按钮
- 书籍详情「AI 味报告」Tab：
  - 顶部：全书平均分 / 朱雀均分（若有） / 平台风险标记
  - 折线图：各章评分趋势
  - 柱状图：规则触发频次排行
- Settings：朱雀 API 配置（key / endpoint / 超时 / 测试连接按钮）

## 性能设计

- 规则并发：`Promise.all(rules.map(rule => rule.run(text, ctx)))`
- AC 自动机在 engine 初始化时构建，缓存到模块级
- 中文分句：基于标点（`。！？…`）O(n)
- 批量重扫用 worker_threads（NodeJS / Bun）

## 错误处理

- 规则执行异常：捕获并记为 `ruleError`，不影响其他规则
- 朱雀失败：降级 + UI 明确提示
- 评分为 NaN / 超范围：默认 50，日志 warn

## 测试策略

| 层 | 手段 |
|---|---|
| 规则单测 | 每条 r01-r12 各 3+ 正例 3+ 反例 |
| 评分融合 | 金本位 fixture：人类段落 + LLM 段落 |
| 朱雀降级 | mock fetch 超时 / 5xx / 正常 |
| 集成 | 写作管线触发后 filterReport 入库 |
| 性能 | 5000 字文本 <200ms 断言 |

## 扩展后续

- v1.5：规则版本化 + 作者反馈回路（误报标记）
- v2：自动重写执行（留 `auto-dehumanize` spec）
- v3：本地轻量 ML 分类器（当规则达到瓶颈时）
