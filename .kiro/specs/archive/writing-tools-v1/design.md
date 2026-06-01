# Design Document

## Overview

本设计为 NovelFork 添加五个写作辅助工具：章节钩子生成器、POV 视角管理、日更进度追踪、段落节奏可视化和对话比例分析。这些工具共同解决"写得稳、写得好"的作者需求。

## Goals

- 帮助作者生成有吸引力的章末悬念。
- 追踪多视角小说的视角分配平衡。
- 提供日更字数目标和进度仪表盘。
- 可视化句长/段落节奏并与参考文本对比。
- 分析对话占比和角色对话分配。

## Non-Goals

- 不自动改写章节结尾（仅推荐）。
- 不强制日更目标（仅追踪和展示）。
- 不替代已有 AI 味检测（节奏分析是辅助参考）。
- 不实现完整的角色弧线追踪（后续 `progressions-tracking`）。

## Architecture

### 文件组织

```text
packages/core/src/tools/
  chapter-hooks/
    hook-generator.ts                ← 章末钩子生成（LLM）
    hook-types.ts                    ← 钩子类型定义
  pov/
    pov-tracker.ts                   ← POV 统计与建议
    pov-types.ts
  progress/
    daily-tracker.ts                 ← 日更字数追踪
    progress-types.ts
  analysis/
    rhythm-analyzer.ts               ← 段落节奏分析（扩展已有 style-analyzer）
    dialogue-analyzer.ts             ← 对话比例分析（扩展已有 extractDialogueFingerprints）

packages/studio/src/components/writing-tools/
  ChapterHookGenerator.tsx
  PovDashboard.tsx
  DailyProgressTracker.tsx
  RhythmChart.tsx
  DialogueAnalysis.tsx

packages/studio/src/api/routes/
  writing-tools.ts                   ← 工具 API 路由
```

## Data Model

### 章节钩子

```ts
export type HookStyle = "suspense" | "reversal" | "emotional" | "info-gap" | "action" | "mystery" | "cliffhanger";

export interface GeneratedHook {
  id: string;
  style: HookStyle;
  text: string;                      // 建议的章末段落
  rationale: string;                 // 为什么推荐这个钩子
  retentionEstimate: "high" | "medium" | "low";
  relatedHookIds?: string[];         // 关联的已有伏笔
}

export interface HookGeneratorInput {
  chapterContent: string;
  chapterNumber: number;
  pendingHooks: string;              // pending_hooks.md 内容
  nextChapterIntent?: string;
  bookGenre?: string;
}
```

### POV 追踪

```ts
export interface PovCharacter {
  name: string;
  totalChapters: number;
  lastAppearanceChapter: number;
  gapSinceLastAppearance: number;
  chapterNumbers: number[];
}

export interface PovDashboard {
  characters: PovCharacter[];
  currentChapter: number;
  warnings: PovWarning[];
  suggestion?: PovSuggestion;
}

export interface PovWarning {
  characterName: string;
  gapChapters: number;
  message: string;
}

export interface PovSuggestion {
  recommendedPov: string;
  reason: string;
}
```

### 日更进度

```ts
export interface WritingLog {
  date: string;                      // YYYY-MM-DD
  bookId: string;
  chapterNumber: number;
  wordCount: number;
  completedAt: string;               // ISO timestamp
}

export interface DailyProgress {
  today: { written: number; target: number; completed: boolean };
  thisWeek: { written: number; target: number };
  streak: number;                    // 连续达标天数
  last30Days: Array<{ date: string; wordCount: number }>;
  estimatedCompletionDate?: string;
}

export interface ProgressConfig {
  dailyTarget: number;               // 默认 6000
  weeklyTarget?: number;
  totalChaptersTarget?: number;
  avgWordsPerChapter?: number;
}
```

### 节奏分析

```ts
export interface RhythmAnalysis {
  sentenceLengths: number[];
  sentenceHistogram: Array<{ range: string; count: number }>;
  paragraphLengths: number[];
  avgSentenceLength: number;
  sentenceLengthStdDev: number;
  rhythmScore: number;               // 0-100，越高越有节奏感
  issues: RhythmIssue[];
  referenceComparison?: {
    refAvgSentenceLength: number;
    refStdDev: number;
    deviation: number;
  };
}

export interface RhythmIssue {
  type: "uniform-length" | "no-short-burst" | "too-long-paragraphs";
  message: string;
  affectedRanges: Array<{ start: number; end: number }>;
}
```

