# v0.1.0 体验与管线修复

## 概述

整合 v0.1.0 发布前必须修复的体验阻塞、架构断裂和功能缺口，形成统一执行计划。来源：

- `experience-blockers.md`（QF-1~5, DP-1~4）
- `experience-blockers-round2.md`（B-1~4, 流式/右键/压缩/Context Ring）
- `workbench-interaction-redesign-v1`（5 Agent 窗口 + 即时工具弹窗 + 选段浮动条）
- `jingwei-type-unification-v1`（Bible → Jingwei 类型统一）
- `book-management-and-writing-flow-v2`（P0-P2 断裂 + 功能缺口）

---

## P0：Agent 工具调用链路修复

### 问题

流式模式下 Anthropic/OpenAI adapter 的 streaming consumer 只解析 text_delta，**不解析 tool_use/tool_calls delta**。模型返回 tool_use 时被丢弃，导致 agent turn 收到空响应触发 `turn_failed: empty-response`。

### 影响

- Agent 无法使用任何工具（所有 session tool 形同虚设）
- 写作管线无法执行（依赖工具调用链）
- 前端看不到工具调用卡片（因为后端根本没产生 tool_use 事件）

### 修复

1. `AnthropicCompatibleAdapter.consumeAnthropicStream()` — 增加 `content_block_start(type=tool_use)` + `input_json_delta` 解析
2. `OpenAiCompatibleAdapter.consumeStream()` — 增加 `tool_calls` delta 累积解析
3. 流式结束后，如果累积了 tool_use，返回 `{ type: "tool_use", toolUses }` 而非 `{ type: "text" }`

### 验证

- 用 Anthropic 模型发送需要工具调用的消息，确认前端显示 ToolCallCard
- 确认 agent turn 循环能正常执行 tool → result → continue

---

## P0：写作动作 → Agent 管线执行

### 问题

`command-registry.ts` 注册了 `/novel:write-next` 等命令，handler 独立模块已实现，但 `command-executor.ts` 需要 `executeNovelCommand` handler，**没有代码提供这个 handler**。

### 影响的按钮

| 按钮 | Slash Command | 状态 |
|------|--------------|------|
| 生成下一章 | `/novel:write-next` | ❌ 命令未处理 |
| 续写草稿 | `/novel:draft` | ❌ 命令未处理 |
| 扩写/改写 | `/novel:preview` | ❌ 命令未处理 |
| 连续性审校 | `/novel:audit` | ❌ 命令未处理 |
| 去 AI 味检测 | `/novel:detect` | ❌ 命令未处理 |
| 伏笔建议 | `/novel:hooks` | ❌ 命令未处理 |

### 修复

在 session chat service 中提供 `executeNovelCommand` handler，接通 slash command → PipelineRunner。

---

## P1：前端对话体验修复

### B-1: 回复消息出现在用户消息上面

`appendStreamChunk` 创建临时消息时插入位置错误，或消息列表排序逻辑有问题。

### B-2: fork 对话创建成功但没跳转

侧边栏出现了新会话，但页面没有导航到新会话。

### B-3: 回退消息触发上下文压缩

"回退到此处"应该精确删除该消息及之后的消息，实际调用了 compact。需要后端支持：
- `DELETE /api/sessions/:id/messages/:messageId` — 删除单条
- `POST /api/sessions/:id/truncate` — 截断到指定消息

### B-4: 同时出现两处回复

新开的 fork 会话发消息后，回复出现在两个地方。可能是 WebSocket 连接绑定了错误的 session。

### QF-4: 新建对话显示"正在恢复会话..."

新会话（无历史消息）时不应显示恢复提示。

### QF-5: 对话状态栏一直"空闲"

前端发送消息后应立即设置 `isWorking=true`（乐观更新），收到回复后恢复。

---

## P1：写作工具面板 onRunTool 空实现

### 问题

`WritingWorkbenchRoute.tsx` 传入 `onRunTool={async () => ({})}`，导致 7/8 个工具点击后返回空 `{}`。

### 修复

实现 `onRunTool`：根据 `toolId` 和 `endpoint` 调用对应后端 API，返回结果。

---

## P1：Checkpoint/Rewind 面板不可达

`CheckpointPanel` 组件完整实现，后端 API 完整，但没有任何页面渲染它。在写作工具面板或工作台顶部栏加入 Checkpoint 入口。

---

## P2：供应商详情页体验

### QF-1: 供应商 ID 显示问题

创建供应商时用 `provider-${Date.now()}` 作为 ID，模型下拉里显示这个 ID 而不是名称。

### 供应商详情页交互

- 有改动才显示"保存变更"+"取消变更"按钮
- API 模式标签用英文专业术语（Completions / Responses / Codex）

### 模型列表获取

- 不硬编码降级列表，错误透传
- contextWindow/maxOutputTokens 为 0 时留 0 不填默认值

---

## P2：Context Ring 数据刷新

用户修改 contextWindow 后保存，模型池不刷新，Context Ring 条件 `maxTokens > 0` 不满足。

修复方案：保存 contextWindow 后触发模型池刷新，或 Context Ring 直接从 provider store 读取。

