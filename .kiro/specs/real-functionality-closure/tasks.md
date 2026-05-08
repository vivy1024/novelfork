# Implementation Plan — 真实功能闭环

## Overview

本任务清单基于 2026-05-08 前端功能校验 + NarraFork 对标结果。

**NarraFork 对话界面核心特征（localhost:7778）：**
- 工具调用：绿色图标 + 工具名 + 耗时 badge（✓ 846ms），一行紧凑卡片
- AI 回复：markdown 渲染（列表、粗体、代码块）
- 输入区：附件📎 + 输入框 + 模型选择器（kiro:Opus 4.6）+ 权限模式（🔒全部允许）+ 中断按钮
- 状态指示：`思考中 4:51` 实时计时
- 顶部工具栏：搜索、剪刀、书签、图片、文件、时钟、设置
- 底部状态栏：`novelfork · master` + git 分支 + 操作图标

**NovelFork 当前对话界面：**
- 纯文本 debug 视图，操作栏是文字链接堆砌，输入框是裸 textarea

**核心原则：**
1. 对标 NarraFork 的对话 UI 质量
2. 每个任务完成后 Browser E2E 验证
3. 设置页的小功能（模型选择、权限切换）直接集成到对话输入区（和 NarraFork 一样）

---

## Tasks

### Phase 0：对话页面对标 NarraFork（最高优先级）

- [ ] 1. 输入区重构：对标 NarraFork Composer
  - 左侧：附件图标
  - 中间：自动扩展输入框（placeholder "发送消息..."）
  - 右侧一行：模型选择器下拉 + 权限模式 badge + 中断/发送按钮
  - Enter 发送 / Shift+Enter 换行
  - 输入 `/` 弹出 slash command 建议列表
  - 验证：Browser 中输入区和 NarraFork 视觉一致

- [ ] 2. 工具调用紧凑卡片
  - 一行显示：绿色✓图标 + 工具名 + 耗时 badge（如 "✓ 846ms"）
  - 点击可展开查看输入/输出详情
  - 失败时红色✗图标
  - 验证：对话中工具调用显示为紧凑一行

- [ ] 3. AI 回复 Markdown 渲染
  - 支持标题、列表、粗体、斜体、链接、代码块
  - 代码块有语法高亮 + 复制按钮
  - 验证：AI 回复包含 markdown 时正确渲染

- [ ] 4. Streaming + 思考中状态
  - AI 回复时底部显示 "思考中 X:XX" 实时计时
  - 流式文本逐步显示
  - 中断按钮变为红色可点击
  - 验证：发送消息后看到思考计时和流式输出

- [ ] 5. 顶部工具栏
  - 叙述者名称（可编辑）+ 操作图标
  - 右侧：搜索、设置等图标按钮
  - 验证：顶部是紧凑的工具栏

- [ ] 6. 确认门交互卡片
  - pending-confirmation 显示为卡片（工具名 + 目标 + 风险）
  - "批准"/"拒绝"按钮
  - 验证：触发确认门时看到交互卡片

- [ ] 7. 底部状态栏
  - 显示当前 session 信息 + git 分支（如果有 worktree）
  - 操作图标：复制、分叉、设置
  - 验证：底部有状态栏

### Phase A：设置页编辑控件

- [ ] 8. ModelsSection 添加模型选择器
  - defaultSessionModel 下拉（从 /api/providers/models 读取）
  - summaryModel 下拉
  - 保存按钮
  - 验证：可以选择模型并保存

- [ ] 9. RuntimeControlPanel 添加编辑表单
  - permissionMode select
  - maxTurnSteps number input
  - reasoningEffort select
  - 保存按钮
  - 验证：可以修改并保存

### Phase B：Novel 命令真实执行

- [ ] 10. 接入 executeNovelCommand handler
  - slash-command-registry 传入 executeNovelCommand
  - 调用 workflow-executor
  - 验证：/novel:write-next 不返回 unhandled_command

- [ ] 11. Workflow step executor 真实步骤
  - context-load → cockpit.get_snapshot
  - pgi → pgi.generate_questions
  - guided-plan → approval-pending
  - writer-generate → LLM 候选稿
  - 验证：workflow 执行到 approval-pending 暂停

- [ ] 12. Workflow 结果接入消息流
  - 每步结果广播到 WebSocket
  - 显示为工具调用紧凑卡片
  - 验证：叙述者看到 workflow 进度

### Phase C：基础设施

- [ ] 13. 重新 build 前端 dist
  - 验证：所有源码改动在 Browser 中可见

- [ ] 14. autoCompact 真实摘要
  - 用 summaryModel 调 LLM
  - 验证：compact 后摘要有意义

- [ ] 15. model reference 友好化
  - 支持 providerName:modelId
  - 验证：`vivy-free:gpt-5.4-mini` 能解析

### Phase D：E2E 验证

- [ ] 16. 创建会话 → 发送消息 → AI 回复
  - 验证 streaming + markdown 渲染

- [ ] 17. /novel:write-next 完整流程
  - 验证 workflow 步骤 + approval 暂停

- [ ] 18. 设置修改 → 对话行为变化
  - 修改模型 → 新会话使用新模型
  - 修改权限 → 工具确认门变化