### 对话分析

```ts
export interface DialogueAnalysis {
  totalWords: number;
  dialogueWords: number;
  dialogueRatio: number;
  chapterType?: string;
  referenceRange: { min: number; max: number };
  isHealthy: boolean;
  characterDialogue: Array<{
    name: string;
    wordCount: number;
    lineCount: number;
    ratio: number;
  }>;
  issues: string[];
}
```

## 章节钩子生成器设计

### LLM Prompt 策略

```text
你是一位网文悬念设计专家。基于以下信息生成 3-5 个章末钩子方案：

【本章内容摘要】{最后 2000 字}
【当前伏笔】{pending_hooks.md 摘要}
【下章意图】{如果有}
【书籍流派】{如果有}

每个方案包含：
1. 钩子类型（悬念/反转/情感/信息缺口/动作/谜团/悬崖）
2. 建议章末段落（50-200字）
3. 推荐理由
4. 预估读者留存效果（高/中/低）

要求：
- 钩子必须基于本章内容自然延伸，不能凭空制造
- 至少 1 个钩子利用已有伏笔
- 悬念型不能靠隐瞒已知信息（要制造新问题）
```

### 触发位置

- 章节编辑器工具栏：「生成章末钩子」按钮
- 写完章节后的审计报告中提供入口
- 可选：自动在章节审计后建议

## POV 管理设计

### 数据来源

从 `character_matrix.md` 提取标记为 POV 的角色；从 `chapter_summaries.md` 提取每章 POV 角色。

### 警告阈值

| 条件 | 阈值 | 警告 |
|---|---|---|
| POV 角色超过 N 章未出现 | 默认 10 章 | ⚠️ {角色} 已 {N} 章未出现 |
| 某 POV 占比超过 70% | 70% | ⚠️ 视角分配不均 |
| 某 POV 只出现 1-2 章 | — | ⚠️ 考虑是否需要此 POV |

### POV 建议算法

```text
1. 计算每个 POV 角色的 gap（当前章 - 最后出现章）
2. gap 最大的角色优先推荐
3. 如果下一章意图涉及某角色的情节线，优先推荐该角色
4. 输出：推荐 POV + 理由
```

## 日更进度设计

### 存储

写作日志存储在 SQLite `writing_log` 表：

```sql
CREATE TABLE IF NOT EXISTS writing_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id TEXT NOT NULL,
  chapter_number INTEGER NOT NULL,
  word_count INTEGER NOT NULL,
  completed_at TEXT NOT NULL,
  date TEXT NOT NULL  -- YYYY-MM-DD, for quick aggregation
);
```

进度配置存储在用户设置 / `kv_store`。

### Streak 计算

从今天往前连续每天字数 ≥ dailyTarget 的天数。跨时区使用用户本地日期。

### 预计完成日期

```ts
estimatedDays = (totalChaptersTarget - currentChapters) * avgWordsPerChapter / avgDailyWords;
estimatedDate = today + estimatedDays;
```

## 段落节奏可视化设计

### 扩展已有 style-analyzer

`rhythm-analyzer.ts` 复用 `analyzeStyle()` 的句长/段落统计逻辑，增加：

- 句长直方图数据（按 5 字区间分桶）
- 段落长度序列（用于折线图）
- 节奏评分（基于句长标准差和长短句交替频率）
- 与 `style_profile.json` 的对比偏差

### 可视化

使用轻量图表（`recharts` 或 shadcn/ui 兼容的 SVG 图表）：

- 句长分布直方图（蓝色=当前章节，灰色虚线=参考文本）
- 段落长度折线图
- 点击直方图区间 → 高亮正文中对应句子

## 对话分析设计

### 扩展已有 extractDialogueFingerprints

`dialogue-analyzer.ts` 复用 Writer Agent 中的对话正则，增加：

- 对话总字数 / 总字数 = 对话比例
- 按角色分组的对话字数
- 按章节类型给出参考范围

### 参考范围

| 章节类型 | 对话比例参考 |
|---|---|
| 战斗章 | 10-25% |
| 日常/社交章 | 30-50% |
| 过渡/描写章 | 15-35% |
| 悬疑/推理章 | 25-40% |

