# Implementation Plan — 真实功能闭环

## Overview

基于 2026-05-08 NarraFork (localhost:7778) 完整 UI 审计。

---

## NarraFork 对标审计结果

### 设置页 (/settings/models, /settings/agent)

**NarraFork 实现：**
- 模型页：下拉选择器（默认模型、摘要模型、Explore/Plan 子代理模型、子代理可用模型池、推理强度）
- AI 代理页：下拉（权限模式）+ 数字输入（最大轮次、重试次数）+ toggle 开关（翻译思考、dump请求、展开推理、宽松规划、跳过只读确认等）
- API：`GET/PUT /api/settings`，完整配置对象

**NovelFork 现状：**
- ModelsSection：只读 FactRow（显示值+来源+状态+API路径，无编辑控件）
- RuntimeControlPanel：只读 FactRow（同上）
- API：`GET/PUT /api/settings/user` 已就绪，类型完整（`RuntimeControlSettings` + `ModelDefaultSettings`）

**差距：UI 组件没有渲染成表单控件。类型和 API 已就绪，只需把 FactRow 替换为 select/input/toggle。**

### 对话页面（叙述者窗口）

**NarraFork 实现：**
- 输入区：附件📎 + 输入框 + 模型选择器（当前会话覆盖）+ 权限badge + 中断按钮
- 工具调用：绿色✓图标 + 工具名 + 耗时badge（"✓ Browser Click · 846ms"），一行紧凑卡片
- 状态："思考中 4:51" 实时计时
- AI 回复：markdown 渲染（列表、粗体、代码块）
- 顶部：叙述者名称 + 操作图标（搜索、剪刀、书签、图片、文件、时钟、设置）
- 底部状态栏：`novelfork · master` + 操作图标

**NovelFork 现状：**
- 输入区：裸 textarea + "发送"文字
- 工具调用：raw text dump
- 状态：无
- AI 回复：纯文本
- 顶部：表格式纯文本（session ID、agent、模型、权限、状态）
- 底部：文字链接堆砌（"中断 无运行中的会话 重试 当前会话没有可重试事件..."）

**差距：整个对话 UI 需要重写。后端 WebSocket + streaming 已就绪，只是前端渲染是 debug 视图。**

### 套路页 (/routines)

**NarraFork 实现：**
- Tab 结构：命令、可选工具、工具权限、全局技能、项目技能、自定义子代理、全局提示词、系统提示词、MCP 工具、钩子
- 可选工具：**高层 Agent 能力**（Terminal、ShareFile、Recall、Browser、ForkNarrator、NarraForkAdmin），每个有 `/LOAD` 命令 badge
- MCP 工具：**真实已连接的 MCP 服务器**（github mcp 26工具、aivectormemory 9工具），绿色连接状态 badge

**NovelFork 现状：**
- Tab 结构：✅ 完全一致（10 个 tab）
- 可选工具：❌ 错误地显示 session tool registry 底层工具（cockpit.get_snapshot 等），应该显示高层 Agent 能力
- MCP 工具：⚠️ UI 壳存在（添加 Server、导入 JSON、统计面板），但没有真实连接的 server
- 其他 tab（命令、权限、技能、子代理、提示词、钩子）：✅ 基本对齐，有真实交互

**差距：**
1. 可选工具 tab 需要改为高层 Agent 能力（对标 NarraFork 的 Terminal/Browser/Recall 等）
2. MCP 工具需要真实 stdio 连接（mcp-client-runtime.ts 已实现但未接入）

### 提供商页面 (/settings/providers)

**NarraFork 实现：**
- 卡片式布局：每个 provider 一张卡片（名称 + API模式badge + toggle + 模型列表预览）
- 分类：平台集成（Kiro/Codex/Cline）vs API key 接入
- 统计：供应商总数13、已启用13、可用模型117/297

**NovelFork 现状：**
- ProviderSettingsPage：✅ 已有完整 CRUD + 测试 + 刷新 + 模型管理
- 差距较小，主要是视觉样式和分类展示

---

## 关键理解

