# Implementation Plan — 真实功能闭环

## Overview

基于 NarraFork (localhost:7778) 实际 UI 审计，NovelFork 的核心缺口：

1. **设置页是只读 FactRow**：NarraFork 用下拉选择器 + 数字输入 + toggle 开关，NovelFork 只有文本展示
2. **对话页面是 debug 视图**：NarraFork 有紧凑工具卡片 + markdown + streaming 计时 + 输入区集成模型/权限选择器
3. **Novel 命令不可执行**：executeNovelCommand 从未被提供

**关键理解：**
- 设置页 = 全局默认值（下拉/输入/toggle）
- 对话区模型/权限选择器 = 当前会话覆盖（覆盖全局默认）
- 两者是不同层级，都需要实现

**NarraFork 设置页 API：** `GET /api/settings` 返回完整配置（agent.defaultModel、agent.defaultPermissionMode、agent.maxTurns、agent.summaryModel、agent.subagentModels 等），`PUT /api/settings` 保存修改。NovelFork 已有等价的 `GET/PUT /api/settings/user`。

---

## Tasks

### Phase 0：设置页从只读变为可编辑（对标 NarraFork /settings/models + /settings/agent）

- [ ] 1. ModelsSection 改为可编辑表单
  - 默认模型：下拉选择器（从 /api/providers/models/grouped 读取可用模型列表，格式 "providerId:modelId"）
  - 摘要模型：同上
  - Explore 子代理模型：下拉（含"继承父级"选项）
  - Plan 子代理模型：下拉（含"继承父级"选项）
  - 全局默认推理强度：下拉（none/low/medium/high/xhigh）
  - 保存按钮调用 PUT /api/settings/user
  - 验证：Browser 中可以选择模型、保存、刷新后保持

- [ ] 2. RuntimeControlPanel 改为可编辑表单（对标 NarraFork /settings/agent）
  - 默认权限模式：下拉（ask/edit/allow/read/plan）
  - 每条消息最大轮次：数字输入（默认 200）
  - 翻译思考内容：toggle
  - Dump 每条 API 请求：toggle
  - 默认展开推理内容：toggle
  - 默认宽松规划：toggle
  - 跳过只读确认：toggle
  - 可恢复错误最大重试次数：数字输入
  - 保存按钮调用 PUT /api/settings/user
  - 验证：Browser 中可以修改 toggle/下拉/数字、保存、刷新后保持

### Phase 1：对话页面对标 NarraFork 叙述者窗口

- [ ] 3. 输入区重构
  - 左侧：附件图标（placeholder，暂不实现上传）
  - 中间：自动扩展输入框
  - 右侧一行：模型选择器下拉（当前会话覆盖）+ 权限模式 badge/下拉 + 中断/发送按钮
  - Enter 发送 / Shift+Enter 换行
  - 输入 `/` 弹出 slash command 建议
  - 验证：输入区视觉对标 NarraFork

- [ ] 4. 工具调用紧凑卡片
  - 一行：绿色✓图标 + 工具名 + 耗时 badge（"✓ 846ms"）
  - 失败：红色✗图标
  - 点击展开输入/输出详情
  - 验证：工具调用显示为紧凑一行

- [ ] 5. Markdown 渲染 + 代码高亮
  - assistant 消息 markdown 渲染
  - 代码块语法高亮 + 复制按钮
  - 验证：AI 回复正确渲染 markdown

- [ ] 6. Streaming + 思考中计时
  - 底部状态："思考中 X:XX" 实时计时
  - 流式文本逐步显示
  - 中断按钮红色可点击
  - 验证：发送消息后看到计时和流式输出

- [ ] 7. 顶部工具栏 + 底部状态栏
  - 顶部：叙述者名称 + 操作图标（搜索、设置）
  - 底部：session 信息 + 操作图标
  - 验证：顶部/底部紧凑

- [ ] 8. 确认门交互卡片
  - pending-confirmation 显示为卡片
  - 批准/拒绝按钮
  - 验证：确认门可交互

### Phase 2：Novel 命令真实执行

- [ ] 9. 接入 executeNovelCommand handler
  - session-headless-chat-service 和 slash-command-registry 传入 executeNovelCommand
  - 调用 workflow-executor
  - 验证：/novel:write-next 不返回 unhandled_command

- [ ] 10. Workflow step executor 真实步骤
  - context-load → cockpit.get_snapshot
  - writer-generate → LLM 候选稿
  - 验证：workflow 执行产出结果

- [ ] 11. Workflow 结果接入消息流
  - 每步结果广播到 WebSocket
  - 显示为工具调用紧凑卡片
  - 验证：叙述者看到 workflow 进度

### Phase 3：基础设施

- [ ] 12. 重新 build 前端 dist
  - 验证：所有改动在 Browser 可见

- [ ] 13. autoCompact 真实摘要
  - 用 summaryModel 调 LLM
  - 验证：compact 后摘要有意义

- [ ] 14. model reference 友好化
  - 支持 providerName:modelId
  - 验证：友好格式能解析

### Phase 4：E2E 验证

- [ ] 15. 创建会话 → 发送消息 → AI 回复（streaming + markdown）
- [ ] 16. /novel:write-next 完整流程
- [ ] 17. 设置修改 → 对话行为变化
