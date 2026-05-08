# Requirements — 对话页面真实闭环

## 背景

经过 11 个 spec 的迭代，NovelFork 的后端 API、类型系统、session runtime、command registry、tool policy、settings truth model 已经完整就绪。但对话页面（`/next/narrators/:sessionId`）的前端渲染层始终是最后被跳过的部分：

- `surface/MessageItem.tsx` 自写简易 `inlineMarkdown()`，未复用 `components/MarkdownRenderer.tsx`（react-markdown + Prism + KaTeX）
- `surface/ToolCallCard.tsx` 是简化版，未复用 `components/ToolCall/ToolCallBlock.tsx`（governance badge、replay、canvas artifact、transcript）
- Composer 的附件按钮无 onClick、模型/权限是静态 span 不是下拉
- `streamingStartedAt` 从未被 ConversationRoute 传入，ThinkingTimer 永远不显示
- 搜索按钮无 handler
- `workflow-executor.ts`、`mcp-client-runtime.ts` 有完整实现但零生产调用

## 核心原则

1. **复用现有成熟组件**，不再重写
2. **接线断裂必须修复**，不能有无 handler 的按钮
3. **Dead code 必须激活或删除**，不能继续积累
4. **浏览器截图验证**，不能只靠 Vitest 组件测试

## Requirements

### Requirement 1：Markdown 渲染复用成熟组件

MessageItem 中的 AI 回复必须使用 `components/MarkdownRenderer.tsx`（react-markdown + remark-gfm + Prism 语法高亮 + KaTeX 数学公式），不再使用自写的 `inlineMarkdown()` 正则替换。

验收标准：
- 代码块有语法高亮（不同语言不同颜色）
- 行内代码有背景色
- 数学公式可渲染
- 列表、标题、粗体、链接正常
- 删除 `renderMarkdown()` 和 `inlineMarkdown()` 函数

### Requirement 2：工具调用卡片复用成熟组件

MessageItem 中的工具调用必须使用 `components/ToolCall/ToolCallBlock.tsx`，不再使用简化版 `surface/ToolCallCard.tsx`。

验收标准：
- 工具调用显示 governance 来源 badge
- 支持 replay 动作
- 支持 canvas artifact 打开
- 长输出折叠、secret 脱敏
- 删除 `surface/ToolCallCard.tsx`

### Requirement 3：Composer 控件真实交互

Composer 中的所有按钮和控件必须有真实 handler，不能有装饰性占位。

验收标准：
- 附件按钮：点击打开文件选择器，选择后文件路径附加到消息上下文
- 模型标签：改为下拉选择器，从 `/api/providers/models/grouped` 读取可用模型，选择后调用 session config update
- 权限标签：改为下拉选择器，选项来自 `SESSION_PERMISSION_MODE_OPTIONS`，选择后调用 session config update

### Requirement 4：Streaming 计时器接线

ConversationRoute 必须将 `streamingStartedAt` 传入 ConversationSurface，使 ThinkingTimer 在 AI 思考时实际显示。

验收标准：
- AI 回复开始时显示"思考中 0:XX"计时
- AI 回复结束时计时器消失
- 刷新后不显示虚假计时

### Requirement 5：搜索功能接线

顶部搜索按钮必须有真实功能：展开搜索输入框，输入关键词后过滤当前会话消息列表。

验收标准：
- 点击搜索图标展开输入框
- 输入关键词后只显示匹配消息
- 清空搜索恢复全部消息
- 无匹配时显示"无结果"

### Requirement 6：Dead code 激活 — workflow executor

`workflow-executor.ts` 必须接入生产路径。当用户在对话中输入 `/novel:write-next` 时，必须调用 `executeWorkflow()` 而不是 Composer fallback 发送给 AI。

验收标准：
- `/novel:write-next` 执行 workflow recipe 步骤链
- 步骤结果通过 WebSocket 广播到前端
- 步骤失败时停止后续步骤并显示错误

### Requirement 7：Dead code 激活 — MCP client

`mcp-client-runtime.ts` 必须接入套路页 MCPServerPanel。添加 MCP server 后必须尝试真实连接。

验收标准：
- 套路页添加 MCP server 后调用 `createMcpClient()` 尝试连接
- 连接成功显示绿色状态 + 工具数量
- 连接失败显示红色状态 + 错误信息
- 工具列表可展开查看

### Requirement 8：浏览器截图验证

所有上述改动必须通过真实浏览器验证，不能只靠 Vitest。

验收标准：
- 新建会话 → 发送消息 → AI 回复（Markdown 渲染 + 工具调用卡片）截图
- 设置页修改模型/权限 → 保存 → 刷新保持 截图
- 对话页 Composer 模型下拉 + 权限下拉 截图
