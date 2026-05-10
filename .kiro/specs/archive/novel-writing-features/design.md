# 小说写作特有功能 — 设计文档

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                    前端 UI 层                                 │
│  WritingToolsPanel → PresetSelector → PresetResultView      │
│  HealthDashboard → EmotionCurve / PacingChart / AiScoreBadge│
│  BeatTracker → BeatProgressBar / BeatAnnotation             │
│  DailyProgressWidget → CalendarHeatmap / StreakCounter      │
│  AiTasteOverlay → HighlightedSegments / OneClickFix         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    API 层 (Hono routes)                       │
│  POST /books/:id/presets/:presetId/run                       │
│  POST /books/:id/chapters/:chId/health                       │
│  POST /books/:id/chapters/:chId/ai-taste/detect              │
│  POST /books/:id/chapters/:chId/ai-taste/fix                 │
│  GET  /books/:id/daily-progress                              │
│  POST /books/:id/chapters/:chId/beat-annotate                │
│  POST /books/:id/compliance-check                            │
│  POST /books/:id/export/:format                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Core 服务层                                │
│  PresetEngine        — 预设执行（注入经纬+前文+规则→LLM）    │
│  AiTasteDetector     — 12特征本地检测 + 评分                 │
│  AiTasteFixer        — 9招降AI味改写                         │
│  ChapterHealthAnalyzer — 节奏/情绪/完读率/钩子评分           │
│  BeatEngine          — 节拍表管理 + 约束注入                 │
│  DailyProgressTracker — 字数统计 + 持久化                    │
│  ComplianceChecker   — 敏感词 + AI含量 + 标注生成            │
│  ExportService       — TXT/DOCX/ePub 生成                   │
│  StyleDriftDetector  — 文风基线 + 漂移检测                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    数据层                                     │
│  SQLite: daily_progress / chapter_health / beat_annotations  │
│  Files:  books/<id>/story/* (Truth Files)                    │
│  Files:  books/<id>/presets/* (自定义预设)                    │
└─────────────────────────────────────────────────────────────┘
```

---

## 模块设计

### 1. PresetEngine（写作预设引擎）

```typescript
interface WritingPreset {
  id: string;
  name: string;
  category: "narrative" | "style" | "ai-taste" | "technique";
  trigger: string;           // 触发场景描述
  systemPrompt: string;      // 系统提示词模板
  contextInjection: {
    includeJingwei: boolean;  // 注入经纬
    includePrevChapters: number; // 注入前N章
    includeOutline: boolean;  // 注入大纲
    includeBeatPosition?: string; // 当前节拍位置
  };
  outputFormat: "text" | "structured" | "comparison";
  userEditable: boolean;
}
```

**执行流程：**
1. 用户选择预设 → 选择作用范围（全章/选段/全书）
2. PresetEngine 组装上下文（经纬 + 前文 + 规则 + 节拍）
3. 调用 LLM（走现有 session-chat-service）
4. 返回结果 → 前端按 outputFormat 渲染

**预设存储：**
- 内置预设：`packages/core/src/presets/builtin/` 硬编码
- 自定义预设：`books/<id>/presets/*.json`
- 套路系统预设：通过 routines 机制注入

### 2. AiTasteDetector（AI 味检测器）

```typescript
interface AiTasteResult {
  score: number;              // 0-100，越低越好
  segments: AiTasteSegment[]; // 命中段落
  summary: string;            // 总结
}

interface AiTasteSegment {
  start: number;              // 字符偏移
  end: number;
  text: string;
  features: AiTasteFeature[]; // 命中的特征
  severity: "high" | "medium" | "low";
  suggestion: string;         // 修改建议
}

type AiTasteFeature =
  | "formal-tone"           // 过度正式
  | "template-structure"    // 固定句式
  | "ai-vocabulary"         // AI典型词汇
  | "lack-emotion"          // 缺乏情感力量
  | "no-personality"        // 缺乏个人经验
  | "uniform-length"        // 句长方差小
  | "ppt-structure"         // 段落太工整
  | "jargon-dense"          // 术语密度高
  | "adjective-pile"        // 形容词堆叠
  | "lack-detail"           // 缺少具体细节
  | "formal-dialogue"       // 对话太书面
  | "pseudo-human";         // 伪人感
```

**检测方式（本地，不依赖外部API）：**
1. 句长方差分析（统计）
2. 关键词匹配（AI典型词库）
3. 结构模式匹配（首先/其次/最后）
4. 段落长度均匀度（统计）
5. 形容词密度（NLP分词）
6. 对话书面语检测（规则）

### 3. ChapterHealthAnalyzer（章节健康度）

```typescript
interface ChapterHealth {
  wordCount: number;
  targetWordCount: number;
  aiScore: number;                    // AI味分数
  pacingScore: number;                // 节奏评分 0-100
  emotionCurve: EmotionPoint[];       // 情绪曲线
  firstHookScore: number;             // 开篇吸引力
  lastHookScore: number;              // 结尾卡点
  estCompleteRate: number;            // 估算完读率
  issues: HealthIssue[];              // 问题列表
}

interface EmotionPoint {
  position: number;   // 0-1 归一化位置
  intensity: number;  // -1 到 1（负=低谷，正=高潮）
  label?: string;     // "爽点" | "低谷" | "转折"
}
```

**计算方式：**
- 节奏评分：基于爽点间距（理想：每2000字一个小爽点，每10000字一个大爽点）
- 情绪曲线：按段落用 LLM 标注情绪强度（可缓存）
- 完读率估算：综合节奏+钩子+AI味的加权公式
- 开篇/结尾评分：分析前500字/后200字的悬念/冲突密度

### 4. BeatEngine（节拍表引擎）

```typescript
interface BeatTemplate {
  id: string;
  name: string;
  beats: Beat[];
}

interface Beat {
  id: string;
  name: string;
  description: string;
  position: number;          // 0-1 归一化位置
  requirements: string[];    // AI生成时的约束
  examples?: string[];       // 示例
}

// 内置模板
const SAVE_THE_CAT_15: BeatTemplate;     // 救猫咪15节拍
const HEROS_JOURNEY_17: BeatTemplate;    // 英雄之旅17阶段
const THREE_ACT: BeatTemplate;           // 三幕结构
const WEBNOVEL_OPENING_12: BeatTemplate; // 网文开篇12式
```

### 5. DailyProgressTracker（日更追踪）

```sql
CREATE TABLE daily_progress (
  id INTEGER PRIMARY KEY,
  book_id TEXT NOT NULL,
  date TEXT NOT NULL,          -- YYYY-MM-DD
  words_added INTEGER DEFAULT 0,
  chapters_added INTEGER DEFAULT 0,
  target_words INTEGER DEFAULT 6000,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(book_id, date)
);
```

---

## 实现顺序

| 阶段 | 模块 | 预估工期 | 前置 |
|------|------|---------|------|
| **Phase 1** | PresetEngine + 4个核心预设（续写/改写/评点/消AI味） | 5天 | — |
| **Phase 2** | AiTasteDetector + AiTasteFixer + 前端高亮 | 5天 | Phase 1 |
| **Phase 3** | ChapterHealthAnalyzer + HealthDashboard UI | 5天 | Phase 2 |
| **Phase 4** | BeatEngine + 4个内置模板 + 约束注入 | 4天 | Phase 1 |
| **Phase 5** | DailyProgressTracker + CalendarHeatmap UI | 3天 | — |
| **Phase 6** | 剩余8个预设 + 黄金三章特检 + 平台合规 | 5天 | Phase 1-4 |
| **Phase 7** | 文风漂移检测 + 模板市场 + 导出 | 7天 | Phase 1-6 |

**总计约 34 天**，可并行压缩到 **4-5 周**。

---

## 与现有系统的集成点

| 现有模块 | 集成方式 |
|---------|---------|
| WritingToolsPanel | 扩展为 PresetSelector，从7种工具扩展到12+预设 |
| PipelineRunner | PresetEngine 复用其 LLM 调用链路 |
| CockpitOverview | 嵌入 HealthDashboard 摘要卡片 |
| WorkbenchCanvas | 嵌入 AiTasteOverlay 高亮层 |
| session-chat-service | 预设执行走 session 工具调用路径 |
| Truth Files | PresetEngine 读取经纬/大纲/规则作为上下文 |
| DashboardPage | 嵌入 DailyProgressWidget |
| 套路系统 | 预设可作为 routine 导入/导出 |
