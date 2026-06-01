# 上下文可见性系统 — Requirements

## 背景

NovelCrafter Codex 的三种可见性（tracked/global/nested）+ 时间线纪律（visible_after_chapter）是业界动态 Bible 的最佳实践。NovelFork 的经纬系统已有 16 分类结构化数据，但缺少**上下文注入控制**——AI 写作时不知道哪些条目该注入、哪些该隐藏。

当前问题：
- Agent 写作时要么注入全部经纬（token 爆炸），要么不注入（AI 不知道设定）
- 没有防剧透机制——第 1 章就能看到第 50 章才揭示的真相
- 没有自动链接——文本提到角色名时不会自动关联经纬条目
- ToolConfigBar 的工具 toggle 没有接通后端 session 工具过滤

## 用户故事

### US-1: 条目可见性分级
作为作者，我希望给每个经纬条目设置可见性级别（tracked/global/nested），这样 AI 写作时只注入相关条目，不会 token 爆炸。

### US-2: 时间线纪律
作为作者，我希望给条目设置 `visibleAfterChapter`，这样 AI 写第 5 章时看不到第 20 章才揭示的反派真实身份。

### US-3: 自动链接
作为作者，当我写的文本中提到"林远"时，系统自动识别并关联到"林远"的经纬条目，AI 下次写作时自动注入该条目。

### US-4: 场景级上下文组装
作为 Agent，当我执行 `candidate.create_chapter` 生成第 N 章时，系统自动组装上下文：global 条目 + 当前章节文本中 tracked 到的条目 + nested 关联条目，且只包含 `visibleAfterChapter <= N` 的条目。

### US-5: 工具配置生效
作为作者，当我在 ToolConfigBar 中取消勾选"预设"工具时，Agent 在本次会话中确实无法调用 `presets.get_rules`。

## 功能需求

### FR-1: 条目可见性字段
- 每个经纬条目新增 `visibility` 字段：`"tracked"` | `"global"` | `"nested"`
- 默认值：`"tracked"`
- UI：条目编辑表单中添加可见性下拉选择
- API：`PUT /api/books/:bookId/jingwei/:entryId` 支持更新 visibility

### FR-2: 时间线纪律字段
- 每个经纬条目新增 `visibleAfterChapter` 字段：`number | null`
- `null` 表示始终可见（等同于第 0 章起可见）
- UI：条目编辑表单中添加"可见起始章节"数字输入
- API：同 FR-1

### FR-3: Nested 关联
- 条目可以声明 `nestedEntryIds: string[]`——引用该条目时自动带入关联条目
- 典型场景：引用"青云宗"时自动带入"宗主张三"、"内门弟子规则"
- UI：条目编辑表单中添加"关联条目"多选
- 关联深度限制：最多 2 层，防止递归爆炸

### FR-4: 自动链接引擎
- 写作完成后（章节保存时），扫描章节文本中出现的条目名称
- 匹配到的条目记录到 `chapter_linked_entries` 表
- 支持别名匹配（条目可设置 `aliases: string[]`）
- 不实时扫描（性能考虑），在章节保存/审计时批量执行

### FR-5: 上下文组装服务
- 新增 `ContextAssembler` 服务，输入：`{ bookId, chapterNumber, sceneText? }`
- 输出：按优先级排序的条目列表 + 总 token 估算
- 组装规则：
  1. 所有 `visibility === "global"` 且 `visibleAfterChapter <= chapterNumber` 的条目
  2. 所有 `visibility === "tracked"` 且名称/别名出现在 sceneText 中 且 `visibleAfterChapter <= chapterNumber` 的条目
  3. 上述条目的 `nestedEntryIds` 关联条目（递归最多 2 层）
  4. Token 预算控制：超过阈值时按优先级截断（global > tracked > nested）
- 集成到 `candidate.create_chapter` 和 `jingwei.read_context` 工具

### FR-6: ToolConfigBar 接通后端
- ToolConfigBar 的 toggle 状态通过 WebSocket 或 API 同步到 session 的 `toolPolicy`
- session-tool-executor 在执行工具前检查 session 的 toolPolicy
- 被禁用的工具返回 `{ ok: false, error: "tool-disabled-by-user" }`

### FR-7: 可见性批量管理
- 经纬面板中支持批量设置可见性（多选条目 → 统一设置 visibility/visibleAfterChapter）
- 图谱视图中用颜色/图标区分 global（🌐）/ tracked（👁）/ nested（🔗）

## 非功能需求

### NFR-1: 性能
- 上下文组装 < 100ms（100 条目规模）
- 自动链接扫描 < 500ms/章（5000 字）

### NFR-2: 向后兼容
- 现有条目默认 `visibility: "tracked"`, `visibleAfterChapter: null`
- 不需要数据迁移，新字段为可选

### NFR-3: Token 预算
- 默认上下文预算：8000 tokens（可配置）
- 超预算时优先保留 global，然后按相关性排序 tracked

## 验收标准

1. 经纬条目编辑表单中可以设置 visibility 和 visibleAfterChapter
2. Agent 写第 5 章时，`visibleAfterChapter: 20` 的条目不出现在上下文中
3. 文本中提到"林远"时，下次写作自动注入林远的条目
4. ToolConfigBar 取消勾选工具后，Agent 调用该工具返回错误
5. 图谱视图中能区分三种可见性类型
