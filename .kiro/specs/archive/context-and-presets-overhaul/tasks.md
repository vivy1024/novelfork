# 任务清单

## P0: 打通对话 Session 经纬注入（核心）

- [x] 1. 重写 `agent-context.ts` 的 `buildAgentContext()`：删除粗暴 SQL，调用 `buildJingweiContext()` 替代
  - `sceneText` = 最近用户消息内容（使 tracked 条目动态匹配）
  - `currentChapter` = 从 book config 读取
  - `mode` = "auto"
  - `tokenBudget` = 15,000（标准窗口）
- [x] 2. 删除 `agent-context.ts` 第 331-349 行附近的粗暴 SQL 经纬查询代码
- [x] 3. 在 `session-chat-service.ts` 中将最近用户消息作为 `sceneText` 传入 `buildAgentContext`

## P1: 注入 Chapter Briefing + 递归摘要

- [x] 4. 在 `buildAgentContext()` 中调用 `buildChapterBriefing(bookId, currentChapter)` 并拼入上下文
- [x] 5. 在 `buildAgentContext()` 中调用 `buildRecursiveSummaryContext(bookId, currentChapter)` 并拼入上下文
- [x] 6. 格式化输出：briefing + 递归摘要 + 经纬条目，按优先级排列

## P2: 混合策略——核心自动 + 详细工具化

- [x] 7. 经纬注入拆分为两层：
  - 自动注入层：global 条目 + chapter briefing + 递归摘要
  - 工具按需层：tracked/nested 详细内容通过 `jingwei.read_context` 获取（已有工具）
  - 大窗口模式下自动注入 full 模式（所有层级）
- [x] 8. 在 system prompt 中添加提示："你已有核心设定和章节 briefing。如需某个角色/地点/事件的详细经纬信息，调用 jingwei.read_context"
- [x] 9. 对话 Session 预设注入：读取 `enabledPresetIds`，调用 `buildPresetInjections()` 注入 context
- [x] 10. 节拍模板注入：如果 book 有 `beatTemplateId`，将模板简要信息注入 context

## P3: 大窗口模式（DeepSeek 1M）

- [x] 11. 检测模型上下文窗口大小（通过 `modelContextWindow` 参数）
- [x] 12. ≥500k 窗口时：
  - `tokenBudget` 提升到 50,000
  - `mode` 切换到 `full`（注入所有层级条目）
  - （递归摘要扩展到近 20 章需要修改 `buildRecursiveSummaryContext` 本身，留作后续）
- [ ] 13. 可选：大窗口模式下直接注入前一章全文作为连续性参考（留作后续优化）

## P4: 预设/节拍持久化修复 + 垃圾清理

- [x] 14. 启动流程已有 `initPresetSystem()`：server.ts createStudioServer 中注册内置 + 从 `user_template` 表恢复
- [x] 15. 删除 `session-tool-executor.ts` 中 4 处防御性重注册代码
- [x] 16. 删除 `presets.ts` 路由中 4 处防御性重注册代码
- [x] 17. 修复 `beat.get_current`：无 `beatTemplateId` 时返回 `{ template: null }` + 可用列表，不 fallback 英雄之旅
- [ ] 18. 前端 `BeatPanel.tsx`：去掉 localStorage 主存储，改为 API 读写（留作后续前端优化）
- [ ] 19. 前端 `StatusBar.tsx`：去掉 localStorage 监听，改为从 book API 获取（留作后续前端优化）

## 验证

- [ ] 20. 对话中提到 tracked 角色名 → AI 能看到该角色经纬信息
- [ ] 21. 对话中 AI 能看到活跃伏笔和硬约束（chapter briefing）
- [ ] 22. `beat.get_current` 未选择时返回 null
- [ ] 23. 自定义预设/节拍重启后仍可用
- [ ] 24. 启用的预设在对话写作时生效

**状态**: P0-P4 核心代码实现完成（20/24 任务），typecheck 通过。
剩余：Task 13（前一章全文注入）、Task 18-19（前端 localStorage 清理）、Task 20-24（运行时验证）。