---

## P2：文风漂移输入为假数据

`StyleDriftPanel` 用硬编码的 `avgSentenceLength: 18/22, vocabularyDiversity: 0.6/0.7` 调用 API。应从书籍已有章节计算真实 style profile。

---

## P2：压缩 UX 升级

参照 NarraFork：
- 压缩摘要可见、可编辑、可撤回
- 状态栏显示"正在压缩..."
- 压缩卡片在对话流中
- 摘要模型生成结构化摘要

---

## P3：工作台交互重构

### 核心设计：每本书固定 5 个 Agent 对话窗口

| Agent | 职责 |
|-------|------|
| 写书 Agent | 引导式生成下一章（PGI 追问 → 计划确认 → 写作） |
| 伏笔 Agent | 伏笔管理、建议回收时机、埋设新伏笔 |
| 章末钩子 Agent | 生成章末钩子方案（3-5 个选项） |
| 审校 Agent | 连续性审计、矛盾检测、人设一致性检查 |
| 大纲/经纬 Agent | 生成大纲、维护经纬、添加角色/设定/势力 |

### 即时工具（不走 Agent，直接 API 弹窗）

AI 味检测、段落节奏、对话比例、全书健康、文风漂移、发布检查、导出 — 点击后直接调用后端 API，结果在弹窗中显示。

### 选段操作（画布内浮动工具条）

选中文本后出现：续写 / 扩写 / 改写 / 多版本。走 InlineWritePanel API。

### 去掉的东西

- ❌ 底部写作工具面板（WritingToolsPanel 作为独立面板）
- ❌ 顶部 6 个写作动作按钮（替换为 5 个 Agent 入口）

---

## P3：经纬类型统一（Bible → Jingwei）

### 目标

1. 统一为一套 Jingwei API，废弃 Bible 命名
2. SQL 表名保持 `bible_*` 不变（通过 repository 层屏蔽）
3. 外部消费者（studio）无感迁移

### 执行阶段

1. **类型合并**：新建统一 `JingweiContextItem`，旧字段标 deprecated
2. **Repository 层统一**：`createBible*Repository` → `createJingwei*Repository`
3. **函数名替换**：`buildBibleContext` → `buildJingweiContext` 等
4. **清理**：删除 `bible/` 兼容层、旧类型定义、更新 import

### 影响范围

- `packages/core/src/jingwei/` — 类型定义 + context/repository
- `packages/core/src/agents/` — 所有 Agent 引用
- `packages/core/src/pipeline/runner.ts` — 管线调用
- `packages/studio/src/api/routes/` — API 路由
- `packages/studio/src/app-next/` — 前端引用
- 测试文件 — 54 个

---

## P3：经纬文件夹重构

### 目标结构

```
books/<id>/jingwei/
├── 角色/
│   ├── 沈舟.md
│   └── _index.json
├── 势力/
├── 设定/
├── 伏笔/
├── 大纲/
├── 状态/
└── 规则/
```

### 迁移策略

1. 新书直接用新结构
2. 旧书保持兼容（读取时两种路径都尝试）
3. 提供一次性迁移命令

---

## P3：功能缺口

### 大纲 → 章节过渡

- 大纲编辑 UI（拖拽排序、添加/删除章节条目）
- "按大纲写第 N 章"引导流程
- PGI 引擎读取当前章节的大纲条目作为追问依据

### 状态自动更新

`current_state.md` 只在引导时生成一次。`StateValidatorAgent` 在管线末尾更新。

### 伏笔资源树可见

资源树增加"伏笔"分组，显示活跃伏笔列表，可手动添加/编辑。

---

## 执行顺序

```
Phase 1 — Agent 能力修复（P0）
  1. 流式 tool_use 解析修复（Anthropic + OpenAI adapter）
  2. 写作管线入口接通（executeNovelCommand handler）
  3. 验证：工具调用卡片可见 + 写作按钮触发管线

Phase 2 — 对话体验修复（P1）
  4. 消息排序修复（B-1）
  5. fork 跳转（B-2）
  6. 精确消息删除/截断 API（B-3）
  7. WebSocket session 绑定修复（B-4）
  8. 新会话恢复提示（QF-4）
  9. 状态栏乐观更新（QF-5）
  10. 写作工具面板 onRunTool 接通
  11. Checkpoint 面板入口

Phase 3 — 供应商与设置体验（P2）
  12. 供应商 ID/名称显示
  13. 供应商详情页保存交互
  14. 模型列表获取（不硬编码）
  15. Context Ring 数据刷新
  16. 文风漂移真实数据
  17. 压缩 UX 升级

Phase 4 — 工作台交互重构（P3）
  18. 5 Agent 窗口架构
  19. 即时工具弹窗
  20. 选段浮动工具条
  21. 经纬类型统一
  22. 经纬文件夹重构
  23. 大纲/状态/伏笔功能缺口
```

---

## 前置条件

- v0-1-0-release-readiness Task 20 已完成
- Phase 1 是所有后续 Phase 的前置（Agent 不能调工具 = 写作平台不能用）
