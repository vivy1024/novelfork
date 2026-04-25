# Design Document

## Overview

本设计为 NovelFork 的写作预设体系填充真实内容，使流派配置、文风预设、节拍模板、AI 味过滤预设、文学技法预设和经纬题材推荐从空壳变为开箱即用。

## Goals

- 预置 6+ 热门流派的完整 GenreProfile。
- 内置 5 个文风 tone 预设模板。
- 内置 5 个叙事节拍模板。
- 内置 4 个 AI 味过滤预设。
- 内置 4 个文学技法预设。
- 为 6 个题材填充经纬推荐栏目的具体内容。
- 提供预设管理 UI。

## Non-Goals

- 不实现完整模板市场（后续 `template-market-v1`）。
- 不自动生成流派资产（后续 `coding-agent-workbench`）。
- 不涉及角色弧线追踪（后续 `progressions-tracking`）。

## Architecture

### 文件组织

```text
packages/core/src/presets/
  index.ts                           ← 预设注册中心
  types.ts                           ← Preset / PresetCategory / PresetConfig 类型
  genres/
    xianxia.md                       ← 修仙/玄幻 GenreProfile（YAML frontmatter + body）
    urban.md                         ← 都市异能
    mystery.md                       ← 悬疑/盗墓
    romance.md                       ← 女频/宅斗
    scifi.md                         ← 科幻
    history.md                       ← 历史穿越
  tones/
    tragic-solitude.md               ← 悲苦孤独
    austere-pragmatic.md             ← 冷峻质朴
    classical-imagery.md             ← 古典意境
    dark-humor-social.md             ← 黑色幽默+社会批判
    comedic-light.md                 ← 沙雕轻快
  beats/
    heros-journey.ts                 ← 英雄之旅 17 阶段
    save-the-cat.ts                  ← 救猫咪 15 节拍
    three-act.ts                     ← 三幕结构
    opening-hooks.ts                 ← 网文开篇钩子 12 式
    chapter-ending-hooks.ts          ← 章节结尾钩子生成器
  anti-ai/
    full-scan.ts                     ← 12 特征全量扫描配置
    sentence-variance.ts             ← 句长方差修复
    emotion-concretize.ts            ← 情感具体化
    dialogue-colloquial.ts           ← 口语化对话
  literary/
    character-multidim.ts            ← 人物多维度展开
    hook-four-states.ts              ← 伏笔四态追踪
    consistency-audit.ts             ← 一致性审计
    controlling-idea.ts              ← 控制观念锚定

packages/core/src/jingwei/
  genre-recommendations.ts          ← 题材推荐栏目内容（修仙/悬疑/女频/科幻/都市/历史）

packages/studio/src/pages/
  PresetManager.tsx                  ← 预设管理页面
packages/studio/src/api/routes/
  presets.ts                         ← 预设 API
```

## Data Model

### Preset 类型

```ts
export type PresetCategory = "beat" | "tone" | "anti-ai" | "literary";

export interface Preset {
  id: string;
  category: PresetCategory;
  name: string;
  description: string;
  applicableGenres: string[];       // 空=通用
  conflictGroup?: string;           // 同 group 互斥
  promptInjection: string;          // 注入 writer system prompt 的文本
  postWriteChecks?: PostWriteCheck[];
  metadata: Record<string, unknown>;
}

export interface PostWriteCheck {
  type: "sentence-variance" | "emotion-abstract" | "dialogue-formal" | "hook-missing";
  threshold: number;
  suggestion: string;
}

export interface PresetConfig {
  bookId: string;
  enabledPresets: string[];         // preset ids
  customOverrides: Record<string, Partial<Preset>>;
}
```

### GenreProfile 内容规范

每个流派 `.md` 文件包含 YAML frontmatter + Markdown body：

```yaml
---
name: 修仙/玄幻
id: xianxia
language: zh
chapterTypes:
  - 修炼突破
  - 战斗对决
  - 探索秘境
  - 交易/拍卖
  - 门派日常
  - 炼丹/炼器
  - 悟道/闭关
  - 劫难
fatigueWords:
  - 气势如虹
  - 杀气腾腾
  - 天崩地裂
  - 恐怖如斯
  - 不可思议
  - 浩浩荡荡
  - 仿佛要将整个天地都...
numericalSystem: true
powerScaling: true
eraResearch: false
pacingRule: "前50章每5-8章一个小高潮；每30-50章一个境界突破；大高潮间隔80-120章"
satisfactionTypes:
  - 境界突破
  - 越级战斗
  - 获得宝物
  - 揭露身世
  - 复仇成功
  - 装逼打脸
auditDimensions: [1, 2, 3, 6, 7, 8]
---

## 流派核心
修仙/玄幻以境界体系为骨架，主角从底层向上攀登...

## 常见结构
练气 → 筑基 → 金丹 → 元婴 → 化神 → ...

## 写作禁忌
- 避免境界碾压无悬念
- 避免资源体系崩溃（前期灵石珍贵，后期随便丢）
...
```

### 文风 Tone 预设内容规范

每个 tone `.md` 是预生成的 `style_guide.md` 模板：

```markdown
## 叙事声音与语气
悲苦孤独风——叙事者保持克制的哀伤，不滥用感叹号...
（参考：辰东《遮天》《完美世界》，耳根《仙逆》《求魔》）

## 对话风格
对话简短有力，角色说话常有未完成感...

## 场景描写特征
偏好苍茫、荒凉意象（大漠、残阳、枯木、冷月）...

## 转折与衔接手法
场景切换突兀但有情绪韵律——一个悲伤段落之后...

## 节奏特征
长句铺陈氛围 → 极短句爆发情绪...

## 词汇偏好
"苍茫"、"寂灭"、"亘古"、"孤独"...

## 情绪表达方式
不写"他很伤心"，写具体动作...

## 独特习惯
章末常用不完整句或省略号收束...
```

