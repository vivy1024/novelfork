# Design Document

## Overview

本设计为 NovelFork 添加六种精细化 AI 写作模式和作品导入增强，补充已有的"写整章"和"修订整章"能力。所有模式共享同一套上下文注入管线（style_guide + genre_profile + book_rules + 经纬上下文），不重复造轮子。

## 现有写作能力对照

| 能力 | 已有实现 | 本 spec 补充 |
|---|---|---|
| 写整章 | `WriterAgent.writeChapter()` | — |
| 润色/改写/重写/反检测/定点修复 | `ReviserAgent` 5 种 mode | — |
| 大纲生成 | `ArchitectAgent.generateFoundation()` | 大纲续写+分支 |
| 旧作导入+文风 | `importChapters()` + `generateStyleGuide()` | 文件拖放 UI + 多作品文风合并 + 漂移检测 |
| 选段续写 | ❌ | ✅ 新增 |
| 场景扩写 | ❌ | ✅ 新增 |
| 对话生成 | ❌ | ✅ 新增 |
| 多版本对比 | ❌ | ✅ 新增 |
| 段落补写 | ❌ | ✅ 新增 |

## Goals

- 让作者在写作中途随时获得 AI 辅助，不必等到整章写完。
- 所有模式共享上下文注入管线，保持文风和设定一致性。
- 所有模式的结果都是"建议"，作者可接受/编辑/丢弃。
- 支持旧作导入的完整前端流程和多作品文风合并。

## Non-Goals

- 不替代 ReviserAgent 的后置修订能力。
- 不自动修改未选中的正文。
- 不做实时联想（typing autocomplete），只做显式触发。
- 不做语音转文字。

## Architecture

### 文件组织

```text
packages/core/src/agents/
  inline-writer.ts                   ← 选段续写 / 场景扩写 / 段落补写
  dialogue-generator.ts              ← 对话生成
  variant-generator.ts               ← 多版本对比
  outline-brancher.ts                ← 大纲续写与分支

packages/core/src/tools/
  import/
    file-parser.ts                   ← .txt/.docx/.epub 解析
    multi-work-style.ts              ← 多作品文风合并
    style-drift-detector.ts          ← 文风漂移检测

packages/studio/src/components/writing-modes/
  InlineContinuation.tsx             ← 选段续写 UI
  SceneExpander.tsx                  ← 场景扩写 UI
  DialogueGenerator.tsx              ← 对话生成 UI
  VariantCompare.tsx                 ← 多版本对比 UI
  ParagraphBridge.tsx                ← 段落补写 UI
  OutlineBrancher.tsx                ← 大纲分支 UI
  WorkImporter.tsx                   ← 作品导入 UI

packages/studio/src/api/routes/
  writing-modes.ts                   ← 写作模式 API
```

### 统一上下文注入

所有写作模式共享同一个上下文构建函数：

```ts
interface InlineWriteContext {
  styleGuide?: string;          // style_guide.md
  styleProfile?: StyleProfile;  // style_profile.json
  genreProfile?: GenreProfile;  // genre_profile
  bookRules?: BookRules;        // book_rules.md
  bibleContext?: string;        // 经纬上下文（角色/设定/矛盾/世界观）
  currentState?: string;        // current_state.md
  characterMatrix?: string;     // character_matrix.md（对话生成时必要）
  enabledPresets?: string[];    // 启用的预设 promptInjection（来自 writing-presets-v1）
}

async function buildInlineWriteContext(bookId: string, chapterNumber: number): Promise<InlineWriteContext>
```

复用已有的 `prepareWriteInput()` / `buildBibleContext()` / `composeBibleContext()` 管线。

## Data Model

### 写作模式通用

```ts
export type InlineWriteMode = "continuation" | "expansion" | "dialogue" | "variant" | "bridge";

export interface InlineWriteInput {
  bookId: string;
  chapterNumber: number;
  mode: InlineWriteMode;
  selectedText: string;           // 选中的文本
  beforeText: string;             // 选中之前的正文
  afterText?: string;             // 选中之后的正文（补写时需要）
  direction?: string;             // 作者的一句话提示（可选）
  targetWordCount?: number;       // 目标字数
}

export interface InlineWriteResult {
  content: string;
  wordCount: number;
  mode: InlineWriteMode;
  metadata: Record<string, unknown>;
}
```

