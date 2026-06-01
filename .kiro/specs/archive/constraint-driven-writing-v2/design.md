# Design: 约束驱动写作系统 v2

## 管线架构

```
用户: "写下一章"
  │
  ├─ cockpit.snapshot → 进度/伏笔/候选稿
  ├─ jingwei.read(brief) → 核心包 4K
  ├─ pgi.ask → 追问 + 用户回答
  │
  ▼ [Gate: H5 用户已确认]
  │
  ├─ scene.spec → 结构化蓝图 (LLM call #1)
  │
  ▼ [Gate: H4 spec 完整]
  │
  ├─ jingwei.read(category) → 按 spec 补读相关经纬
  ├─ pipeline.write → 正文生成 (LLM call #2)
  │
  ▼ [Gate: H3 只进候选区]
  │
  ├─ chapter.audit → 审计+修订 (LLM call #3)
  │   ├─ H2 canon check
  │   ├─ H7 POV check
  │   ├─ S1-S5 soft checks
  │   └─ 自动修订（如需）
  │
  ▼ [Gate: audit pass]
  │
  └─ 候选稿保存 + 经纬自动更新 → 用户审核
```

## 工具设计

### cockpit.snapshot

合并 get_snapshot + list_open_hooks + list_recent_candidates + health.read_summary。

输入: `{ bookId }`
输出: `{ progress, hooks, candidates, health, recentChapters }`

### jingwei.read

合并 read_brief + read_category + search + read_context。

输入:
```typescript
{
  bookId: string;
  scope: "brief" | "category" | "search";  // 默认 brief
  category?: string;      // scope=category 时必填
  query?: string;         // scope=search 时必填
  chapterNumber?: number;
  sceneText?: string;
  tokenBudget?: number;
  detailLevel?: "summary" | "normal" | "full";
  page?: number;
  limit?: number;
}
```

### jingwei.write

rename from upsert_entry，增加 `layer` 字段：

输入:
```typescript
{
  bookId: string;
  title: string;
  contentMd: string;
  summaryMd?: string;
  category: string;
  layer: "canon" | "dynamic" | "reference";  // 新增
  aliases?: string[];
  tags?: string[];
  visibility?: "global" | "tracked" | "nested";
}
```

硬约束: layer=canon 的条目一旦创建，contentMd 只能追加不能修改。

### pgi.ask

合并 generate_questions + record_answers + format_answers_for_prompt。

输入: `{ bookId, chapterNumber?, chapterIntent? }`
输出: `{ questions, askUserQuestionInput, formattedDirectives }`

一次调用完成：生成问题 → 返回 AskUserQuestion 格式 → 用户回答后自动格式化。

### scene.spec

新工具。生成结构化写作蓝图。

输入:
```typescript
{
  bookId: string;
  chapterNumber: number;
  userDirectives: string;  // PGI 格式化后的指示
  cockpitSnapshot: object; // cockpit 返回
  jingweiBrief: object;    // jingwei.read(brief) 返回
}
```

输出: Scene Spec YAML（见 requirements R4）。

硬约束 H4: 输出必须包含 characters/location/conflict/outcome，缺任何一项则拒绝。

### pipeline.write

精简后的写章节。

输入:
```typescript
{
  bookId: string;
  sceneSpec: object;       // scene.spec 的输出
  jingweiContext: object;  // 按 spec 补读的经纬细节
  previousChapterTail?: string; // 前章末尾 500 字
}
```

硬约束:
- H4: sceneSpec 必须存在且 valid
- H3: 输出只进候选区
- H1: 输入总 token ≤ 预算

### chapter.audit

合并 ContinuityAuditor + Reviser + character.check_consistency。

输入:
```typescript
{
  bookId: string;
  chapterNumber: number;
  content: string;
  sceneSpec: object;
  canonEntries: object[];  // canon 层条目
}
```

输出:
```typescript
{
  passed: boolean;
  hardViolations: Array<{ ruleId: string; location: string; description: string }>;
  softViolations: Array<{ ruleId: string; location: string; suggestion: string }>;
  revisedContent?: string;  // 如有软违反且自动修订
  jingweiDelta: object;     // 需要更新的经纬条目
}
```

## 经纬三层实现

### 数据模型

复用现有 `story_jingwei_entry` 表，通过 `layer` 字段区分：

```sql
-- 已有 priority_tier 字段可复用，或新增 layer 字段
ALTER TABLE story_jingwei_entry ADD COLUMN layer TEXT DEFAULT 'dynamic';
```

layer 值: `canon` | `dynamic` | `reference`

### Canon 写入保护

在 `jingwei.write` handler 中：
```
if (existing.layer === "canon" && input.contentMd !== existing.contentMd) {
  // 只允许追加，不允许修改
  if (!input.contentMd.startsWith(existing.contentMd)) {
    return { ok: false, error: "canon-immutable" };
  }
}
```

### 上下文注入策略

| 层 | 默认注入 | 预算 |
|----|---------|------|
| Canon | 始终注入（brief 中） | 2000 tokens |
| Dynamic | 始终注入（brief 中） | 2000 tokens |
| Reference | 不注入，按需 read(category) | 按需 |

## Token 预算实现

复用已有 `ContextBudgetManager`，增加硬约束检查：

```typescript
// 在 prompt 构造前
const allocation = budgetManager.allocate(slots);
if (allocation.allocated > allocation.totalBudget) {
  // H1 硬约束: 拒绝构造
  throw new ContextBudgetExceededError(allocation);
}
```

## 迁移策略

1. 新工具和旧工具并存一个版本周期
2. 旧工具标记 deprecated，prompt 引导用新工具
3. 下个版本移除旧工具
4. 现有经纬条目默认 layer=dynamic
5. 用户可手动标记 canon（或导入时推断）