章节类型可从流派配置的 `chapterTypes` 推断或由作者标注。

## 全书健康仪表盘设计

### 数据持久化

当前每章审计结果只在 pipeline 运行时存在。新增 `chapter_audit_log` 表：

```ts
interface ChapterAuditLog {
  bookId: string;
  chapterNumber: number;
  auditedAt: string;                // ISO 日期
  continuityPassed: boolean;
  continuityIssueCount: number;
  aiTasteScore: number;             // 0-100
  hookHealthIssues: number;
  longSpanFatigueIssues: number;
  sensitiveWordCount: number;
  chapterType: string;              // "战斗" / "日常" / "过渡" / ...
  mood: string;                     // "紧张" / "轻松" / "悲伤" / ...
  povCharacter?: string;
  conflictsAdvanced: string[];      // 本章推进的矛盾 ID
  arcBeats: Array<{ characterId: string; event: string }>;
}
```

在 `writeNextChapter()` 和 `reviseDraft()` 的审计阶段末尾，将结果写入此表。

### 聚合计算

```ts
interface BookHealthSummary {
  totalChapters: number;
  totalWords: number;
  consistencyScore: number;          // continuityPassed 比率 × 100
  hookRecoveryRate: number;          // resolved / total hooks
  pendingHooks: HookRecord[];
  aiTasteAvg: number;
  aiTasteTrend: number[];            // 最近 20 章
  pacingDiversityScore: number;      // 章节类型分布 Shannon 熵 / log(类型数)
  emotionCurve: string[];            // 全书情绪序列
  sensitiveWordTotal: number;
  stalledConflicts: StalledConflictWarning[];
  hookDebtWarnings: AuditIssue[];
  fatigueWarnings: LongSpanFatigueIssue[];
  povGapWarnings: Array<{ character: string; gap: number }>;
  mainConflictDrift?: { conflictId: string; stalledChapters: number };
}
```

聚合函数 `buildBookHealthSummary(bookId)` 从 `chapter_audit_log` 和现有引擎结果汇总。

### 仪表盘 UI

```text
┌──────────────────────────────────────────────────┐
│ 《仙路独行》  共 52 章  48.6 万字                  │
├──────────────────────────────────────────────────┤
│ 人设一致性  ████████████░░  85%    ✅ 健康        │
│ 伏笔回收率  ██████░░░░░░░  52%    ⚠️ 8条待回收   │
│ AI 味均值   ██░░░░░░░░░░░  12%    ✅ 安全        │
│ 节奏多样性  ████████░░░░░  68%    ⚠️ 最近3章同类  │
│ 情绪曲线    [折线图]                              │
│ 敏感词      0 条                  ✅ 干净        │
├──────────────────────────────────────────────────┤
│ ⚠️ 预警                                         │
│ ├ 主要矛盾「宿命枷锁」已 12 章未推进（主线偏离）    │
│ ├ 伏笔「血玉令」已逾期 5 章                        │
│ ├ 连续 3 章战斗章，建议插入喘息                     │
│ └ 角色「苏晴」已 15 章弧线无推进                    │
├──────────────────────────────────────────────────┤
│ 📈 趋势（最近20章）                                │
│ ├ AI味趋势折线                                    │
│ ├ 章节字数折线                                    │
│ └ 伏笔开/收比折线                                 │
└──────────────────────────────────────────────────┘
```

## 矛盾辩证追踪设计

### 理论基础（唯物辩证法映射）

| 辩证法概念 | 小说映射 | 系统实现 |
|---|---|---|
| **矛盾的普遍性** | 每章每场景都应有冲突张力 | 章后审计检测"无矛盾推进章" |
| **主要矛盾** | 贯穿全书的核心冲突（猫腻"控制观念"） | `conflict.rank = "primary"` 字段 |
| **次要矛盾** | 支线冲突、角色内心冲突 | `conflict.rank = "secondary"` 字段 |
| **矛盾转化** | 次要变主要（情节突转）、性质变化 | `transforming` 状态 + 转化记录 |
| **对抗性矛盾** | 外部冲突（打脸/战斗/对抗） | `conflict.nature = "antagonistic"` |
| **非对抗性矛盾** | 内部冲突（成长/抉择/道德困境） | `conflict.nature = "non-antagonistic"` |
| **矛盾统一** | 高潮解决、角色升华 | `unifying` 状态 |

