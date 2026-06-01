# 错误透传与上下文可视化

## 背景

NarraFork 的设计哲学：所有错误必须对用户可见，不能静默吞掉。当前 NovelFork 大量 API 调用失败时前端无反馈。

## FR-1: 全局错误透传

### 需求

对齐 NarraFork 的错误处理行为：

1. **首次遇到错误**：对话界面暂停，显示错误消息气泡（红色/橙色），包含：
   - 错误具体内容（如 "API 502: upstream_error"）
   - "刷新重试"按钮 — 点击后设置为该类错误自动重试
   - "删除"按钮 — 删除错误消息，继续对话
2. **后续遇到相同错误**：自动重试（不再暂停），状态栏变黄色"等待中/重试中"
3. **右上角通知弹窗**：错误发生时弹出 toast 通知，显示具体错误信息
4. **错误不阻塞 UI**：用户仍可操作其他功能（切换会话、查看设置等）

### 当前问题

- `void promise` 吞掉错误（已部分修复）
- LLM 调用失败时前端只显示"工作中"然后卡住
- 工具调用超时时无提示
- 压缩失败时无提示（已修复 alert，但应该是 toast + 错误消息气泡）

## FR-2: 上下文注入可视化

### 需求

用户能查看当前发送给模型的完整上下文组成，类似 NarraFork 的 Context Ring 展开详情：

1. **Context Ring 菜单扩展**：除了"立即压缩"和"清空上下文"，增加"查看上下文详情"
2. **上下文详情面板**显示：
   - System prompt 来源和大小（CLAUDE.md / 全局提示词 / Agent prompt）
   - 经纬注入内容（哪些条目被注入、token 占用）
   - 预设规则注入（哪些 promptInjection 生效）
   - 工具定义占用（多少工具、token 占用）
   - 消息历史占用（多少条消息、token 占用）
   - 各部分占比饼图或条形图

### 实现方式

后端新增 `GET /api/sessions/:id/context-breakdown` 端点，返回：
```json
{
  "totalTokens": 45000,
  "breakdown": {
    "systemPrompt": { "tokens": 3000, "sources": ["CLAUDE.md", "globalPrompts"] },
    "tools": { "tokens": 8000, "count": 24 },
    "messages": { "tokens": 30000, "count": 42 },
    "jingwei": { "tokens": 2000, "entries": 5 },
    "presets": { "tokens": 2000, "rules": 4 }
  }
}
```

## 执行顺序

Phase A: FR-1 错误透传（后端 + 前端）
Phase B: FR-2 上下文可视化（API + UI）
