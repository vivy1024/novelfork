# 经纬数据层统一与题材自适应 — Design

**版本**: v1.0.0
**创建日期**: 2026-06-14
**对应 Requirements**: `requirements.md` R1-R5

---

## 设计总览

经纬数据层统一的核心是：**以读模型 15 类为骨架 + outline = 统一 16 类权威分类，UI 的网文细分（item/skill/currency）降为子分类；题材模板决定初始展开规模。**

设计分 4 个单元，每个可独立理解和测试：

1. **统一分类定义**（解决双轨）
2. **题材模板系统**（解决经纬过重）
3. **建书直建 SQLite**（解决 md 倒置）
4. **协同维护数据结构**（支撑后续审阅）

---

## 单元 1：统一分类定义

### 权威分类（唯一真相源）

新建 `packages/novel-plugin/src/engine/jingwei/unified-categories.ts`：

```ts
export const JINGWEI_CATEGORIES = [
  "premise",           // 故事基线
  "world-model",       // 世界模型
  "characters",        // 角色
  "relationships",     // 关系
  "factions",          // 势力
  "locations",         // 地点
  "props",             // 道具资源
  "outline",           // 卷纲/大纲
  "conflicts",         // 矛盾冲突
  "foreshadowing",     // 伏笔
  "timeline",          // 时间线
  "chapter-summaries", // 章节摘要
  "power-system",      // 能力体系
  "rules",             // 写作规则
  "reference",         // 参考资料(AI不读)
  "unclassified",      // 未分类
] as const;

export type JingweiCategory = typeof JINGWEI_CATEGORIES[number];
```

### 子分类（仅 UI 展开用，数据层仍存顶层类）

```ts
export const CATEGORY_SUBCATEGORIES: Partial<Record<JingweiCategory, SubCategory[]>> = {
  props: [
    { id: "item", name: "物品", icon: "package" },
    { id: "skill", name: "功法", icon: "flame" },
    { id: "currency", name: "货币", icon: "coins" },
  ],
  "world-model": [
    { id: "geography", name: "地理", icon: "map" },
    { id: "special", name: "特殊设定", icon: "sparkles" },
  ],
};
```

子分类存储方式：条目的 `customFields.subcategory` 字段（可选），不影响顶层分类。

### 消费方迁移

| 消费方 | 改动 |
|--------|------|
| `category-schemas.ts`（UI 16类） | **删除**，改为从 `unified-categories.ts` 导入 + 按题材模板过滤 |
| `read-model/category-map.ts`（15类） | **删除** JINGWEI_READ_CATEGORIES / CATEGORY_ALIASES，改为导入统一定义 |
| `build-jingwei-brief.ts` | `sectionPriority` 直接用统一分类名，无需 alias 转换 |
| `JingweiCategorySidebar.tsx` | 从统一定义读取，按题材模板过滤可见类 |
| `jingwei-write-handler.ts` | 校验 category 用统一枚举 |

### 旧数据迁移

SQLite `story_jingwei_entries` 表的 category 字段映射：

```ts
const LEGACY_CATEGORY_MAP: Record<string, JingweiCategory> = {
  character: "characters",
  event: "conflicts",       // event 含冲突/转折，归入 conflicts
  worldview: "world-model",
  "power-system": "power-system",
  geography: "locations",
  faction: "factions",
  item: "props",            // subcategory=item
  skill: "props",           // subcategory=skill
  currency: "props",        // subcategory=currency
  special: "world-model",   // subcategory=special
  outline: "outline",
  relationship: "relationships",
  foreshadowing: "foreshadowing",
  plot: "conflicts",        // subcategory=plot
  timeline: "timeline",
  "chapter-summary": "chapter-summaries",
};
```

迁移为 SQLite migration（幂等：重复运行不损坏）。迁移时同时写入 `customFields.subcategory`（item/skill/currency/special/plot）保留细分信息。

---

## 单元 2：题材模板系统

### 模板定义

新建 `packages/novel-plugin/src/engine/jingwei/genre-templates.ts`：

