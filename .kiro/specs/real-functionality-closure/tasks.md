# Implementation Plan — 真实功能闭环

## Overview

本任务清单基于 2026-05-08 前端功能校验结果，解决 `claude-codex-novel-agent-v1` spec 中标记为完成但实际未真正可用的功能缺口。

核心原则：**每个任务完成后必须在 Browser E2E 中验证可见效果**。

---

## Tasks

### Phase A：前端 build 与设置页可编辑化

- [ ] 1. 重新 build 前端 dist，使源码改动生效
  - 运行 `pnpm --dir packages/studio build:client` 生成新的 dist
  - 验证：Browser 访问 localhost 看到命令启用/禁用按钮、RuntimeStatusPanel、/novel:write-next 状态为 partial

- [ ] 2. 设置页 ModelsSection 添加编辑控件
  - 为 defaultSessionModel 添加 provider:model 下拉选择器（从 /api/providers/models 读取可用模型列表）
  - 为 summaryModel 添加同样的选择器
  - 保存按钮调用 PUT /api/settings/user
  - 验证：Browser 中可以选择模型并保存，刷新后保持

- [ ] 3. 设置页 RuntimeControlPanel 添加编辑控件
  - 为 permissionMode 添加 select（ask/edit/allow/read/plan）
  - 为 maxTurnSteps 添加 number input
  - 为 reasoningEffort 添加 select
  - 保存按钮调用 PUT /api/settings/user
  - 验证：Browser 中可以修改权限模式并保存

### Phase B：Novel 命令真实执行

- [ ] 4. 在 slash-command-registry 中提供 executeNovelCommand handler
  - 在 executeSlashCommandInput 的 context 中传入 executeNovelCommand
  - executeNovelCommand 调用 workflow-executor 的 executeWorkflow
  - 验证：叙述者输入 /novel:write-next 不再返回 unhandled_command

- [ ] 5. 实现 workflow step executor 的真实步骤执行
  - context-load 步骤调用 cockpit.get_snapshot + narrative.read_line
  - pgi 步骤调用 pgi.generate_questions（或跳过如果无问题）
  - guided-plan 步骤返回 approval-pending
  - writer-generate 步骤调用 LLM 生成候选稿
  - 验证：/novel:write-next 执行到 approval-pending 步骤并暂停

- [ ] 6. 将 workflow executor 结果接入 session chat 消息流
  - workflow 每步结果作为 assistant message 广播到 WebSocket
  - approval-pending 步骤显示确认门 UI
  - 验证：Browser 中叙述者消息流展示 workflow 步骤进度

### Phase C：autoCompact 真实摘要

- [ ] 7. 替换 autoCompact 的截断 stub 为 LLM 调用
  - 从 user config 读取 summaryModel
  - 调用 generateSessionReply 生成真实摘要
  - fallback：如果 LLM 不可用，保持截断行为
  - 验证：长对话触发 compact 后，摘要是有意义的文本而非截断

### Phase D：model reference 用户友好化

- [ ] 8. 改进 model reference 格式
  - 支持 `providerName:modelId` 格式（除了 `providerId:modelId`）
  - parseModelReference 先按 ID 查找，找不到再按 name 查找
  - 验证：设置 `vivy-free:gpt-5.4-mini` 能正确解析到对应 provider

### Phase E：端到端验证

- [ ] 9. Browser E2E：创建会话 → 发送消息 → 收到 AI 回复
  - 在 Studio 中新建会话
  - 发送"你好"
  - 验证 WebSocket 收到 assistant 回复
  - 验证消息显示在叙述者面板

- [ ] 10. Browser E2E：/novel:write-next 完整流程
  - 创建书籍
  - 在叙述者输入 /novel:write-next
  - 验证 workflow 步骤展示
  - 验证 approval-pending 暂停