### 数据模型扩展

在已有 `bible_conflict` 表基础上扩展：

```ts
// 扩展现有 BibleConflictRecord
interface ConflictDialecticExtension {
  rank: "primary" | "secondary";                   // 矛盾层级
  nature: "antagonistic" | "non-antagonistic";     // 矛盾性质
  sides: [string, string];                         // 矛盾双方
  controllingIdea?: string;                        // 控制观念（主要矛盾时）
  transformations: Array<{
    chapter: number;
    fromState: string;
    toState: string;
    trigger: string;                               // 触发事件
    rankChange?: { from: "primary" | "secondary"; to: "primary" | "secondary" };
  }>;
}

// 现有 resolutionState 扩展：
// "latent" → "emerging" → "escalating" → "transforming" → "climaxing" → "unifying" → "resolved"
```

### 主线偏离检测

比已有的 `detectStalledConflicts(threshold=10)` 更严格：

```ts
function detectMainConflictDrift(params: {
  conflicts: BibleConflictRecord[];
  currentChapter: number;
}): MainConflictDriftWarning | null {
  const primary = conflicts.find(c => c.rank === "primary");
  if (!primary) return null;
  // 主要矛盾的阈值是 5 章（比次要矛盾的 10 章更严格）
  return detectStalledConflict(primary, currentChapter, 5);
}
```

### 矛盾地图 UI

```text
矛盾地图
┌───────────────────────────────────────┐
│ ★ 主要矛盾：凡人 vs 仙道不公           │
│   性质：对抗性   状态：escalating       │
│   控制观念："顺为凡，逆为仙"            │
│   ▓▓▓▓▓▓▓▓▓░░░ 第1→52章 [活跃]       │
│                                       │
│ ○ 次要矛盾：师门暗流                   │
│   性质：对抗性   状态：transforming     │
│   ▓▓▓▓▓░░░░░░░ 第12→38章 → 正在转化   │
│                                       │
│ ○ 次要矛盾：主角 vs 自我怀疑           │
│   性质：非对抗性  状态：escalating      │
│   ▓▓▓▓▓▓▓░░░░░ 第5→52章 [缓慢推进]    │
│                                       │
│ ● 已解决：宗门入门考验                  │
│   性质：对抗性   第3→15章 [已统一]      │
└───────────────────────────────────────┘
```

## 角色弧线长程追踪设计

### 弧线类型

```ts
type ArcType = "positive-growth" | "fall" | "flat" | "transformation" | "redemption";

interface CharacterArc {
  characterId: string;
  arcType: ArcType;
  startPoint: string;      // "底层小兵，唯唯诺诺"
  endPoint: string;        // "威震一方，心怀天下"
  currentPhase: string;    // "觉醒期"
  beats: ArcBeat[];
}

interface ArcBeat {
  chapter: number;
  event: string;           // "首次违抗宗门命令"
  change: string;          // "从服从转向质疑"
  direction: "advance" | "regression" | "neutral";
}
```

### 弧线一致性检测

```ts
function detectArcInconsistency(arc: CharacterArc): ArcWarning | null {
  const recentBeats = arc.beats.slice(-5);
  const regressionCount = recentBeats.filter(b => b.direction === "regression").length;
  if (arc.arcType === "positive-growth" && regressionCount >= 3) {
    return {
      characterId: arc.characterId,
      warning: `声明为正向成长型，但最近 5 次行为中有 ${regressionCount} 次退行`,
    };
  }
  return null;
}
```

### 弧线推进来源

每章写完后，从 `ChapterAnalyzerAgent` 的分析结果中提取角色关键行为，自动生成候选 arc beat，作者确认后持久化。

## 题材文风守护设计

### 流派→文风推荐表

