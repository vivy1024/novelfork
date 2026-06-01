# 上下文注入与预设/节拍系统整改

**版本**: v1.0.0
**创建日期**: 2026-05-20
**状态**: draft

---

## 背景

当前存在两个核心问题：

1. **对话 Session 的经纬注入是阉割版** — `agent-context.ts` 用粗暴 SQL 取 10 条，而 `novel-plugin/engine/jingwei/context/` 下已有完整的 global/tracked/nested + 时间轴 + 优先级 + token 预算系统，但只在 Pipeline 写章时使用，对话模式完全没接入。

2. **预设和节拍系统持久化混乱** — 节拍选择存 localStorage（前端）+ book.json（后端），自定义预设/节拍存 user_template 表但内存 store 重启即丢失，`beat.get_current` 在无选择时 fallback 到 `allTemplates[0]`（即英雄之旅），给用户造成"默认选了英雄之旅"的错觉。

---

## 问题 1：对话 Session 经纬注入

### 现状

| 路径 | 使用的注入方式 | 质量 |
|------|------|------|
| Pipeline 写章 (`runner.ts`) | `buildBibleContext()` + `buildChapterBriefing()` + `buildRecursiveSummaryContext()` | 完整 |
| 对话 Session (`agent-context.ts`) | 粗暴 SQL: `WHERE participates_in_ai = 1 LIMIT 10` | 极差 |

### 已有但未接入的能力

| 能力 | 文件 | 状态 |
|------|------|------|
| global/tracked/nested 三种可见性 | `build-jingwei-context.ts` | 已实现，未接入对话 |
| `visible_after_chapter` / `visible_until_chapter` | `visibility-filter.ts` | 已实现，未接入对话 |
| 关键词触发 tracked 注入 | `build-jingwei-context.ts` `matchesTracked()` | 已实现，未接入对话 |
| 嵌套解析（3 层） | `build-jingwei-context.ts` `resolveNestedEntries()` | 已实现，未接入对话 |
| 优先级分层 core/relevant/reference | `context-policy.ts` | 已实现，未接入对话 |
| Token 预算控制 | `token-budget.ts` | 已实现，未接入对话 |
| 卷级递归摘要 | `recursive-summaries.ts` | 已实现，未接入对话 |
| 章节 Briefing（活跃角色/伏笔/硬约束） | `chapter-briefing.ts` | 已实现，未接入对话 |
| 因果链追踪 | `causal-chains.ts` | 已实现，未接入对话 |
| Lorebook 关键词检索 | `lorebook-retriever.ts` (core) | 已实现，未接入对话 |

### 需求

**R1.1** 对话 Session 绑定 book 时，`agent-context.ts` 的 `buildAgentContext()` 必须调用 `buildJingweiContext()` 替代当前的粗暴 SQL。

**R1.2** `sceneText` 参数使用最近一条用户消息内容，使 tracked 条目能根据对话内容动态匹配。

**R1.3** `currentChapter` 从 book config 读取，确保时间轴可见性生效。

**R1.4** 注入 `buildChapterBriefing()` 的结果（活跃角色、未解决事项、活跃伏笔、硬约束）。

**R1.5** 注入 `buildRecursiveSummaryContext()` 的结果（卷摘要 + 近 5 章摘要）。

**R1.6** Token 预算根据模型上下文窗口动态调整：
- 200k 窗口：默认 15,000 tokens
- 1M 窗口：默认 50,000 tokens
- 用户可在设置中覆盖

**R1.7** 删除 `agent-context.ts` 中的粗暴 SQL 查询代码（`SELECT ... FROM story_jingwei_entry WHERE ... participates_in_ai = 1 ... LIMIT 10`）。

**R1.8** 混合策略——核心自动注入 + 详细工具化按需获取：
- 自动注入：global 条目 + chapter briefing + 递归摘要（~5000-8000 tokens）
- 工具按需：tracked/nested 的详细内容通过 `jingwei.read_context` 工具获取
- 在 system prompt 中明确告知 LLM："你已有核心设定和章节 briefing，如需某个角色/地点/事件的详细经纬信息，调用 jingwei.read_context"

**R1.9** 大窗口模式（DeepSeek 1M 等）：
- 检测到模型支持 ≥500k 上下文时自动切换
- `tokenBudget` 从 15,000 提升到 50,000-80,000
- `mode` 从 `auto` 切换到 `full`（注入所有层级条目）
- `buildRecursiveSummaryContext` 从"近 5 章"扩展到"近 20 章"
- 可直接注入前一章全文作为连续性参考

---

## 问题 2：预设系统持久化

### 现状

