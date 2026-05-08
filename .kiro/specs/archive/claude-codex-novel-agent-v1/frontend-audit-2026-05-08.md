# 前端功能校验报告

**日期**: 2026-05-08
**环境**: NovelFork Studio API server (bun, port 4569) + dist 前端资产
**Provider**: vivy-free (Sub2API) 配置完成，hasUsableModel=true

---

## 0. 对话页面（最严重问题）

### 现状
- **纯文本 debug 视图**：没有消息气泡、没有角色区分、没有 markdown 渲染
- **工具调用是 raw text dump**：没有折叠卡片、没有结构化展示
- **操作栏是文字链接堆砌**："中断 无运行中的会话 重试 当前会话没有可重试事件 清空..."全挤一行
- **输入框极其简陋**：裸 textarea + "发送"文字，没有 slash command 提示
- **没有 streaming 动画**：没有打字效果、没有思考中状态
- **确认门是纯文本**：没有交互卡片
- **header 是表格式布局**：不是紧凑的控制栏

### 与 NarraFork 对比
| 功能 | NarraFork | NovelFork |
|------|-----------|-----------|
| 消息气泡 | ✅ user/assistant 区分 | ❌ 纯文本堆砌 |
| Markdown 渲染 | ✅ 完整支持 | ❌ 无 |
| 代码高亮 | ✅ 语法高亮+复制 | ❌ 无 |
| 工具调用卡片 | ✅ 折叠/展开 | ❌ raw text |
| Streaming | ✅ 打字动画 | ❌ 无 |
| Slash command | ✅ 自动补全 | ❌ 无 |
| 确认门 | ✅ 交互卡片 | ❌ 纯文本 |
| Token 用量 | ✅ 实时显示 | ❌ 无 |
| 模型切换 | ✅ header 下拉 | ⚠️ 有但简陋 |

---

## 1. 设置页 (`/next/settings`)

### 模型 section
- **状态**: 只读展示
- **问题**: 只有 FactRow 显示当前值/来源/状态/API 路径，**没有任何编辑控件**（无下拉框、无输入框、无保存按钮）
- **唯一交互**: "打开 AI 供应商"按钮

### AI 代理 section (RuntimeControlPanel)
- **状态**: 只读展示
- **问题**: 同上，所有字段只显示值和元数据，**没有表单控件**
- **注意**: 代码中 `RuntimeControlPanel` 应该有编辑功能，但 dist 中的版本可能是旧的只读版本

### AI 供应商 (ProviderSettingsPage)
- **状态**: 未验证（需要从设置页跳转）
- **预期**: 应该有完整 CRUD（代码审计确认有 619 行实现）

### 存储 section
- **状态**: 未验证（dist 中可能是旧的 DataPanel 而非新的 RuntimeStatusPanel）

---

## 2. 套路页 (`/next/routines`)

### 命令 tab
- **状态**: 只读展示
- **问题**: 显示 20 个 runtime commands 但**没有启用/禁用按钮**（我添加的代码在 dist 中不存在）
- **注意**: `/novel:write-next` 显示"计划中"而非"部分接入"——dist 是旧代码

### 可选工具 tab ✅
- **状态**: 真实可交互
- **功能**: toggle 开关启用/禁用工具，搜索框，显示"已启用 9/22"

### 工具权限 tab ✅
- **状态**: 真实可交互
- **功能**: 添加规则表单（工具名称、命令匹配、权限策略），分类卡片

### 全局技能 tab ✅
- **状态**: 真实可交互
- **功能**: "+ 添加技能"按钮，技能列表

### 项目技能 tab ✅
- **状态**: 真实可交互
- **功能**: 同上

### 自定义子代理 tab ✅
- **状态**: 真实可交互
- **功能**: "+ 添加子代理"按钮

### 全局提示词 / 系统提示词 tab
- **状态**: 未验证

### MCP 工具 tab ✅
- **状态**: 真实可交互
- **功能**: "+ 添加 Server"、"刷新"、"导入 JSON"、统计面板、治理总览

### 钩子 tab ✅
- **状态**: 真实可交互
- **功能**: "创建钩子"按钮，Shell/Webhook/LLM 类型卡片，生命周期节点配置

---

## 3. 叙述者/会话

### 会话列表
- **状态**: 真实可交互
- **功能**: 显示已有会话，可点击切换

### 新建会话 + 发送消息
- **状态**: 未验证（需要测试 WebSocket chat 流程）

### /novel:write-next 命令
- **状态**: 不可用
- **原因**: executeNovelCommand handler 从未被提供，会返回 unhandled_command

---

## 4. 首页/欢迎页

- **状态**: 正常工作
- **功能**: 显示模型健康、当前提供方、默认模型、"新建作品"按钮

---

## 5. 根本问题

1. **dist 是旧代码**: 前端 dist 中的代码是上次 build 的产物，不包含本次会话的任何改动（命令启用/禁用按钮、RuntimeStatusPanel、workflow recipe 等）
2. **设置页缺少编辑控件**: ModelsSection 和 RuntimeControlPanel（在 dist 中的版本）只有只读 FactRow，没有表单
3. **workflow executor 未接入**: `/novel:write-next` 命令执行会失败
4. **autoCompact summarizer 是 stub**: 截断而非 LLM 摘要
5. **model reference 格式脆弱**: `providerId:modelId` 需要用户知道 provider 的内部 ID
