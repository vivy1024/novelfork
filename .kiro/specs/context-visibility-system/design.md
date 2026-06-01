# 上下文可见性系统 — Design

## 架构现状

经纬系统已有两套并存的实现：

| 层 | 实现 | 状态 |
|---|---|---|
| SQLite schema | `story_jingwei_entry.visibility_rule_json` + `aliases_json` + `related_entry_ids_json` | ✅ 字段已存在 |
| TypeScript 类型 | `JingweiVisibilityRule` (tracked/global/nested) + `visibleAfterChapter` | ✅ 已定义 |
| 上下文组装 | `buildJingweiContext()` — 按 visibility + chapter + sceneText + tokenBudget 过滤 | ✅ 已实现 |
| 工具层 | `jingwei.read_context` — 旧文件系统全量读取，无过滤 | ❌ 未接入新系统 |
| 前端 UI | 条目编辑表单 — 无 visibility/visibleAfterChapter 字段 | ❌ 未暴露 |
| ToolConfigBar | 前端 toggle — 未接通后端 session toolPolicy | ❌ 未接通 |

**核心工作**：不是从零实现，而是接通已有能力 + 补全 UI。

## 设计方案

### 1. jingwei.read_context 接入新系统

替换旧的文件系统读取器，改为调用 `buildJingweiContext()`：

```
jingwei.read_context(input: { bookId, categories?, chapterNumber?, sceneText? })
  → 调用 buildJingweiContext({ bookId, currentChapter, sceneText, tokenBudget: 8000 })
  → 返回 JingweiContextResult（含 items + totalTokens + droppedEntryIds）
```

### 2. candidate.create_chapter 注入经纬上下文

在 `CandidateToolService` 中，生成章节前自动调用 `buildJingweiContext`：

```
candidate.create_chapter(input)
  → 1. buildJingweiContext({ bookId, currentChapter: chapterNumber, tokenBudget: 6000 })
  → 2. 将 contextItems 格式化为 prompt section
  → 3. 注入到 system prompt 的 "世界观与设定" 段落
  → 4. 调用 LLM 生成
```

### 3. 前端条目编辑表单

在 `JingweiEntryForm` 中新增字段：

```
┌─────────────────────────────────────────┐
│ 标题: [林远                           ] │
│ 分类: [角色 ▼]                          │
│ 别名: [林师兄, 林大哥] [+ 添加]         │
│                                         │
│ ─── AI 上下文控制 ───                   │
│ 可见性: (●) tracked  ( ) global  ( ) nested │
│ 可见起始章节: [    ] (留空=始终可见)     │
│ 可见截止章节: [    ] (留空=永不过期)     │
│ 关联条目: [青云宗] [张三] [+ 添加]      │
│                                         │
│ 内容: [...]                             │
└─────────────────────────────────────────┘
```

### 4. 自动链接引擎

章节保存时批量扫描：

```
onChapterSave(bookId, chapterNumber, content)
  → 1. 加载所有 participatesInAi=true 的条目标题 + 别名
  → 2. 对 content 做字符串匹配（标题 + aliases）
  → 3. 写入 chapter_linked_entries 表（bookId, chapterNumber, entryId）
  → 4. 用于后续 tracked 模式的快速查询
```

### 5. ToolConfigBar 接通后端

```
前端 toggle 变化
  → PUT /api/sessions/:sessionId/tool-policy { deny: ["presets.get_rules"] }
  → session-tool-executor 执行前检查 toolPolicy.deny
  → 匹配到 → 返回 { ok: false, error: "tool-disabled-by-user" }
```

### 6. 图谱视图可见性标识

GraphCanvas 节点上显示可见性图标：
- 🌐 global（始终注入）
- 👁 tracked（场景匹配时注入）
- 🔗 nested（被关联时注入）
- 灰色节点 = `participatesInAi: false`

## 数据流

```
章节写作请求
  ↓
buildJingweiContext({ bookId, currentChapter: N, sceneText, tokenBudget })
  ↓
┌─ 1. 查询 global 条目 WHERE visibility='global' AND visibleAfter<=N AND (visibleUntil IS NULL OR visibleUntil>=N)
├─ 2. 查询 tracked 条目 WHERE visibility='tracked' AND (title/aliases 匹配 sceneText)
├─ 3. 递归查询 nested 条目 WHERE id IN (上述条目的 relatedEntryIds)，最多 2 层
├─ 4. 按优先级排序：global > tracked > nested
└─ 5. Token 裁剪：累加 estimatedTokens，超 budget 时丢弃低优先级
  ↓
JingweiContextResult { items, totalTokens, droppedEntryIds }
```

## 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 重写 | `novel-plugin/src/handlers/jingwei-read.ts` | 接入 buildJingweiContext |
| 修改 | `novel-plugin/src/handlers/candidate-tool-service.ts` | 注入经纬上下文 |
| 修改 | `novel-plugin/src/pages/writing-workbench/jingwei/JingweiEntryForm.tsx` | 添加 visibility 字段 |
| 新建 | `novel-plugin/src/engine/jingwei/auto-linker.ts` | 自动链接引擎 |
| 新建 | `novel-plugin/src/routes/chapter-links.ts` | 章节链接 API |
| 修改 | `studio/src/api/routes/sessions.ts` | PUT /api/sessions/:id/tool-policy |
| 修改 | `novel-plugin/src/pages/writing-workbench/ToolConfigBar.tsx` | 接通后端 |
| 修改 | `novel-plugin/src/pages/writing-workbench/JingweiGraphWorkspace.tsx` | 可见性图标 |

## 向后兼容

- 现有条目默认 `visibilityRule: { type: "tracked" }`，`participatesInAi: true`
- 旧的文件系统 jingwei 目录保留但不再被工具读取
- `buildJingweiContext` 已有 fallback：无 sceneText 时返回所有 global + 前 N 个 tracked