### 选段续写

```ts
export interface ContinuationInput extends InlineWriteInput {
  mode: "continuation";
  targetWordCount?: number;       // 默认 500-1500
  direction?: string;             // "写一段打斗" / "推进到下一个场景"
}
```

### 场景扩写

```ts
export type ExpansionFocus = "sensory" | "action" | "psychology" | "environment" | "dialogue";

export interface ExpansionInput extends InlineWriteInput {
  mode: "expansion";
  targetWordCount: number;        // 扩写后的目标总字数
  focus?: ExpansionFocus[];       // 扩写方向
}

export interface ExpansionResult extends InlineWriteResult {
  originalWordCount: number;
  expandedWordCount: number;
  expansionRatio: number;
}
```

### 对话生成

```ts
export interface DialogueInput {
  bookId: string;
  chapterNumber: number;
  characters: string[];           // 角色名列表
  scene: string;                  // 场景描述
  purpose: string;                // 对话目的
  turns: number;                  // 对话轮数，默认 5
  insertAfterText?: string;       // 插入位置的前文
}

export interface DialogueLine {
  character: string;
  text: string;
  action?: string;                // 可选的动作描写
}

export interface DialogueResult {
  lines: DialogueLine[];
  totalWords: number;
  formatted: string;              // 格式化的对话文本（可直接插入正文）
}
```

### 多版本对比

```ts
export interface VariantInput extends InlineWriteInput {
  mode: "variant";
  count: number;                  // 版本数，默认 3（2-5）
  styleVariation?: "subtle" | "moderate" | "dramatic";
}

export interface Variant {
  id: string;
  content: string;
  wordCount: number;
  label: string;                  // "更克制" / "更激烈" / "更口语化"
  diffFromOriginal: string[];     // 与原文的关键差异
}

export interface VariantResult {
  original: string;
  variants: Variant[];
}
```

### 段落补写

```ts
export interface BridgeInput extends InlineWriteInput {
  mode: "bridge";
  purpose: "scene-transition" | "time-skip" | "emotional-transition" | "suspense-setup";
  targetWordCount?: number;       // 默认 100-500
}
```

### 大纲分支

```ts
export interface OutlineBranchInput {
  bookId: string;
  currentVolume: number;
  nextVolumeNumber: number;
}

export interface OutlineBranch {
  id: string;
  title: string;
  corConflict: string;           // 核心冲突
  keyTurningPoints: string[];
  estimatedChapters: number;
  consumedHooks: string[];        // 消耗的伏笔
  newHooks: string[];             // 新增的伏笔
}

export interface OutlineBranchResult {
  branches: OutlineBranch[];
  context: {
    pendingHooks: string[];
    unresolvedConflicts: string[];
    currentProgress: string;
  };
}
```

### 作品导入增强

```ts
export interface WorkImport {
  source: "text" | "txt" | "docx" | "epub";
  purpose: "style-only" | "continuation";
  content: string;
  title: string;
}

export interface PersonalStyleProfile {
  works: Array<{
    title: string;
    styleProfile: StyleProfile;
    analyzedAt: string;
  }>;
  merged: {
    avgSentenceLength: { mean: number; range: [number, number] };
    avgParagraphLength: { mean: number; range: [number, number] };
    vocabularyDiversity: { mean: number; range: [number, number] };
    commonRhetoricalFeatures: string[];
    commonPatterns: string[];
  };
  generatedStyleGuide: string;    // 合并后的个人风格指南
}

export interface StyleDriftReport {
  currentChapter: number;
  drift: {
    sentenceLengthDrift: number;  // 偏差百分比
    vocabularyDrift: number;
    overallDrift: number;         // 0-1
  };
  isSignificant: boolean;
  suggestions: string[];
}
```

## Prompt 设计

### 选段续写 Prompt

```text
你是一位网文续写专家。从作者选中的段落之后继续写作。

【写作规则】
{style_guide}
{book_rules}
{preset_injections}

【当前状态】
{current_state 摘要}

【前文】
{beforeText 最后 3000 字}

【选中段落（续写起点）】
{selectedText}

【作者指示】
{direction，如果有}

要求：
- 续写 {targetWordCount} 字
- 延续前文的节奏和风格
- 不重复选中段落的内容
- 保持角色和情节连贯
```

### 场景扩写 Prompt

