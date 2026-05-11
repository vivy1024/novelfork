# Agent 工具全量对齐（NarraFork Parity）

## 来源

2026-05-11 讨论确认：NovelFork Agent 必须拥有 NarraFork 叙述者的全部工具能力。用户可通过套路页（Routines）按需关闭工具，但工具本身必须存在。

当前状态：`AGENT_TOOL_PRESETS` 引用了大量工具名，但多数未注册到 `SESSION_TOOL_DEFINITIONS`、未实现 handler。

---

## 设计原则

1. **全量注册**：所有工具必须在 `session-tool-registry.ts` 的 `SESSION_TOOL_DEFINITIONS` 中有定义
2. **全量实现**：所有工具必须在 `session-tool-executor.ts` 中有可执行的 handler
3. **权限管线**：每个工具有明确的 `risk` 级别，通过 `session-tool-policy.ts` 控制
4. **套路可控**：用户可在套路页配置工具白名单/黑名单，Agent 运行时动态过滤
5. **角色预设**：`AGENT_TOOL_PRESETS` 按 Agent 角色（writer/hooks/auditor/outline 等）设置默认启用/禁用

---

## 同时清理

- ❌ 删除路径 1（`pending-action-store.ts` + `WorkbenchWritingActions` 的 REST API 直调 + `novel-write-next-handler.ts`）
- ❌ 删除 `/novel:*` 系列斜杠命令（`command-registry.ts` 中 scope="novel" 的条目）
- ✅ 保留会话元命令（`/help`、`/compact`、`/model`、`/permission`、`/fork`、`/resume`）
- ✅ 写作按钮改为：跳转到对应 Agent 对话 → 自动发送自然语言消息 → Agent 自主执行工具链

---

## Phase 1：注册已有实现（代码已有，只需接入）

### 1.1 Glob

- 来源：`packages/studio/src/api/lib/tools/GlobTool.ts`
- 注册到 SESSION_TOOL_DEFINITIONS
- executor 接入 GlobTool.execute
- 参数：`pattern`（必填）、`path`（可选，相对工作目录）
- risk: read

### 1.2 Grep

- 来源：`packages/studio/src/api/lib/tools/GrepTool.ts`
- 注册到 SESSION_TOOL_DEFINITIONS
- executor 接入 GrepTool.execute
- 参数：`pattern`（必填）、`path`（可选）、`glob`（可选文件过滤）、`context`（可选上下文行数）
- risk: read

### 1.3 EnterWorktree

- 来源：`packages/studio/src/api/lib/tools/EnterWorktreeTool.ts`
- 切换 session 工作目录到指定 git worktree
- risk: confirmed-write

### 1.4 ExitWorktree

- 来源：`packages/studio/src/api/lib/tools/ExitWorktreeTool.ts`
- 恢复 session 工作目录
- risk: read

---

## Phase 2：核心交互工具

### 2.1 AskUserQuestion

- 向用户提出结构化问题（单选/多选/自由文本）
- 前端渲染为交互卡片，用户回答后结果返回 Agent
- 参数：`questions`（问题数组，每个含 question/options/multiSelect）
- risk: read
- 前端组件：复用 `UserQuestionGate.tsx` 或新建 `AskUserQuestionCard`
- **关键**：这是 PGI 和 Guided Generation 的用户交互基础

### 2.2 EnterPlanMode

- Agent 进入计划模式，只做调查不做写入
- 前端显示"计划模式"状态标识
- risk: read

### 2.3 ExitPlanMode

- Agent 提交计划文本，等待用户批准
- 前端渲染计划卡片 + 批准/拒绝按钮
- risk: read（计划本身不写入）

### 2.4 TaskCreate

- Agent 创建/更新任务列表（todo）
- 前端渲染为可勾选的任务卡片
- 参数：`todos`（数组，每项含 id/content/status/priority）
- risk: read

---

## Phase 3：网络与浏览器

### 3.1 WebSearch

- 调用搜索 API 获取网络信息
- 参数：`query`（必填）、`allowed_domains`（可选）、`blocked_domains`（可选）
- risk: read
- 实现：调用配置的搜索 API（可接 Sub2API 网关或直接调搜索服务）

### 3.2 WebFetch

- 抓取指定 URL 内容
- 参数：`url`（必填）、`mode`（readability/screenshot/dom/smart）、`max_length`
- risk: read
- 实现：HTTP fetch + readability 提取 / Puppeteer 截图

### 3.3 Browser

- 控制浏览器进行多步交互
- 参数：`action`（launch/click/fill/screenshot/evaluate/navigate/scroll/dom/close 等）
- risk: destructive（可修改外部页面状态）
- 实现：Puppeteer/Playwright 封装
- 注意：写作场景下主要用于查阅参考资料、验证发布页面

