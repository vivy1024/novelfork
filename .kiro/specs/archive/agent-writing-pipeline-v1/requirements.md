# Agent 写作管线 v1 — Requirements

**版本**: v2.0.0
**创建日期**: 2026-05-01
**修订日期**: 2026-05-01
**状态**: 待审批

---

## 前置条件

1. `workspace-gap-closure-v1` 已完成 — 写作模式真生成、AI 动作、中文化、删除功能
2. Core 层 13 个 Agent 类已存在、18 个内置工具已注册
3. ToolsTab 中 22 个 NarraFork 通用工具已定义
4. ChatWindow + session-chat-service 已可用
5. Routines 子代理系统 + `/api/routines` API 已可用

---

## Requirement 1：Agent 工具默认开关必须按角色推荐

**User Story:** 作者启动 Writer Agent 时，不应该看到 Terminal、Browser、ForkNarrator 等无关工具。Auditor Agent 不需要写文件权限，Planner Agent 可能需要联网搜索参考。

**当前事实:** ToolsTab 中所有可选工具默认全关（除 6 个核心工具），但工具开关是全局的——不是按 Agent 角色分的。作者需要手动配置每个 Agent 的工具。

### Acceptance Criteria

1. Writer Agent 默认开启：Bash, Read, Write, Edit, Grep, Glob, EnterWorktree, ExitWorktree, TodoWrite。关闭：Terminal, Browser, ForkNarrator, NarraForkAdmin, Recall, ShareFile。
2. Planner Agent 默认开启：Read, Grep, Glob, WebSearch, WebFetch, TodoWrite。关闭：Bash, Write, Edit, Terminal。
3. Auditor Agent 默认开启：Read, Grep, Glob。关闭：Write, Edit, Bash, Terminal。
4. Explorer Agent（新）默认开启：Read, Grep, Glob, Recall。所有写入工具全部关闭。
5. Architect Agent 默认开启：Read, Write, Grep, Glob, WebSearch。关闭：Bash, Terminal。
6. 作者在套路页→工具 Tab 中仍可手动覆盖。
7. 验证：每个 Agent 预设的工具列表测试通过。

---

## Requirement 2：Agent 必须有角色专属的 system prompt

**User Story:** Writer Agent 被选中后，它的 system prompt 应该包含网文创作领域知识和写作指导。Planner Agent 的 system prompt 应该专注于大纲规划。不能所有 Agent 共用一个通用 system prompt。

**当前事实:** `runAgentLoop` 在 `pipeline/agent.ts` 第 321-384 行使用硬编码的通用 system prompt，不区分 agentId。13 个 Agent 类各自有 `name` 和独立逻辑，但 system prompt 层没有差异化。

### Acceptance Criteria

1. 新增 `packages/core/src/pipeline/agent-prompts.ts`，为每种 agentId 定义专属 system prompt：
   - `writer` — 写作指导、文风建议、伏笔回收、非破坏性写入原则
   - `planner` — 大纲规划、情节点设计、节奏控制、伏笔部署
   - `auditor` — 连续性检查、设定一致性、AI 味检测、人物行为逻辑
   - `architect` — 世界观构建、规则体系、力量体系、社会结构
   - `explorer` — 只读分析、状态聚合、发现可回收伏笔、识别角色入场时机

2. `runAgentLoop` 新增 `agentId` 参数，用于选择对应的 system prompt。
3. SubAgentsTab 中用户定义的 systemPrompt 和 toolPermissions 也必须生效——如果用户为某个 Agent 定义了自定义 systemPrompt，优先使用用户的。
4. 验证：agent-prompts.ts 的 prompt 字符串非空、包含领域知识关键词测试通过。

---

## Requirement 3：必须有 Agent 上下文自动注入

**User Story:** 作者打开 Writer Agent 开始对话时，不应该手动粘贴「我现在的书名是 XXX、第 5 章、主角林月正在……」——Agent 应该自动知道当前打开的是哪本书、什么状态。

**当前事实:** session 有 `projectId` 字段可关联 bookId，但 session-chat-service 在构建消息时不注入作品上下文。Agent 不知道当前作品信息。

### Acceptance Criteria

1. 当 session.projectId 匹配某 bookId 时，在系统消息中自动注入上下文块：
   - 书名、题材、当前章节数/目标章节
   - 最近 3 章的摘要（来自 bible chapter-summaries）
   - 当前焦点（来自 current_focus.md）
   - 待回收伏笔列表（来自 bible events foreshadow + pending_hooks.md）
   - 最近审计失败章节（来自章节索引中的 auditIssues）