```text
你是一位场景细节专家。扩展以下段落到 {targetWordCount} 字。

【原段落】
{selectedText}（{originalWordCount} 字）

【扩写方向】
{focus: 五感细节/动作分解/心理活动/环境描写/对话补充}

【写作规则】
{style_guide}

要求：
- 保持原段核心事件不变
- 不改变角色行为和决定
- 只增加细节，不增加新情节
- 扩写后自然融入前后文
```

### 对话生成 Prompt

```text
你是一位对话设计师。生成一段角色对话。

【参与角色】
{角色A}: {性格、说话风格、关系}
{角色B}: {性格、说话风格、关系}

【场景】
{scene}

【对话目的】
{purpose}

【对话风格参考】
{style_guide 的对话风格部分}

要求：
- 生成约 {turns} 轮对话
- 每个角色的台词符合其性格
- 可加入动作描写和心理活动
- 对话推进场景目的
```

### 多版本 Prompt

并行调用 LLM N 次，每次注入不同的 system prompt 变体：

```text
版本 A（更克制）：用最少的词表达同样的意思，删减修辞。
版本 B（更激烈）：加强冲突感和情绪张力。
版本 C（更口语化）：使用更口语化的表达。
```

## API 路由

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/books/:bookId/inline-write` | 选段续写/扩写/补写（通过 body.mode 区分） |
| POST | `/api/books/:bookId/dialogue/generate` | 对话生成 |
| POST | `/api/books/:bookId/variants/generate` | 多版本生成 |
| POST | `/api/books/:bookId/outline/branch` | 大纲分支 |
| POST | `/api/books/:bookId/outline/branch/:branchId/expand` | 将分支扩展为完整大纲 |
| POST | `/api/works/import` | 导入作品（文风分析或续写准备） |
| GET | `/api/style/personal-profile` | 获取个人风格 profile |
| POST | `/api/books/:bookId/style/drift-check` | 检测文风漂移 |

## UI 交互设计

### 章节编辑器集成

写作模式触发方式：

1. **选中文本** → 浮动工具栏出现 → 续写 / 扩写 / 多版本 / 删除
2. **光标在段落间** → 行间按钮 → 补写 / 插入对话
3. **编辑器工具栏** → 对话生成（需要选角色，不依赖选中）

### 结果预览

所有模式的结果展示遵循同一模式：

```text
┌─────────────────────────────────┐
│ [续写预览]                       │
│                                 │
│ 前文（灰色）...                  │
│ ─────────────────               │
│ 续写内容（蓝色高亮）              │
│ ─────────────────               │
│ 后文（灰色）...                  │
│                                 │
│ 字数：1200    模式：续写          │
│                                 │
│ [接受]  [编辑后接受]  [重新生成]  [丢弃] │
└─────────────────────────────────┘
```

多版本对比使用 Tab 切换或并排展示。

### 作品导入 UI

```text
导入我的作品
┌──────────────────────────────────┐
│  拖放 .txt / .docx / .epub 文件  │
│  或 [粘贴文本]                    │
└──────────────────────────────────┘

导入目的：
  ○ 只分析文风（完结作品）
  ○ 续写（在写作品，需要 AI 接着写）

[已导入作品]
  ├ 《仙路独行》  2024-01-15 分析  句长 18.5  多样性 0.72
  ├ 《都市修真录》 2024-03-20 分析  句长 15.2  多样性 0.68
  └ [生成个人风格 Profile]
```

## Testing Strategy

### Unit Tests
- 选段续写：mock LLM，验证 context 包含 beforeText+selectedText，output 字数在范围内。
- 场景扩写：验证原文事件保留、字数达标。
- 对话生成：验证角色数量匹配、轮数匹配、格式正确。
- 多版本：验证版本数量正确、版本间有差异。
- 段落补写：验证读取前后段、output 作为桥梁段。
- 大纲分支：验证读取 hooks/conflicts、生成 2-3 条走向。
- 多作品文风合并：验证合并统计正确、交集特征提取。
- 文风漂移：验证偏差计算、阈值判断。

### Integration Tests
- 选段续写 → 接受 → 正文更新 → 真相文件不受影响。
- 对话生成 → 角色经纬存在 → 生成 → 插入 → 角色台词风格一致。
- 导入 3 本作品 → 合并分析 → 个人 profile → 新书使用 → AI 文风接近。
