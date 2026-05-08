# Implementation Plan — 真实功能闭环

## Overview

本任务清单基于 2026-05-08 前端功能校验结果。当前 NovelFork Studio 的核心问题：

1. **对话页面是 debug 视图**：纯文本堆砌，没有消息气泡、markdown 渲染、工具调用卡片、streaming 动画、slash command 提示
2. **设置页大部分只读**：ModelsSection 和 RuntimeControlPanel 只有 FactRow 展示，没有编辑控件
3. **Novel 命令不可执行**：executeNovelCommand handler 从未被提供
4. **dist 是旧代码**：源码改动未 build 到前端

对标参考：
- **NarraFork**：精美消息气泡、工具调用折叠卡片、streaming 打字动画、slash command 自动补全、markdown/代码块渲染、确认门交互卡片、token 用量实时显示
- **Claude Code CLI**：结构化工具输出、permission request 交互、compact 进度、session resume
- **Codex CLI**：stream-json 事件、approval gate、sandbox 状态

核心原则：**每个任务完成后必须在 Browser E2E 中验证可见效果**。

---

## Tasks

### Phase 0：对话页面重写（最高优先级）

- [ ] 1. 消息气泡组件：user/assistant/system 角色区分
  - user 消息右对齐深色气泡
  - assistant 消息左对齐浅色气泡
  - system 消息居中灰色小字
  - 验证：Browser 中发送消息后看到清晰的角色区分

- [ ] 2. Markdown 渲染 + 代码高亮
  - assistant 消息支持 markdown 渲染（标题、列表、粗体、链接）
  - 代码块有语法高亮和复制按钮
  - 验证：AI 回复包含代码时正确渲染

- [ ] 3. 工具调用折叠卡片
  - tool_use 显示为可折叠卡片（工具名 + 摘要）
  - 展开后显示输入参数和输出结果
  - tool_result 成功/失败有不同颜色标识
  - 验证：对话中工具调用显示为紧凑卡片

- [ ] 4. Streaming 打字动画 + 思考中状态
  - AI 回复时显示打字光标动画
  - 思考中显示 "正在思考..." 指示器
  - 流式文本逐字显示
  - 验证：发送消息后看到实时打字效果

- [ ] 5. 输入区重构：Composer 组件
  - 多行输入框（自动扩展高度）
  - Enter 发送 / Shift+Enter 换行（可配置）
  - 发送按钮有 loading 状态
  - 输入 `/` 时弹出 slash command 建议列表
  - 显示当前模型名称和 token 估算
  - 验证：输入 `/` 看到命令建议弹窗

- [ ] 6. 确认门交互卡片
  - pending-confirmation 显示为独立卡片
  - 显示工具名、目标资源、风险等级、操作摘要
  - "批准"/"拒绝"按钮
  - 验证：触发确认门时看到交互卡片

- [ ] 7. Session header 紧凑化
  - 顶部 bar：session 标题（可编辑）+ 模型选择器 + 权限 badge + 状态指示
  - 不再是表格式纯文本
  - 验证：header 是一行紧凑的控制栏

- [ ] 8. 操作栏重构
  - 底部操作栏改为图标按钮（中断/重试/compact/fork）
  - 禁用状态用 disabled 样式而非文字说明
  - 验证：操作栏是紧凑的图标按钮行

### Phase A：设置页可编辑化

- [ ] 9. 设置页 ModelsSection 添加编辑控件
  - 为 defaultSessionModel 添加 provider:model 下拉选择器
  - 为 summaryModel 添加同样的选择器
  - 保存按钮调用 PUT /api/settings/user
  - 验证：Browser 中可以选择模型并保存

- [ ] 10. 设置页 RuntimeControlPanel 添加编辑控件
  - permissionMode select（ask/edit/allow/read/plan）
  - maxTurnSteps number input
  - reasoningEffort select
  - 保存按钮
  - 验证：Browser 中可以修改权限模式并保存

### Phase B：Novel 命令真实执行

- [ ] 11. 在 slash-command-registry 中提供 executeNovelCommand handler
  - executeNovelCommand 调用 workflow-executor
  - 验证：/novel:write-next 不再返回 unhandled_command

- [ ] 12. 实现 workflow step executor 真实步骤
  - context-load → cockpit.get_snapshot + narrative.read_line
  - pgi → pgi.generate_questions
  - guided-plan → approval-pending
  - writer-generate → LLM 生成候选稿
  - 验证：/novel:write-next 执行到 approval-pending 暂停

- [ ] 13. Workflow 结果接入 session chat 消息流
  - 每步结果作为 assistant message 广播
  - approval-pending 显示确认门卡片
  - 验证：叙述者消息流展示 workflow 进度

### Phase C：基础设施修复

- [ ] 14. 重新 build 前端 dist
  - `pnpm --dir packages/studio build:client`
  - 验证：所有源码改动在 Browser 中可见

- [ ] 15. autoCompact 真实摘要
  - 用 summaryModel 调用 LLM 生成摘要
  - fallback 保持截断
  - 验证：长对话 compact 后摘要有意义

- [ ] 16. model reference 用户友好化
  - 支持 providerName:modelId 格式
  - parseModelReference 先按 ID 查找再按 name 查找
  - 验证：`vivy-free:gpt-5.4-mini` 能正确解析

### Phase D：端到端验证

- [ ] 17. E2E：创建会话 → 发送消息 → 收到 AI 回复
  - 新建会话 → 发送"你好" → 看到 AI 回复气泡
  - 验证 streaming 效果

- [ ] 18. E2E：/novel:write-next 完整流程
  - 创建书籍 → 输入 /novel:write-next → 看到 workflow 步骤 → approval 暂停
  - 验证确认门卡片可交互

---

## 优先级说明

Phase 0（对话页面重写）是最高优先级，因为：
- 这是用户 90% 时间停留的页面
- 当前状态与 NarraFork 差距巨大（debug 视图 vs 产品级 UI）
- 没有可用的对话 UI，其他功能（Novel 命令、设置）都无法被用户感知
