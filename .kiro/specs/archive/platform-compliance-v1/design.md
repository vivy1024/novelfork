# Design Document

## Overview

本设计为 NovelFork 添加平台合规工具集：多平台敏感词扫描、AI 内容比例估算、发布就绪检查和 AI 使用标注生成。帮助作者在投稿前确认内容合规性。

## Goals

- 支持按平台（起点/晋江/番茄/七猫/通用）扫描敏感词。
- 基于已有 AI 味检测估算全书 AI 辅助比例。
- 提供一键发布就绪检查汇总报告。
- 自动生成可编辑的 AI 使用标注声明。

## Non-Goals

- 不对接平台 API 自动投稿。
- 不保证敏感词库 100% 覆盖（平台词库频繁更新）。
- 不精确计算 AI 比例（只能基于特征估算）。
- 不替代作者对内容合规性的最终判断。

## Architecture

### 文件组织

```text
packages/core/src/compliance/
  types.ts                           ← 合规类型定义
  sensitive-scanner.ts               ← 敏感词扫描引擎
  ai-ratio-estimator.ts              ← AI 比例估算
  format-checker.ts                  ← 格式规范检查
  publish-readiness.ts               ← 发布就绪汇总
  ai-disclosure-generator.ts         ← AI 使用标注生成
  dictionaries/
    common.json                      ← 通用敏感词库
    qidian-extra.json                ← 起点专属词
    jjwxc-extra.json                 ← 晋江专属词
    fanqie-extra.json                ← 番茄专属词
    qimao-extra.json                 ← 七猫专属词

packages/studio/src/pages/
  PublishReadiness.tsx               ← 发布就绪检查页面
packages/studio/src/components/compliance/
  SensitiveWordReport.tsx
  AiRatioReport.tsx
  FormatCheckReport.tsx
  AiDisclosureEditor.tsx
packages/studio/src/api/routes/
  compliance.ts                      ← 合规 API 路由
```

## Data Model

### 敏感词

```ts
export type SeverityLevel = "block" | "warn" | "suggest";
export type SensitiveCategory =
  | "political" | "sexual" | "violence" | "religious"
  | "racial" | "crime-glorify" | "minor-protection" | "medical-mislead";

export interface SensitiveWord {
  word: string;
  category: SensitiveCategory;
  severity: SeverityLevel;
  platforms: string[];               // 哪些平台适用，空=通用
  suggestion?: string;               // 替代建议
}

export interface SensitiveHit {
  word: string;
  category: SensitiveCategory;
  severity: SeverityLevel;
  chapterNumber: number;
  chapterTitle: string;
  paragraph: number;
  context: string;                   // 前后 30 字上下文
  suggestion?: string;
}

export interface SensitiveScanResult {
  platform: string;
  totalHits: number;
  blockCount: number;
  warnCount: number;
  suggestCount: number;
  hits: SensitiveHit[];
  scannedChapters: number;
  scannedWords: number;
}
```

### AI 比例

```ts
export interface ChapterAiEstimate {
  chapterNumber: number;
  chapterTitle: string;
  wordCount: number;
  aiScore: number;                   // 0-1，基于 AI 味检测
  estimatedAiRatio: number;          // 0-1，估算 AI 辅助比例
  isAboveThreshold: boolean;
}

export interface BookAiRatioReport {
  bookId: string;
  totalWords: number;
  overallAiRatio: number;
  chapters: ChapterAiEstimate[];
  platformThresholds: Record<string, number>;
  methodology: string;
}
```

### 格式检查

```ts
export type FormatIssueType =
  | "title-format" | "chapter-too-short" | "chapter-too-long"
  | "empty-chapter" | "consecutive-blank-lines" | "total-word-count"
  | "missing-synopsis";

export interface FormatIssue {
  type: FormatIssueType;
  severity: SeverityLevel;
  chapterNumber?: number;
  message: string;
  detail?: string;
}

export interface FormatCheckResult {
  issues: FormatIssue[];
  totalWords: number;
  chapterCount: number;
  avgChapterWords: number;
}
```

### 发布就绪

```ts
export interface PublishReadinessReport {
  platform: string;
  status: "ready" | "has-warnings" | "not-ready";
  sensitiveResult: SensitiveScanResult;
  aiRatioResult: BookAiRatioReport;
  formatResult: FormatCheckResult;
  aiDisclosure?: string;
  summary: {
    blockCount: number;
    warnCount: number;
    suggestCount: number;
  };
}
```

### AI 使用标注

```ts
export interface AiDisclosure {
  assistTypes: string[];             // ["大纲辅助", "续写", "改写", "校对"]
  estimatedRatio: number;
  modelNames: string[];
  humanEditNote: string;
  generatedText: string;             // 生成的声明全文
}
```

