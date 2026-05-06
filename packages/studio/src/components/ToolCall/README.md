# ToolCall 资产边界

`packages/studio/src/components/ToolCall/` 现在是叙述者会话工具调用的共享渲染资产，而不是旧窗口视觉层专属集成点。

## 当前用途

- `ToolCallBlock`：会话工具调用的完整透明化卡片，保留图标、状态、耗时、exit code、错误展示、复制、源码预览、全屏详情、原始载荷和长输出折叠能力。
- `tool-result-renderer-registry`：按 `toolCall.result.renderer` 或工具名选择 cockpit、guided、PGI、candidate、jingwei 等一等公民结果卡片。
- `ToolIcon`：按工具类型统一展示 Bash/Read/Write/Search/Web/MCP/Agent 图标。
- `ToolCallCard`：兼容导出，委托给 `ToolCallBlock`。

## Current consumers

- `/next/narrators/:sessionId` 的 `agent-conversation/surface/ToolCallCard`：保留轻量 tool result renderer，同时在存在 `output`、`error`、`exitCode` 等详细执行信息时复用 `ToolCallBlock`。
- 旧窗口视觉层已在 `legacy-source-retirement-v1` Task 6 删除；本目录继续服务新的 narrator conversation surface。

## 非目标

- 不再把工具调用类型定义挂在 `windowStore` 或 `ChatMessage` 上。
- 不再新增面向旧窗口视觉层的集成说明。
- 不为旧 UI 增加 shim/noop adapter；旧入口删除后由 Git 历史保留。

## 验证

- `components/ToolCall/ToolCallBlock.test.tsx` 覆盖 renderer registry、generic fallback、错误/exit code、源码预览、raw payload 与运行追踪。
- `app-next/agent-conversation/surface/ConversationSurface.test.tsx` 覆盖新 narrator surface 的 renderer registry、raw data 展开，以及复用 `ToolCallBlock` 的长输出折叠、图标和错误展示。
