# 经纬类型统一 v1

## 概述

当前 `packages/core/src/jingwei/` 目录下并存两套 API：
- **旧 Bible API**：`buildBibleContext`、`BibleCharacterRecord` 等（从 `bible/` 迁移来，操作 `bible_*` 表）
- **新 Jingwei API**：`buildJingweiContext`、`JingweiContextItem` 等（原生实现，操作 `jingwei_entry` + `jingwei_section` 表）

两套类型字段结构不同，不能简单 sed 替换。需要逐步统一。

## 目标

1. 统一为一套 Jingwei API，废弃 Bible 命名
2. SQL 表名保持 `bible_*` 不变（通过 repository 层屏蔽）
3. 外部消费者（studio）无感迁移

## 当前两套类型对比

### 旧 Bible 类型（来自管线/Agent 使用）

```typescript
interface BibleContextItem {
  id: string;
  type: BibleContextItemType; // "character" | "event" | "setting" | ...
  name: string;
  content: string;
  source: BibleContextSource; // "global" | "tracked" | "nested"
  priority: number;
  estimatedTokens: number;
}
```

### 新 Jingwei 类型（来自前端资源树使用）

```typescript
interface JingweiContextItem {
  id: string;
  entryId: string;
  sectionId: string;
  sectionKey: string;
  sectionName: string;
  title: string;
  text: string;
  source: JingweiContextSource; // "global" | "tracked" | "nested"
  priority: number;
  estimatedTokens: number;
}
```

### 差异

| 字段 | Bible | Jingwei | 说明 |
|------|-------|---------|------|
| type/sectionKey | `type: "character"` | `sectionKey: "characters"` | 语义相同，命名不同 |
| name/title | `name` | `title` | 同义 |
| content/text | `content` | `text` | 同义 |
| entryId | 无 | 有 | Jingwei 多了条目 ID |
| sectionId | 无 | 有 | Jingwei 多了分区 ID |
| sectionName | 无 | 有 | Jingwei 多了分区显示名 |

## 统一策略

### Phase 1：类型合并

新建统一类型 `JingweiContextItem`，包含两套的所有字段（旧字段标 optional deprecated）：

```typescript
interface JingweiContextItem {
  id: string;
  entryId?: string;
  sectionId?: string;
  sectionKey: string;      // 替代旧 type
  sectionName?: string;
  title: string;           // 替代旧 name
  text: string;            // 替代旧 content
  source: "global" | "tracked" | "nested";
  priority: number;
  estimatedTokens: number;
  // deprecated aliases
  /** @deprecated use sectionKey */ type?: string;
  /** @deprecated use title */ name?: string;
  /** @deprecated use text */ content?: string;
}
```

### Phase 2：Repository 层统一

所有 `createBible*Repository` 改名为 `createJingwei*Repository`，内部仍查 `bible_*` 表。

### Phase 3：函数名替换

- `buildBibleContext` → `buildJingweiContext`（合并两个实现为一个）
- `composeBibleContext` → `composeJingweiContext`
- `formatBibleContextForPrompt` → `formatJingweiContextForPrompt`
- 等等

### Phase 4：清理

- 删除 `bible/` 兼容层
- 删除旧类型定义
- 更新所有 import

## 影响范围

- `packages/core/src/jingwei/` — 类型定义 + 所有 context/repository 文件
- `packages/core/src/agents/` — 所有 Agent 引用 Bible 类型
- `packages/core/src/pipeline/runner.ts` — 管线调用
- `packages/studio/src/api/routes/` — API 路由引用
- `packages/studio/src/app-next/` — 前端引用
- 测试文件 — 54 个

## 前置条件

- v0.1.0 已发布（不在发布前做破坏性重构）
- 两套 API 当前无 bug（typecheck 通过）

## 优先级

v0.2.0 — 发布后第一个重构任务