### 节拍模板数据结构

```ts
export interface BeatTemplate {
  id: string;
  name: string;
  origin: string;                    // 来源/理论基础
  beats: Beat[];
  totalWordRatio: number;           // 各节拍字数占比之和=1
}

export interface Beat {
  order: number;
  name: string;
  purpose: string;
  wordRatio: number;                 // 占全书的字数比例
  emotionalTone: string;
  chapterEstimate: string;           // 如"第1-3章"或"全书5%"
  networkNovelTip?: string;          // 网文特化建议
}
```

### 经纬题材推荐数据

```ts
export interface GenreRecommendation {
  genreId: string;
  genreName: string;
  sections: RecommendedSection[];
}

export interface RecommendedSection {
  key: string;
  name: string;
  description: string;
  icon?: string;
  defaultVisibility: "tracked" | "global" | "nested";
  participatesInAi: boolean;
  fields: JingweiFieldDefinition[];
  exampleEntries?: string[];
}
```

## Genre Profiles（6 个流派的 chapterTypes/fatigueWords 摘要）

### 修仙/玄幻
- chapterTypes: 修炼突破、战斗对决、探索秘境、交易拍卖、门派日常、炼丹炼器、悟道闭关、劫难
- fatigueWords: 气势如虹、恐怖如斯、不可思议、仿佛整个天地、难以想象、令人窒息
- satisfactionTypes: 境界突破、越级战斗、获得宝物、揭露身世、复仇、装逼打脸

### 都市异能
- chapterTypes: 都市奇遇、实力暴露、权贵冲突、商战布局、感情线、黑暗势力
- fatigueWords: 不可思议、震惊了、脸色铁青、杀意弥漫
- satisfactionTypes: 身份揭露、财富碾压、技能觉醒、权贵打脸

### 悬疑/盗墓
- chapterTypes: 线索发现、推理分析、密室/机关、追逐/逃生、真相揭露、误导
- fatigueWords: 毛骨悚然、不寒而栗、诡异的笑容、一股寒意
- satisfactionTypes: 真相大白、反转、解谜、逃出生天

### 女频/宅斗
- chapterTypes: 宅斗博弈、感情推进、误会/和解、家族冲突、宫廷/商场、成长蜕变
- fatigueWords: 眼眶微红、心中一暖、嘴角微扬、美得不可方物
- satisfactionTypes: 反杀、真相大白、甜蜜、报复成功、独立成长

### 科幻
- chapterTypes: 科技发现、星际探索、文明冲突、实验/事故、政治博弈、战争/舰战
- fatigueWords: 不可思议的科技、超越人类想象、宇宙的奥秘
- satisfactionTypes: 技术突破、文明发现、悬念揭晓、战术胜利

### 历史穿越
- chapterTypes: 历史事件、朝堂博弈、科技引入、民生建设、战争、文化冲突
- fatigueWords: 震惊了朝野、前所未有、史无前例
- satisfactionTypes: 改变历史、科技碾压、政治翻盘、民心归附

## Preset Injection 机制

预设通过 `writer-prompts.ts` 的 `buildPresetInjections()` 函数注入：

```ts
function buildPresetInjections(enabledPresets: Preset[]): string {
  const sections = enabledPresets
    .filter(p => p.promptInjection)
    .map(p => `## 预设：${p.name}\n\n${p.promptInjection}`);
  return sections.join("\n\n");
}
```

注入位置在 `buildWriterSystemPrompt()` 中，位于 style guide 之后、output section 之前。

## Post-Write Checks

部分预设在写完章节后执行后置检查：

| 预设 | 检查项 | 阈值 | 建议 |
|---|---|---|---|
| 句长方差修复 | 句长标准差 | ≥ 8.0 | "当前句长过于均匀，建议混合长短句" |
| 情感具体化 | 抽象情绪词密度 | ≤ 2/千字 | "发现N处抽象情绪表达，建议改为具体动作" |
| 口语化对话 | 对话书面语指标 | — | "发现N处书面语对话，建议改为口语" |
| 伏笔四态 | 未标注状态的伏笔 | 0 | "发现N个伏笔未标注当前状态" |

## UI 设计

### PresetManager 页面

```text
写作预设
  四个 Tab：节拍模板 / 文风预设 / AI味过滤 / 文学技法
  每个 Tab 下：
    卡片列表（名称 + 说明 + 适用流派标签 + 开关）
    点击卡片展开详情 + 编辑入口
  底部：当前书已启用预设摘要
```

使用 shadcn/ui：`Tabs`、`Card`、`Switch`、`Badge`、`Dialog`、`Button`、`ScrollArea`。

### 流派选择器（建书 Step 1 增强）

在 `BookCreate.tsx` 的题材字段增加流派选择下拉，选择后自动关联 GenreProfile 和推荐预设组合。

## Testing Strategy

- 每个 GenreProfile `.md` 文件有解析测试（YAML frontmatter 完整性）。
- 每个 tone 预设模板有 8 维完整性断言。
- 每个节拍模板有节拍数量和字数占比之和=1 的断言。
- 每个 PostWriteCheck 有阈值测试。
- 经纬题材推荐有栏目数量和名称断言。
- PresetManager 有组件测试：启用/禁用/冲突检测。