```ts
export type GenreComplexity = "light" | "medium" | "heavy";

export interface GenreTemplate {
  id: string;
  name: string;
  complexity: GenreComplexity;
  visibleCategories: JingweiCategory[];
  expandSubcategories: JingweiCategory[];
  enrichConstraints: string;
  presetIds: string[];
}
```

### 三档默认模板

| 档位 | 可见顶层类 | AI 丰富约束 |
|------|-----------|------------|
| 轻量(都市/言情/爽文) | characters + conflicts + foreshadowing + outline + chapter-summaries（5类） | 只生成主角+2-3冲突对象+主线，不碰世界观/力量体系 |
| 中度(系统流/游戏/悬疑) | +props +world-model +rules（8类） | +系统/金手指规则+1-2支线，世界观简述 |
| 重度(修仙/玄幻/西幻) | 全开16类(除unclassified)，props/world-model展开子分类 | 完整世界观+力量体系+势力+地理+配角(3-5)+伏笔种子 |

### 题材→模板映射（支持组合）

轻量：都市/职场/言情/赘婿/体育/轻小说
中度：系统流/游戏/无限流/悬疑/末日/重生/穿越
重度：玄幻/仙侠/修真/武侠/科幻/历史/克苏鲁/赛博朋克

作者可在模板基础上手动增删可见分类（book config `visibleCategories` 覆盖模板默认）。

---

## 单元 3：建书直建 SQLite

### 流程改造

```
guided-setup (改后):
  ① 确定题材 → GENRE_TEMPLATE_MAP → GenreTemplate
  ② 更新 book.json（genre/platform/字数/visibleCategories/complexity）
  ③ 预设：template.presetIds + 题材映射合并（支持多个）
  ④ createJingweiEntriesFromGuide(bookId, answers, template)
     → 按 template 约束生成结构化条目 → 写 SQLite（source="system-init"）
  ⑤ 异步 AI 丰富（可选）：在 enrichConstraints 约束内丰富
     → upsert SQLite 条目（source="ai-enrich"）
  ⑥ 不再写 md、不再 fetch localhost
```

### 废除的代码路径

- `localStoryFiles()` / `buildPresetStoryFiles()` —— 建书链路不再调用
- `fetch localhost:port/jingwei/import-from-files` —— 改为进程内直调（仅旧书兼容保留）

---

## 单元 4：协同维护数据结构

### 新增字段

```ts
export type EntrySource = "user" | "agent-write" | "auto-settle" | "system-init" | "ai-enrich";
export type ConflictStatus = "none" | "pending" | "resolved";

export interface EntryRevision {
  timestamp: string;
  source: EntrySource;
  changedFields: string[];
  previousSnapshot?: string;
}

// StoryJingweiEntryRecord 新增：
source: EntrySource;
revisionHistory: EntryRevision[];
conflictStatus: ConflictStatus;
conflictDetail?: string;
```

### SQLite 迁移

```sql
ALTER TABLE story_jingwei_entries ADD COLUMN source TEXT DEFAULT 'user';
ALTER TABLE story_jingwei_entries ADD COLUMN revision_history TEXT DEFAULT '[]';
ALTER TABLE story_jingwei_entries ADD COLUMN conflict_status TEXT DEFAULT 'none';
ALTER TABLE story_jingwei_entries ADD COLUMN conflict_detail TEXT;
```

### 冲突检测

agent 修改条目时：检查最近一次修改是否来自 user 且在 N 分钟内 → 是则 `conflictStatus="pending"` + 记录分歧；否则正常写入。裁决由后续 UI spec 实现。

---

## 迁移策略

1. SQLite migration（加列）
2. 分类迁移（LEGACY_CATEGORY_MAP + subcategory）
3. 消费方更新（category-schemas → unified-categories）
4. 建书流程改造（guided-setup 直建 SQLite）
5. 废弃标记

向后兼容：旧书 lazy migration（首次访问映射）；buildJingweiBrief/jingwei.write 兼容新旧值。

---

## 测试计划

| 类型 | 覆盖 |
|------|------|
| 单测 | 分类映射、题材→模板、createJingweiEntriesFromGuide、冲突检测 |
| 集成 | 建书端到端(无md无localhost)、buildJingweiBrief 统一分类后正常 |
| 迁移 | 幂等+不丢数据 |
| typecheck | 全量干净 |
