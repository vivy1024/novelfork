# 工具调用可视化功能

## 已实现文件

1. **类型定义** (`packages/studio/src/stores/windowStore.ts`)
   - 扩展 `ChatMessage` 接口，添加 `toolCalls?: ToolCall[]`
   - 定义 `ToolCall` 接口（toolName, command, duration, output, error, exitCode）

2. **ToolIcon 组件** (`packages/studio/src/components/ToolCall/ToolIcon.tsx`)
   - Bash → Terminal 图标
   - Read → FileText 图标
   - Write/Edit → Edit 图标
   - Grep → Search 图标
   - 默认 → Code 图标

3. **ToolCallOutput 组件** (`packages/studio/src/components/ToolCall/ToolCallOutput.tsx`)
   - 自动折叠超过 500 字符的输出
   - 显示剩余字符数
   - 支持展开/收起
   - 错误输出红色高亮

4. **ToolCallCard 组件** (`packages/studio/src/components/ToolCall/ToolCallCard.tsx`)
   - 显示工具名称、图标、耗时
   - 显示命令（代码块样式）
   - 集成 ToolCallOutput
   - 复制命令按钮（带复制成功反馈）
   - 重新运行按钮（预留接口）
   - Exit code 错误标记

5. **ChatWindow 集成** (`packages/studio/src/components/ChatWindow.tsx`)
   - 在消息下方渲染工具调用卡片
   - 支持多个工具调用
   - 保持消息流布局

## 使用示例

```typescript
// 在 WebSocket 消息中包含工具调用数据
const message: ChatMessage = {
  id: "msg-123",
  role: "assistant",
  content: "正在检查 Git 状态...",
  timestamp: Date.now(),
  toolCalls: [
    {
      toolName: "Bash",
      command: "git status --short",
      duration: 1200,
      output: "M packages/studio/src/components/ChatWindow.tsx\n?? packages/studio/src/components/ToolCall/",
      exitCode: 0
    }
  ]
};
```

## 功能特性

- ✅ 工具图标可视化
- ✅ 命令显示（代码块）
- ✅ 输出自动折叠（>500 字符）
- ✅ 耗时显示（ms/s 自动格式化）
- ✅ 复制命令功能
- ✅ 错误高亮显示
- ✅ Exit code 标记
- ✅ 重新运行按钮（接口预留）
