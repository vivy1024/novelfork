# v0.1.0 体验验证 — 第二轮发现

## 日期：2026-05-11

## 流式传输调试结论

### 已确认
- **后端流式已修通**：Anthropic adapter 走 streaming 路径，`broadcastStreamChunk` 成功发送到 1 个 transport
- **问题在前端渲染**：WebSocket 收到 `session:stream` envelope，但页面没有逐字显示
- **端口冲突是之前的干扰因素**：旧 exe 占 4567，新 exe 被迫用 4569，浏览器连旧端口导致消息丢失

### 前端流式渲染排查方向
- `ws-envelope-reducer.ts` line 88：`session:stream` case 调用 `appendStreamChunk`
- `appendStreamChunk` 在 `runtime/message-transforms.ts`
- 需要检查：
  1. 是否正确创建了 streaming message（临时 assistant 消息）
  2. 是否设置了 `streamingMessageId`（触发 `AnimatedMarkdown` 渲染）
  3. React 状态更新是否触发了 `MessageStream` 组件重渲染
- NarraFork 用 `useRef + requestAnimationFrame` 批量渲染避免频繁 re-render

---

## 新发现的 bug

### B-1: 回复消息出现在用户消息上面
- 发送"你好"后，AI 回复出现在用户消息的上方
- 可能是 `appendStreamChunk` 创建临时消息时插入位置错误
- 或者消息列表排序逻辑有问题

### B-2: fork 对话创建成功但没跳转
- 右键"从此处分叉"执行了（侧边栏出现了新会话）
- 但页面没有导航到新会话

### B-3: 回退消息触发上下文压缩
- 右键"回退到此处"应该精确删除该消息及之后的消息
- 实际触发了 compact（压缩整个上下文）
- NarraFork 的删除是只删一条不影响其他

### B-4: 同时出现两处回复
- 新开的 fork 会话发消息后，回复出现在两个地方
- 可能是 WebSocket 连接绑定了错误的 session

---

## NarraFork 压缩 UX 参考

### 压缩流程
1. 用户点击"立即压缩"（或自动触发）
2. 左侧状态栏显示"正在压缩..." + 橙色 spinner
3. 摘要模型在对话中生成压缩摘要
4. 完成后对话流中显示 `✦ 上下文已压缩`（橙色可点击链接）
5. 点击展开"压缩摘要"弹窗（Markdown 格式，包含目标/指令/发现等结构化内容）
6. 弹窗底部有"撤回压缩"和"编辑"按钮
7. 右键菜单也把压缩卡片当消息处理

### 与 NovelFork 当前的差距
| NarraFork | NovelFork |
|-----------|-----------|
| 压缩摘要可见、可编辑、可撤回 | 压缩是黑盒，用户看不到摘要内容 |
| 状态栏显示"正在压缩..." | 无压缩状态指示 |
| 压缩卡片在对话流中 | 无压缩卡片 |
| 摘要模型生成结构化摘要 | compact 只是发指令给后端 |

---

## Context Ring 问题

### 根因
用户的模型 contextWindow 值为 0（获取模型列表时不再硬编码）。用户在详情页修改 contextWindow 值后：
1. `onBlur` 触发 `onUpdateModel` 保存到 provider store ✅
2. 但模型下拉的数据来自 `providerClient.listModels()`，页面加载时只调用一次
3. 保存后不会自动刷新模型池 → Context Ring 条件 `maxTokens > 0` 不满足

### 修复方案
- 方案 A：保存 contextWindow 后触发模型池刷新
- 方案 B：Context Ring 直接从 provider store 读取 contextWindow（不依赖模型池缓存）
- 方案 C：获取模型列表时，如果 API 没返回 contextWindow，用合理默认值（如 200000）而不是 0

---

## 右键菜单问题

### 当前实现 vs 应该的行为

| 操作 | 当前行为 | 应该的行为（参考 NarraFork） |
|------|---------|---------------------------|
| 回退到此处 | 调用 compact（压缩全部） | 精确删除该消息及之后的消息 |
| 从此处分叉 | 创建 fork 但不跳转 | 创建 fork 并导航到新会话 |
| 编辑并重新生成 | 弹出编辑框 | 同（但需要验证是否工作） |
| 删除 | 调用 compact | 只删除这一条消息 |
| 压缩到此消息前 | 调用 compact | 同（这个是对的） |

### 修复方向
需要后端支持精确的消息删除/截断 API：
- `DELETE /api/sessions/:id/messages/:messageId` — 删除单条
- `POST /api/sessions/:id/truncate` — 截断到指定消息（删除之后的）

当前只有 `compact`（压缩），没有精确删除。

---

## 待修优先级

```
1. [前端] 流式渲染修复（appendStreamChunk → React 重渲染）
2. [前端] 消息排序 bug（回复出现在用户消息上面）
3. [前端] Context Ring 数据刷新
4. [后端] 精确消息删除/截断 API
5. [前端] fork 跳转
6. [前端] 压缩 UX（摘要卡片、状态指示）
7. [清理] 去掉调试日志
```