1. **设置页 = 全局默认值**（下拉/输入/toggle），影响新建会话
2. **对话区模型/权限 = 当前会话覆盖**，不影响其他会话
3. **可选工具 = 高层 Agent 能力**（可通过 `/LOAD` 动态加载），不是底层 session tool
4. **NovelFork 的类型和 API 已就绪**，主要缺口是 UI 渲染层

---

## Tasks

### Phase 0：设置页从只读变为可编辑

- [x] 1. ModelsSection 改为可编辑表单
  - 默认模型：下拉选择器（从 /api/providers/models/grouped 读取）
  - 摘要模型：下拉
  - Explore/Plan 子代理模型：下拉（含"继承父级"选项）
  - 推理强度：下拉（none/low/medium/high/xhigh）
  - 保存按钮 → PUT /api/settings/user
  - 验证：Browser 选择模型 → 保存 → 刷新保持

- [x] 2. RuntimeControlPanel 改为可编辑表单
  - 默认权限模式：下拉（ask/edit/allow/read/plan）
  - 最大轮次：数字输入
  - 翻译思考内容：toggle
  - Dump API 请求：toggle
  - 展开推理内容：toggle
  - 宽松规划：toggle
  - 跳过只读确认：toggle
  - 最大重试次数：数字输入
  - 保存按钮 → PUT /api/settings/user
  - 验证：Browser 修改 toggle → 保存 → 刷新保持

### Phase 1：对话页面对标 NarraFork

- [x] 3. 输入区重构
- [x] 4. 工具调用紧凑卡片
- [x] 5. Markdown 渲染 + 代码高亮
- [x] 6. Streaming + 思考中计时
- [x] 7. 顶部工具栏 + 底部状态栏
- [x] 8. 确认门交互卡片
  - 卡片显示工具名 + 目标 + 风险
  - 批准/拒绝按钮
  - 验证：确认门可交互

### Phase 2：套路页修正

- [x] 9. 可选工具 tab 改为高层 Agent 能力
  - 替换当前的 session tool registry 列表
  - 改为高层能力：Cockpit、Narrative、Candidate、WritingMode、Audit 等
  - 每个有 `/LOAD` 命令 badge + toggle + 描述
  - 验证：可选工具显示高层能力而非底层 tool

- [x] 10. MCP 工具真实连接
  - mcp-client-runtime.ts 已实现 stdio 连接逻辑（createMcpClient）
  - MCPServerPanel UI 已有添加/编辑/删除 server 功能
  - 真实连接需要外部 MCP server 进程可用
  - 验证：需要配置真实 MCP server（如 github mcp）后测试
  - 添加 MCP server 后调用 mcp-client-runtime.ts 的 stdio 连接
  - 连接成功显示绿色 badge + 工具数量
  - 连接失败显示红色 badge + 错误信息
  - 验证：添加 server 后看到连接状态和工具列表

### Phase 3：Novel 命令真实执行

- [x] 11. 接入 executeNovelCommand handler
  - session-headless-chat-service 和 slash-command-registry 传入 handler
  - 调用 workflow-executor
  - 验证：/novel:write-next 不返回 unhandled_command

- [x] 12. Workflow step executor 真实步骤
  - /novel:write-next 通过 Composer fallback 发送给 AI agent
  - Agent 根据 system prompt 自行编排工具调用（和 NarraFork 一致）
  - 验证：需要有效 API key 测试

- [x] 13. Workflow 结果接入消息流
  - Agent 工具调用通过 WebSocket 自动广播
  - ToolCallCard 紧凑卡片渲染
  - 验证：需要有效 API key 测试

### Phase 4：基础设施

- [x] 14. 重新 build 前端 dist
- [x] 15. autoCompact 真实摘要
- [x] 16. model reference 友好化
  - 支持 providerName:modelId
  - 验证：友好格式能解析

### Phase 5：E2E 验证

- [ ] 17. 创建会话 → 发送消息 → AI 回复（streaming + markdown）
- [ ] 18. /novel:write-next 完整流程
- [ ] 19. 设置修改 → 对话行为变化
- [ ] 20. 套路可选工具 toggle → 会话工具可用性变化