```ts
const GENRE_TONE_MAP: Record<string, string[]> = {
  "仙侠-古典":    ["古典意境", "悲苦孤独", "诗性收束"],
  "仙侠-凡人流":  ["克制质朴", "悲苦", "冷峻"],
  "玄幻-废柴流":  ["热血直白", "口语化", "节奏明快"],
  "玄幻-悲苦":    ["悲苦孤独", "冷峻", "大气"],
  "都市-硬汉":    ["冷峻口语", "动作外化", "短句为主"],
  "都市-制度修仙": ["黑色幽默", "讽刺", "口语化"],
  "科幻-硬核":    ["质朴硬朗", "数据密", "环境感"],
  "历史-穿越":    ["古典", "数据精准", "制度细节"],
  "女频-宅斗":    ["细腻温润", "环境密度高", "礼仪感"],
  "女频-大世界观": ["冷峻", "大气", "感情克制"],
  "搞笑-沙雕":    ["口语化", "梗密度高", "节奏快"],
  "盗墓-灵异":    ["悬疑感", "志怪氛围", "短句紧张"],
};
```

### 文风偏离检测

```ts
interface ToneDriftResult {
  declaredTone: string;
  detectedTone: string;
  driftScore: number;        // 0-1
  driftDirection: string;    // "偏向轻快" / "偏向悲苦" / ...
  isSignificant: boolean;    // driftScore > 0.4
  consecutiveDriftChapters: number;
}
```

检测方式：
1. 从 `style_profile` 提取当前章的统计特征（句长/段落/修辞）
2. 与声明 tone 的参考范围对比
3. 可选：LLM 判断语气偏离（temperature=0，短 prompt）

## API 路由

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/books/:bookId/hooks/generate` | 生成章末钩子 |
| GET | `/api/books/:bookId/pov` | 获取 POV 仪表盘 |
| GET | `/api/progress` | 获取日更进度 |
| PUT | `/api/progress/config` | 设置日更目标 |
| POST | `/api/books/:bookId/chapters/:ch/rhythm` | 分析章节节奏 |
| POST | `/api/books/:bookId/chapters/:ch/dialogue` | 分析章节对话 |
| GET | `/api/books/:bookId/health` | 全书健康仪表盘 |
| GET | `/api/books/:bookId/conflicts/map` | 矛盾辩证地图 |
| GET | `/api/books/:bookId/arcs` | 角色弧线总览 |
| POST | `/api/books/:bookId/chapters/:ch/tone-check` | 文风偏离检测 |

## UI 组件

| 组件 | 位置 | shadcn/ui |
|---|---|---|
| `ChapterHookGenerator` | 章节编辑器侧栏 | Card, Button, RadioGroup, Badge |
| `PovDashboard` | 书籍总览页 | Card, Table, Badge, Progress |
| `DailyProgressTracker` | 首页 / 书籍总览 | Card, Progress, Badge |
| `RhythmChart` | 章节分析页 | Card, 轻量图表 |
| `DialogueAnalysis` | 章节分析页 | Card, Table, Progress, Badge |
| `BookHealthDashboard` | 书籍总览页（顶部） | Card, Progress, Badge, 图表 |
| `ConflictMap` | 书籍总览 / 独立页 | Card, Timeline, Badge |
| `CharacterArcDashboard` | 书籍总览 / 独立页 | Card, Progress, Timeline, Badge |
| `ToneDriftAlert` | 章节审计报告内嵌 | Alert, Badge |

## Testing Strategy

### Unit Tests
- 钩子生成器：mock LLM，验证输出格式和钩子类型分类。
- POV 追踪：多视角/单视角/角色缺失/gap 计算。
- 日更进度：跨天/streak/预计完成日期/零数据。
- 节奏分析：均匀句长检测/正常句长/空文本。
- 对话分析：纯叙述/纯对话/混合/角色分组。
- 全书健康：聚合计算正确/空数据降级/趋势截断。
- 矛盾辩证：主线偏离检测/转化记录/层级变更。
- 角色弧线：弧线一致性检测/退行预警/空弧线安全。
- 文风偏离：偏离计算/连续偏离计数/题材推荐。

### Integration Tests
- 写完章节后 → 生成钩子 → 选择 → 插入末尾 → pending_hooks 更新。
- 连续写 3 章 → POV 统计正确 → 建议合理。
- 写 2 天各 1 章 → streak=2 → 折线图数据正确。
- 写 10 章 → 审计日志持久化 → 健康仪表盘聚合正确。
- 声明主要矛盾 → 5 章未推进 → 主线偏离预警。
- 声明角色正向成长 → 连续退行 → 弧线一致性预警。
- 声明悲苦基调 → 写轻快章 → 文风偏离提醒。