---

## Phase 4：子代理与并行

### 4.1 Agent（子代理）

- 启动隔离子代理执行专项任务
- 参数：`prompt`、`subagent_type`（explore/plan/general）、`run_in_background`
- risk: confirmed-write（general 类型可写入）
- 实现：创建新 session，继承部分上下文，独立执行

### 4.2 Await

- 等待后台子代理或后台 Bash 任务完成
- 参数：`type`（agent/bash）、`id`、`timeout`
- risk: read

### 4.3 Send

- 向子代理发送消息
- 参数：`id`、`message`、`await`（是否等待回复）
- risk: read

### 4.4 ForkNarrator

- 创建独立叙述者（新会话）
- 参数：`mode`（fresh/fork）、`message`、`title`
- risk: confirmed-write
- 实现：调用 `createSession` + 发送初始消息

---

## Phase 5：辅助工具

### 5.1 Terminal

- 交互式终端管理（PTY）
- 参数：`action`（create/read/write/list）、`terminal_id`、`input`
- risk: destructive
- 实现：node-pty 封装

### 5.2 ShareFile

- 生成文件临时下载链接
- 参数：`path`、`compress`
- risk: read
- 实现：生成临时 HTTP 路由 + 过期清理

### 5.3 Recall

- 搜索当前会话对话历史
- 参数：`action`（search/read_conversation/read_tool_call）、`query`
- risk: read
- 实现：从 session history store 全文搜索

### 5.4 StartPipeline / EndPipeline

- 管道模式：捕获长输出为别名，最后过滤/排序
- risk: read
- 实现：session 级状态管理，工具输出缓存

### 5.5 LearningGuide

- 查询学习中心文档
- 参数：`mode`（list/search/get）、`query`、`id`
- risk: read
- 实现：从 `docs/learning/` 读取并搜索

### 5.6 Skill

- 调用已注册的技能（slash command 行为）
- 参数：`skill`（技能名）、`args`
- risk: varies（取决于技能）
- 实现：从套路/技能注册表查找并执行

### 5.7 Goals（GetGoals / AddGoal / UpdateGoal）

- 会话级目标管理
- risk: read
- 实现：session metadata 中维护目标列表

---

## 验证标准

每个 Phase 完成后：

1. `SESSION_TOOL_DEFINITIONS` 中包含该 Phase 所有工具定义
2. `getProviderSessionToolDefinitions()` 返回的工具列表包含新工具
3. Agent 对话中发送"列出你的工具"，Agent 能看到并描述新工具
4. 实际调用每个工具，确认 handler 返回正确结果（不是 `tool-handler-missing`）
5. 套路页可以禁用任一工具，禁用后 Agent 调用返回 `policy-denied`

---

## 执行顺序

```
Phase 0 — 清理（前置）
  0.1 删除 pending-action-store.ts 及相关引用
  0.2 删除 novel-write-next-handler.ts（REST API 直调版）
  0.3 删除 command-registry.ts 中 /novel:* 命令
  0.4 写作按钮改为跳转 Agent 对话 + 发送自然语言

Phase 1 — 注册已有实现
  1.1 Glob 注册 + executor 接入
  1.2 Grep 注册 + executor 接入
  1.3 EnterWorktree 注册 + executor 接入
  1.4 ExitWorktree 注册 + executor 接入

Phase 2 — 核心交互工具
  2.1 AskUserQuestion
  2.2 EnterPlanMode
  2.3 ExitPlanMode
  2.4 TaskCreate

Phase 3 — 网络与浏览器
  3.1 WebSearch
  3.2 WebFetch
  3.3 Browser

Phase 4 — 子代理与并行
  4.1 Agent（子代理）
  4.2 Await
  4.3 Send
  4.4 ForkNarrator

Phase 5 — 辅助工具
  5.1 Terminal
  5.2 ShareFile
  5.3 Recall
  5.4 StartPipeline / EndPipeline
  5.5 LearningGuide
  5.6 Skill
  5.7 Goals
```

---

## 前置条件

- v0-1-1-real-usability-fixes P0 #1（侧边栏 Agent 可见）已完成
- Agent 流式 tool_use 解析已通过验证（v0-1-0 Phase 1）

---

## 与其他 spec 的关系

| Spec | 关系 |
|------|------|
| v0-1-1-real-usability-fixes | P0 #1 是前置；本 spec 的 Phase 2 AskUserQuestion 可增强 P1 #4 大纲 Agent 流程 |
| session-memory-enhancement | Recall 工具与会话记忆增强互补 |
| character-arc-auto-tracking | Agent 使用 jingwei.read_context + Write 工具自动更新角色弧线 |