## 敏感词扫描引擎设计

### 扫描策略

1. 加载通用词库 + 平台专属词库。
2. 构建 Aho-Corasick 自动机或正则集合（词量 < 5000 可用 `new RegExp(words.join('|'), 'g')`；词量 > 5000 需 AC 自动机）。
3. 逐章扫描，记录命中位置。
4. 去重（同一章同一词只报一次，但统计出现次数）。

### 词库格式

```json
[
  {
    "word": "xxx",
    "category": "political",
    "severity": "block",
    "platforms": [],
    "suggestion": "建议删除或改写"
  }
]
```

### 词库来源策略

- 内置基础词库（约 500-1000 词）覆盖明确的红线词。
- 支持导入外部词库（JSON/CSV）扩展。
- 平台专属词库单独管理，随平台政策更新。
- **不追求穷尽**——明确告知作者"仅供参考，以平台实际审核为准"。

## AI 比例估算设计

### 估算方法

复用 `ai-taste-filter-v1` 的检测结果：

```ts
function estimateAiRatio(aiScore: number): number {
  // aiScore 0-1 来自 AI 味检测
  // 简单线性映射，高 AI 味 ≈ 高 AI 辅助比例
  // 但需要明确声明这只是粗略估算
  if (aiScore < 0.2) return 0;         // 基本无 AI 痕迹
  if (aiScore < 0.4) return 0.1;       // 轻微 AI 辅助
  if (aiScore < 0.6) return 0.3;       // 中度 AI 辅助
  if (aiScore < 0.8) return 0.5;       // 较重 AI 辅助
  return 0.7;                          // 高度 AI 味
}
```

### 平台阈值

| 平台 | 阈值 | 备注 |
|---|---|---|
| 起点 | 0% | 100% 人工创作 |
| 晋江 | ~5% | 仅允许校对/角色名/粗纲 |
| 番茄 | ~20% | 非保底作者限制更严 |
| AIGC 办法 | 20% | 草案预期上限 |
| 七猫/纵横 | 需标注 | 无明确比例 |

## 格式规范检查设计

| 检查项 | 规则 | 严重等级 |
|---|---|---|
| 章节标题格式 | 有"第X章"或自定义格式 | suggest |
| 章节字数过短 | < 1000 字 | warn |
| 章节字数过长 | > 8000 字 | suggest |
| 空白章节 | 0 字 | block |
| 连续空行 | > 3 行连续空行 | suggest |
| 总字数不足 | 起点首秀 < 10万字 | warn |
| 缺少简介 | 无 synopsis | warn |

## 发布就绪检查流程

```text
选择目标平台
  ↓
敏感词扫描（通用 + 平台专属）
  ↓
AI 比例估算（全书 + 每章）
  ↓
格式规范检查
  ↓
汇总报告（block/warn/suggest 分级）
  ↓
可选：生成 AI 使用标注
  ↓
展示就绪状态
```

## API 路由

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/books/:bookId/compliance/sensitive-scan` | 敏感词扫描 |
| POST | `/api/books/:bookId/compliance/ai-ratio` | AI 比例估算 |
| POST | `/api/books/:bookId/compliance/format-check` | 格式检查 |
| POST | `/api/books/:bookId/compliance/publish-readiness` | 一键发布就绪 |
| POST | `/api/books/:bookId/compliance/ai-disclosure` | 生成 AI 标注 |
| GET | `/api/compliance/dictionaries` | 列出可用词库 |
| POST | `/api/compliance/dictionaries/import` | 导入自定义词库 |

## UI 设计

### PublishReadiness 页面

```text
发布就绪检查
  ┌─────────────────────────────────────┐
  │ 目标平台：[起点 ▼]  [开始检查]       │
  └─────────────────────────────────────┘

  检查结果摘要
  ┌──────────┬──────────┬──────────┐
  │ 🔴 阻断 2 │ 🟡 警告 5 │ 🟢 建议 3 │
  └──────────┴──────────┴──────────┘

  详细报告（三个展开卡片）
  ├─ 敏感词扫描结果
  ├─ AI 内容比例
  └─ 格式规范检查

  [生成 AI 使用标注]  [导出报告]
```

使用 shadcn/ui：Card、Badge、Accordion、Table、Button、Select、Dialog、Textarea。

## Testing Strategy

### Unit Tests
- 敏感词扫描：已知词命中、未命中、平台过滤、上下文提取、自定义词库。
- AI 比例：分段映射正确、全书汇总、空章节安全。
- 格式检查：各检查项独立覆盖。
- 标注生成：格式正确、包含必要字段。

### Integration Tests
- 一键发布就绪：3 步依次执行、汇总正确。
- 平台切换后结果变化（起点 vs 番茄的不同阈值和词库）。
