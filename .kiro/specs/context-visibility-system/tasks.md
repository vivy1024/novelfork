# 上下文可见性系统 — Tasks

## Overview

接通经纬系统已有的可见性过滤能力（schema + buildJingweiContext 已就绪），补全前端 UI 和工具层集成。

## Tasks

### Phase 1：工具层接通（jingwei.read_context + candidate 注入）

- [x] 1. 重写 `jingwei-read.ts`：替换文件系统全量读取，改为调用 `buildJingweiContext()`。输入增加 `chapterNumber?` 和 `sceneText?` 参数。返回 `JingweiContextResult`（items + totalTokens + droppedEntryIds）。验证：curl 调用返回按 visibility 过滤后的条目。
- [x] 2. 修改 `candidate-tool-service.ts`：在 `generateContent` 前调用 `buildJingweiContext({ bookId, currentChapter, tokenBudget: 6000 })`，将结果格式化为 `## 世界观与设定\n{items.map(i => i.text).join('\n')}` 注入 system prompt。验证：生成章节时 prompt 中包含经纬条目。
- [x] 3. 更新 `tool-schemas.ts` 中 `jingwei.read_context` 的 inputSchema：新增 `chapterNumber`（number, optional）和 `sceneText`（string, optional）参数。

### Phase 2：前端条目编辑表单

- [x] 4. 在 `JingweiEntryForm.tsx` 中添加"AI 上下文控制"区域：可见性 RadioGroup（tracked/global/nested）+ 可见起始章节 NumberInput + 可见截止章节 NumberInput。数据绑定到 `visibilityRule` 字段。
- [x] 5. 在 `JingweiEntryForm.tsx` 中添加"别名"字段：TagInput 组件，支持添加/删除别名。数据绑定到 `aliases` 字段。
- [x] 6. 在 `JingweiEntryForm.tsx` 中添加"关联条目"字段：多选下拉（从同书其他条目中选择）。数据绑定到 `relatedEntryIds` 字段。当 visibility=nested 时高亮显示此字段。
- [x] 7. 确保条目保存 API（PUT /api/books/:bookId/jingwei/entries/:entryId）正确持久化 visibilityRule、aliases、relatedEntryIds。验证：保存后重新加载，字段值保持。

### Phase 3：自动链接引擎

- [x] 8. 新建 `novel-plugin/src/engine/jingwei/auto-linker.ts`：实现 `linkChapterToEntries(bookId, chapterNumber, content, entries)` 函数。扫描 content 中出现的条目标题和别名，返回匹配到的 entryId 列表。
- [x] 9. 新建 `novel-plugin/src/routes/chapter-links.ts`：`POST /api/books/:bookId/chapters/:ch/link` 触发自动链接扫描，结果写入 `chapter_linked_entries` 表。`GET /api/books/:bookId/chapters/:ch/links` 返回该章关联的条目列表。
- [x] 10. 在章节保存流程中自动触发链接扫描：修改章节保存 API，保存成功后异步调用 `linkChapterToEntries`。不阻塞保存响应。

### Phase 4：ToolConfigBar 接通后端

- [x] 11. 新增 API：`PUT /api/sessions/:sessionId/tool-policy`，接收 `{ allow?: string[], deny?: string[] }` 并更新 session 的 toolPolicy。
- [x] 12. 修改 `ToolConfigBar.tsx`：toggle 变化时调用 `PUT /api/sessions/:sessionId/tool-policy`，将未勾选的工具加入 deny 列表。
- [x] 13. 验证：在 ToolConfigBar 中取消勾选"预设"，然后让 Agent 调用 `presets.get_rules`，确认返回 `{ ok: false, error: "tool-disabled-by-user" }`。

### Phase 5：图谱视图可见性标识

- [x] 14. 修改 `JingweiGraphWorkspace.tsx` 中的节点渲染：根据条目的 `visibilityRule.type` 显示图标（🌐/👁/🔗）。`participatesInAi: false` 的节点显示为灰色半透明。
- [x] 15. 在图谱工具栏添加"按可见性筛选"下拉：可选择只显示 global / tracked / nested / 全部。

### Phase 6：批量管理 + 验证

- [x] 16. 经纬列表视图中添加多选 checkbox + 批量操作栏：选中多个条目后可统一设置 visibility 和 visibleAfterChapter。
- [ ] 17. 端到端验证：创建 3 个条目（1 global + 1 tracked + 1 nested），写第 5 章时验证 global 始终出现、tracked 只在文本匹配时出现、nested 只在关联条目被注入时出现。visibleAfterChapter=10 的条目在第 5 章不出现。