| 操作 | 持久化位置 | 问题 |
|------|------|------|
| 启用/禁用内置预设 | `book.json` → `enabledPresetIds` | 正常 |
| 创建自定义预设 | `user_template` 表 + 内存 `presetStore` | 重启后内存丢失，`getPreset(id)` 找不到 |
| 预设 prompt 注入到写作 | `writer-prompts.ts` `buildPresetInjections()` | 只在 Pipeline 用，对话模式不注入 |

### 需求

**R2.1** 应用启动时，从 `user_template` 表加载所有 `type=preset` 的记录，注册到内存 `presetStore`。

**R2.2** 对话 Session 绑定 book 时，读取 `enabledPresetIds`，将对应预设的 `promptInjection` 注入到 system prompt 或 context 中。

**R2.3** 删除 `presets.get_rules` handler 中的"防御性重注册"hack（`if (listPresets().length === 0) { registerBuiltinPresets() }`），改为启动时一次性注册。

---

## 问题 3：节拍系统持久化与默认值

### 现状

| 操作 | 持久化位置 | 问题 |
|------|------|------|
| 前端选择节拍模板 | `localStorage` + `PUT /api/books/:id/beat-template` | localStorage 是浏览器级，换设备丢失 |
| `beat.get_current` 无选择时 | fallback 到 `allTemplates[0]` | 即英雄之旅，用户没选过也显示有 |
| 创建自定义节拍 | `user_template` 表 + 内存 `beatStore` | 重启后内存丢失 |

### 需求

**R3.1** `beat.get_current` 在 `beatTemplateId` 为空时，返回 `{ template: null }` 而非 fallback 到第一个模板。明确告知"当前未选择节拍模板"。

**R3.2** 前端 `BeatPanel` 去掉 localStorage 作为主存储，改为以后端 `book.json` 的 `beatTemplateId` 为唯一真相源。localStorage 仅作为缓存加速首屏。

**R3.3** 应用启动时，从 `user_template` 表加载所有 `type=beat-template` 的记录，注册到内存 `beatStore`。

**R3.4** 节拍模板选择持久化到 `book.json`（已有 `beatTemplateId` 字段），前端通过 API 读写，不依赖 localStorage。

---

## 问题 4：垃圾代码清理

### 需要删除的代码

**R4.1** `agent-context.ts` 中的粗暴 SQL 经纬查询（第 331-349 行附近）— 被 R1.1 的 `buildJingweiContext()` 调用替代。

**R4.2** `session-tool-executor.ts` 中所有"防御性重注册"代码块：
```typescript
if (listPresets().length === 0) { try { registerBuiltinPresets(); } catch { /* ignore */ } }
if (listBeatTemplates().length === 0) { try { registerBuiltinPresets(); } catch { /* ignore */ } }
```
共出现 4 处。启动时统一注册后不再需要。

**R4.3** `presets.ts` 路由中的防御性重注册（第 26、43、48、63 行）— 同理。

**R4.4** `BeatPanel.tsx` 中的 localStorage 读写逻辑（`loadBeatStore` / `saveBeatStore`）— 改为 API 调用。

**R4.5** `StatusBar.tsx` 中的 `useBeatProgress` hook 里的 localStorage 监听逻辑 — 改为从 API 或 props 获取。

---

## 问题 5：对话模式预设注入

### 现状

对话模式（session-chat-service）的 system prompt 组成：
```
agentSystemPrompt + AGENT_NATIVE_WRITE_NEXT_INSTRUCTIONS + goals + routines
```

**没有预设注入。** 用户启用了"悲苦孤独"文风预设，但对话中 AI 写东西时完全不知道。

### 需求

**R5.1** 对话 Session 绑定 book 时，读取 `enabledPresetIds`，调用 `buildPresetInjections()` 生成预设 prompt 段，注入到 context 中（与经纬上下文一起）。

**R5.2** 如果当前 book 有 `beatTemplateId`，将节拍模板信息也注入到 context 中，格式为简要参考（模板名 + 各节拍名称列表），不需要完整 prompt。

---

## 验收标准

1. 对话中讨论某个角色时，如果该角色是 tracked 条目且出现在用户消息中，AI 能看到该角色的经纬信息
2. 对话中 AI 能看到活跃伏笔和硬约束（chapter briefing）
3. 用户启用的预设规则在对话写作时生效
4. `beat.get_current` 在未选择时返回 null，不默认英雄之旅
5. 自定义预设/节拍重启后仍然可用
6. 前端节拍面板不依赖 localStorage 作为真相源
7. 所有防御性重注册代码被删除，启动时统一注册一次

---

## 不做

- 不改变 Pipeline 写章的经纬注入逻辑（已经是完整版）
- 不改变经纬条目的数据结构
- 不新增 UI 页面
- 不改变预设的 prompt 内容本身