2. 上下文注入在 session-chat-service 构建初始消息时完成。
3. 上下文数据通过调用已有 API 获取，不新增存储。
4. 验证：session-chat-service 测试覆盖有 bookId 和无 bookId 两种上下文注入状态。

---

## Requirement 4：必须有 Explorer Agent

**User Story:** 作者说「帮我看看现在该写什么」，Agent 自动读取作品状态、分析上下文、给出建议。

**当前事实:** 13 个 Core Agent 类中没有只读的探索角色。Reader 类工具（Read/Grep/Glob）存在但没被组织成一个独立的探索 Agent。

### Acceptance Criteria

1. 新增 Explorer Agent 的 system prompt（在 agent-prompts.ts 中）。
2. Explorer Agent 的系统提示词包含：
   - "你是只读探索 Agent。你只能读取信息，不能写入任何内容。"
   - 指导：先读 current_focus → 再读 chapter_summaries → 再查 pending hooks → 再查角色列表
   - 输出格式：当前状态摘要 + 下一章 3 个方向建议 + 待回收伏笔 + 需注意的角色变化
3. Explorer Agent 在 ChatWindow 中可选（作为第 5 个预设）。
4. 验证：Explorer system prompt 测试通过。

---

## Requirement 5：必须有编排函数串联多 Agent 流程

**User Story:** 作者说「写下一章」，系统自动完成「探索→规划→写作→审计→展示」的全流程，不需要作者手动在 Agent 之间切换、传递上下文。

**当前事实:** `runAgentLoop` 是单 Agent 循环。没有多 Agent 编排函数。

### Acceptance Criteria

1. 新增 `packages/core/src/pipeline/agent-pipeline.ts`。
2. 实现 `runWritingPipeline(bookId, intent, config)` 函数，串行执行：
   - Step 1: 调用 Explorer Agent — 分析当前状态
   - Step 2: 调用 Planner Agent — 制定章节大纲（输入：探索结果）
   - Step 3: 调用 Writer Agent — 生成正文（输入：大纲）
   - Step 4: 调用 Auditor Agent — 审校正文（输入：生成的正文）
   - Step 5: 返回结果：正文 + 审计报告 + 元数据

3. 每步之间的上下文自动传递，不需要作者手动复制粘贴。
4. 任一步失败时，返回具体失败原因，不假装成功。
5. 生成结果写入候选区，不直接覆盖正文。
6. 验证：pipeline 单元测试覆盖成功流程和中间步骤失败。

---

## Requirement 6：编排函数必须有「Agent 写作」快捷入口

**User Story:** 作者在工作台不用打开 ChatWindow 手动选 Agent——工作台右侧直接有一个「Agent 写作」按钮，点击后自动启动编排流程。

**当前事实:** WorkspacePage 右侧面板有 AI 动作按钮（生成下一章/审校/去AI味等），但没有「启动 Agent 写作流程」的入口。

### Acceptance Criteria

1. WorkspacePage 右侧 AI 面板新增一个「Agent 写作」入口。
2. 点击后自动创建 Writer Agent 会话，发送「根据当前作品状态写下一章」指令。
3. 或：点击后展示一个快捷面板，让作者输入意图（如「写下一章，回收玉佩伏笔」），然后启动编排流程。
4. 验证：WorkspacePage 测试覆盖 Agent 写作入口和流程启动。

---

## Requirement 7：所有能力必须有测试覆盖

**User Story:** 作为开发者，Agent 系统必须有自动化测试，防止回归。

### Acceptance Criteria

1. Agent 工具默认开关配置有测试覆盖。
2. 每个 Agent 的 system prompt 有非空验证测试。
3. 上下文注入有 session-chat-service 测试覆盖。
4. `runWritingPipeline` 有集成测试（mock LLM 响应）。
5. `bun run typecheck` + `bun run test` 全量通过。
6. 无新增 mock/fake/noop 假成功。

---

## Non-goals

- 不做 Agent 并行执行（v1 串行）
- 不做 Agent fine-tuning
- 不做新的 Agent 类（13 个够用，只补 Explorer）
- 不做全新的 UI（复用 ChatWindow + WorkspacePage）
- 不做场景模板系统（v2）
- 不做跨书籍知识共享（v2）
