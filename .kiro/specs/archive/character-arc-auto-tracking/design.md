# 角色弧线自动追踪 — 设计

## 架构

```
Pipeline post-write
    │
    ▼
syncCharacterArcs(bookId, chapterNum, content)
    │
    ├─► loadRegisteredCharacters(bookId)  ← bible_character 表
    │
    ├─► RuleEngine.extractBeats(content, characters)
    │       │
    │       ├─ 角色名匹配（正则，支持别名）
    │       ├─ 情绪/事件关键词检测
    │       └─ direction 极性判定
    │
    ├─► [可选] LLM.refineBeats(content, characters, ruleBeats)
    │       │
    │       └─ 校验 + 补充 + 修正
    │
    ├─► deduplicateBeats(existingBeats, newBeats)
    │
    ├─► writeBeats(bookId, characterId, beats)  ← bible_character_arc 表
    │
    └─► runArcDetectors(bookId)  ← detectArcInconsistency + detectStagnantArc
```

## 数据模型

### Beat 结构（追加到 key_turning_points_json）

```typescript
interface ArcBeat {
  chapterNumber: number;
  direction: "growth" | "regression" | "neutral";
  summary: string;           // 一句话描述变化
  source: "manual" | "auto-rule" | "auto-llm";
  createdAt: string;         // ISO timestamp
  confidence?: number;       // 0-1，规则引擎给 0.6-0.8，LLM 给 0.8-1.0
}
```

### 设置项（user-config.json）

```typescript
interface RuntimeControlSettings {
  // ... 现有字段
  arcTrackingMode: "off" | "rule" | "llm";  // 默认 "rule"
}
```

## 规则引擎设计

### 关键词库

```typescript
const EMOTION_KEYWORDS = {
  growth: ["觉醒", "突破", "领悟", "成长", "和解", "释然", "蜕变", "顿悟"],
  regression: ["堕落", "崩溃", "背叛", "失控", "绝望", "沉沦", "迷失"],
  neutral: ["出场", "提及", "旁观", "路过"],
};

const EVENT_KEYWORDS = {
  growth: ["救助", "牺牲", "保护", "结盟", "胜利", "获得"],
  regression: ["杀害", "抛弃", "逃跑", "失败", "失去", "被困"],
};
```

### 匹配逻辑

1. 分段扫描（按段落）
2. 每段检测角色名出现
3. 出现角色的段落中检测关键词
4. 同一角色多段出现时，取最强信号的 direction
5. 生成 summary：`"{角色名}在第{N}章{关键词动作}"`

## LLM 精细分析 Prompt

```
你是小说角色弧线分析师。给定一章正文和角色列表，分析每个出场角色的状态变化。

角色列表：{characters}
规则引擎初步结果：{ruleBeats}

请对每个角色输出：
- characterId
- direction: growth / regression / neutral
- summary: 一句话描述本章中该角色的核心变化
- confidence: 0-1

只输出有明确变化的角色，无变化的不输出。
```

## 修改文件清单

| 文件 | 改动 |
|------|------|
| `packages/core/src/tools/arcs/rule-engine.ts` | 新建：规则引擎 |
| `packages/core/src/tools/arcs/arc-sync.ts` | 新建：syncCharacterArcs 主函数 |
| `packages/core/src/tools/arcs/llm-refiner.ts` | 新建：LLM 精细分析 |
| `packages/core/src/pipeline/runner.ts` | 在 post-write 阶段调用 syncCharacterArcs |
| `packages/core/src/agents/writer.ts` | saveNewJingweiFiles 后触发 hook |
| `packages/studio/src/types/settings.ts` | 添加 arcTrackingMode 字段 |
| `packages/studio/src/api/lib/user-config-service.ts` | 默认值 + 校验 |
| `packages/studio/src/app-next/settings/SettingsSectionContent.tsx` | 设置 UI |
| `packages/studio/src/app-next/writing-workbench/CharacterArcsPanel.tsx` | beat 来源标记 |

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 规则引擎误判（把"他杀了一只鸡"判为 regression） | confidence 字段 + 用户可删除/修正 |
| LLM 调用失败 | catch + fallback 到规则引擎结果 |
| 角色别名未注册导致漏检 | 支持 bible_character 的 aliases 字段 |
| 大量角色出场导致 beat 爆炸 | 每章每角色最多 1 个 beat |
