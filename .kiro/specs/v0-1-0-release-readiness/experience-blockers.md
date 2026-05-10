# v0.1.0 体验验证阻塞项

## 概述

2026-05-11 用户亲自体验 exe 产物后发现的真实问题。按优先级排序，全部需要在 v0.1.0 发布前修复。

---

## 快速修复项（不涉及深层架构）

### QF-1: 供应商创建时 ID 显示为 `provider-1778451379718`

**现状**：创建供应商时用 `provider-${Date.now()}` 作为 ID，模型下拉里显示这个 ID 而不是名称。

**修复**：创建时用用户输入的名称生成 ID（如 `vivy`），或者模型下拉里显示 `providerName` 而不是 `providerId`。

**文件**：
- `packages/studio/src/app-next/settings/ProviderSettingsPage.tsx` — `saveProvider` 里的 ID 生成
- `packages/studio/src/app-next/agent-conversation/surface/NarratorStatusBar.tsx` — 模型下拉显示

---

### QF-2: Context Ring 不显示

**现状**：新会话 `cumulativeUsage` 为 null（没有历史 token 数据），导致 `contextUsage` 为 undefined，ContextRing 不渲染。

**修复**：即使 `cumulativeUsage` 为 null，只要有 `selectedModel.contextWindow`，就显示 Context Ring（usedTokens=0）。

**文件**：`packages/studio/src/app-next/StudioNextApp.tsx` — `toConversationStatus` 里的 contextUsage 构建逻辑

---

### QF-3: 写作按钮跳转对话后 pending action 没触发

**现状**：点击"生成下一章"跳转到对话页，但 `/novel:write-next` 没有自动发送。

**根因**：`WritingWorkbenchRouteLive` 里 `onNavigateToConversation` 只接收 `sessionId`，没有接收 `action` 参数，所以 `setPendingAction` 没被调用。

**修复**：检查 `onNavigateToConversation` 的签名是否正确传递了 action。

**文件**：`packages/studio/src/app-next/StudioNextApp.tsx`

---

### QF-4: 新建对话显示"正在恢复会话... — reconnect"

**现状**：新创建的会话打开时显示恢复提示。

**根因**：`useAgentConversationRuntime` 初始化时 recovery state 不是 idle。

**修复**：新会话（无历史消息）时不显示恢复提示。

**文件**：`packages/studio/src/app-next/agent-conversation/surface/ConversationSurface.tsx` — recoveryNotice 渲染条件

---

### QF-5: 对话状态栏一直"空闲"

**现状**：发送消息后状态栏不变为"思考中"。

**根因**：`narratorState` 依赖 WebSocket 推送的 session state 变更事件。如果 WebSocket 连接正常但后端没推送 state 变更，前端就一直显示 idle。

**修复**：前端发送消息后立即设置 `isWorking=true`（乐观更新），收到回复后恢复。

**文件**：`packages/studio/src/app-next/agent-conversation/runtime/useAgentConversationRuntime.ts` 或 `StudioNextApp.tsx`

---

## 深层问题（需要排查后端）

### DP-1: 对话不是流式返回

**现状**：AI 回复一口气全部显示，不是逐字打印。

**已确认**：WebSocket 连接正常（手动测试能连上）。问题在后端 agent turn runtime 调用 LLM 时没有把 `onStreamChunk` 回调连接到 WebSocket 推送。

**排查方向**：
- `packages/studio/src/api/lib/session-chat-service.ts` — 消息处理流程
- `packages/studio/src/api/lib/agent-turn-runtime.ts` — `onStreamChunk` 是否被传入
- `packages/studio/src/api/lib/provider-adapters/index.ts` — `generate` 是否用了 streaming

---

### DP-2: 没有工具调用卡片展示

**现状**：对话中看不到 Agent 调用了什么工具。

**根因**：可能和流式问题相关——工具调用事件通过 WebSocket 推送，如果推送链路有问题就看不到。也可能是 `toolCalls` 字段在消息对象里为空。

---

### DP-3: 绑定仓库功能

**现状**：创建书籍时"已有仓库"选项需要手动输入路径，没有文件夹选择器。

**说明**：浏览器环境下 `showDirectoryPicker` API 只在 HTTPS + 安全上下文中可用，localhost HTTP 可能不支持。需要改为后端提供文件浏览 API，或者接受手动输入路径。

---

### DP-4: 资源树分组点击行为

**现状**：用户反馈"章节/候选稿/草稿/大纲与设定/叙事线"点击无法打开。

**已验证**：分组标题是折叠/展开用的，具体条目（如"书籍规则"）可以打开。但如果分组下没有条目（如"章节"为空），点击确实无反应。

**修复**：空分组显示提示文字（如"暂无章节，点击'生成下一章'开始写作"）。

---

## 执行顺序

```
1. QF-1 供应商 ID 显示（5 分钟）
2. QF-2 Context Ring 条件修复（5 分钟）
3. QF-3 pending action 传递检查（10 分钟）
4. QF-4 新会话恢复提示（5 分钟）
5. QF-5 状态栏乐观更新（10 分钟）
6. DP-1 流式传输排查（需要深入后端）
7. DP-2 工具卡片（依赖 DP-1）
8. DP-3 绑定仓库（设计决策）
9. DP-4 空分组提示（5 分钟）
```
