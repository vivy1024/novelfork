# Tool Components - 工具展示组件

Phase 4 前端工具展示组件，用于在对话流中显示 AI 工具使用情况。

## 组件列表

### 1. ToolUseCard - 工具调用卡片

显示工具调用的基本信息和状态。

**Props:**
```typescript
interface ToolUseCardProps {
  toolName: string;                              // 工具名称（Read、Write、Bash 等）
  params: Record<string, unknown>;               // 工具参数
  status: "pending" | "success" | "error";       // 执行状态
  timestamp: Date;                               // 调用时间
}
```

**特性:**
- 根据工具类型显示不同图标（FileText、Edit、Terminal 等）
- 状态指示器：pending（加载动画）、success（绿色勾）、error（红色叉）
- 参数自动截断（超过 100 字符显示省略号）
- 支持深色模式

**使用示例:**
```tsx
<ToolUseCard
  toolName="Read"
  params={{ file_path: "/path/to/file.txt", limit: 100 }}
  status="success"
  timestamp={new Date()}
/>
```

---

### 2. ToolResultCard - 工具结果卡片

显示工具执行结果，支持折叠/展开。

**Props:**
```typescript
interface ToolResultCardProps {
  toolName: string;                              // 工具名称
  result: {
    success: boolean;                            // 是否成功
    data?: unknown;                              // 返回数据
    error?: string;                              // 错误信息
  };
  timestamp: Date;                               // 完成时间
}
```

**特性:**
- 成功/失败不同背景色（绿色/红色）
- 可折叠/展开（默认展开）
- 自动格式化 JSON 数据
- 代码块样式展示结果
- 最大高度限制（max-h-96）+ 滚动

**使用示例:**
```tsx
<ToolResultCard
  toolName="Read"
  result={{
    success: true,
    data: "File contents here...\nLine 1\nLine 2"
  }}
  timestamp={new Date()}
/>
```

---

### 3. PermissionPrompt - 权限请求弹窗

在执行工具前请求用户授权。

**Props:**
```typescript
interface PermissionPromptProps {
  open: boolean;                                 // 是否显示弹窗
  toolName: string;                              // 工具名称
  params: Record<string, unknown>;               // 工具参数
  onApprove: () => void;                         // 批准回调
  onDeny: () => void;                            // 拒绝回调
  onClose: () => void;                           // 关闭回调
}
```

**特性:**
- 危险工具警告（Bash、Write、ExitWorktree）
- 工具描述和参数详情展示
- 参数 JSON 格式化显示
- 危险工具使用红色按钮
- 使用 shadcn/ui Dialog 组件

**使用示例:**
```tsx
<PermissionPrompt
  open={true}
  toolName="Bash"
  params={{ command: "rm -rf /tmp/cache" }}
  onApprove={() => console.log("Approved")}
  onDeny={() => console.log("Denied")}
  onClose={() => console.log("Closed")}
/>
```

---

## 集成到对话流

### 数据结构

```typescript
interface ToolCall {
  id: string;
  toolName: string;
  params: Record<string, unknown>;
  status: "pending" | "success" | "error";
  timestamp: Date;
  result?: {
    success: boolean;
    data?: unknown;
    error?: string;
  };
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
}
```

### 渲染流程

```tsx
{messages.map((message) => (
  <div key={message.id}>
    {/* 消息内容 */}
    <div className="message-content">{message.content}</div>

    {/* 工具调用展示 */}
    {message.toolCalls?.map((toolCall) => (
      <div key={toolCall.id}>
        {/* 1. 显示工具调用 */}
        <ToolUseCard
          toolName={toolCall.toolName}
          params={toolCall.params}
          status={toolCall.status}
          timestamp={toolCall.timestamp}
        />

        {/* 2. 显示工具结果（如果有） */}
        {toolCall.result && (
          <ToolResultCard
            toolName={toolCall.toolName}
            result={toolCall.result}
            timestamp={toolCall.timestamp}
          />
        )}
      </div>
    ))}
  </div>
))}
```

### 权限请求流程

```tsx
const [pendingTool, setPendingTool] = useState<{
  toolName: string;
  params: Record<string, unknown>;
} | null>(null);

// 1. AI 请求工具执行
const handleToolRequest = (toolName: string, params: Record<string, unknown>) => {
  setPendingTool({ toolName, params });
};

// 2. 用户批准
const handleApprove = async () => {
  if (!pendingTool) return;
  
  // 添加 pending 状态的工具调用
  const toolCall = {
    id: crypto.randomUUID(),
    toolName: pendingTool.toolName,
    params: pendingTool.params,
    status: "pending" as const,
    timestamp: new Date(),
  };
  
  // 更新消息列表...
  
  // 执行工具
  const result = await executeTool(pendingTool.toolName, pendingTool.params);
  
  // 更新工具调用状态和结果...
  
  setPendingTool(null);
};

// 3. 渲染权限弹窗
{pendingTool && (
  <PermissionPrompt
    open={true}
    toolName={pendingTool.toolName}
    params={pendingTool.params}
    onApprove={handleApprove}
    onDeny={() => setPendingTool(null)}
    onClose={() => setPendingTool(null)}
  />
)}
```

---

## 导入方式

```typescript
// 单独导入
import { ToolUseCard } from "@/components/ToolUseCard";
import { ToolResultCard } from "@/components/ToolResultCard";
import { PermissionPrompt } from "@/components/PermissionPrompt";

// 或从统一入口导入
import {
  ToolUseCard,
  ToolResultCard,
  PermissionPrompt,
  type ToolUseCardProps,
  type ToolResultCardProps,
  type PermissionPromptProps,
} from "@/components/tool-components";
```

---

## 完整示例

参见 `ToolUsageExample.tsx` 文件，包含：
- 完整的状态管理
- 工具权限请求流程
- 工具执行和结果更新
- 错误处理
- 模拟工具执行函数

---

## 样式定制

所有组件使用 Tailwind CSS，支持深色模式。可通过以下方式定制：

1. **修改颜色方案**: 编辑组件内的 className
2. **调整尺寸**: 修改 padding、gap、size 等属性
3. **更换图标**: 修改 `TOOL_ICONS` 映射表
4. **添加新工具**: 在 `TOOL_ICONS` 和 `TOOL_DESCRIPTIONS` 中添加条目

---

## 依赖

- React 19
- lucide-react (图标)
- shadcn/ui (Dialog、Button 等)
- Tailwind CSS (样式)

---

## 后续扩展

可能的增强功能：
- [ ] 工具执行时间统计
- [ ] 工具调用历史记录
- [ ] 批量批准/拒绝
- [ ] 工具调用可视化（流程图）
- [ ] 代码高亮（使用 Prism 或 Shiki）
- [ ] 导出工具调用日志
