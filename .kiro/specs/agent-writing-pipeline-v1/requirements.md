# Agent 写作管线 v1 — Requirements

**版本**: v1.0.0
**创建日期**: 2026-05-01
**状态**: 待审批

---

## 前置条件

1. `workspace-gap-closure-v1` 已完成 — 写作模式真生成、AI 动作真实化、中文化、删除功能
2. ChatWindow + session-chat-service 已可用（WebSocket + SQLite 持久化）
3. 所有写作 API 已稳定（writing-modes、writing-tools、bible、storage）
4. Routines 页面工具注册体系已可用

---

## 设计核心

当前 NovelFork 的创作流程是**按钮驱动的**：

```
作者点「生成下一章」→ API 调用 → 结果进候选区 → 作者点「合并」
```

目标流程是**Agent 驱动的**：

```
作者说「帮我写第 5 章，注意回收第 3 章的玉佩伏笔，保持林月的冷峻性格」
  → Agent 自动读取第 4 章、相关设定、伏笔列表
  → Agent 调用生成工具
  → Agent 调用审校工具自检
  → Agent 展示结果 + 审计报告，等作者确认
  → 作者说「好」→ Agent 保存到候选区
```

---

## Requirement 1：小说创作工具必须注册到 Agent 工具系统

**User Story:** Agent 需要能调用 NovelFork 的写作能力——不只是通用工具（读文件、跑命令），还包括小说专有工具（生成章节、审校、读取设定）。

### Acceptance Criteria

1. 新增小说专有工具定义文件 `packages/studio/src/api/lib/tools/novel-tools.ts`。
2. 注册以下工具到 Agent 工具注册表：

| 工具名 | 功能 | 对应 API |
|--------|------|---------|
| `read_chapter` | 读取指定章节正文 | GET chapters/:num |
| `read_truth_file` | 读取真相文件 | GET truth-files/:file |
| `read_story_file` | 读取故事文件 | GET story-files/:file |
| `get_chapter_summaries` | 获取章节摘要列表 | bible chapter-summaries |
| `get_bible_characters` | 获取人物列表 | bible characters |
| `get_bible_events` | 获取事件/伏笔列表 | bible events |
| `get_bible_settings` | 获取设定列表 | bible settings |
| `get_pending_hooks` | 获取待处理伏笔 | story-files/pending_hooks.md |
| `get_writing_progress` | 获取写作进度 | progress API |
| `generate_continuation` | 续写当前段落 | inline-write |
| `generate_dialogue` | 生成角色对话 | dialogue/generate |
| `generate_variants` | 生成多个版本 | variants/generate |
| `generate_next_chapter` | 生成下一章 | write-next |
| `audit_chapter` | 审校章节 | audit/:chapter |
| `detect_ai_taste` | 检测 AI 痕迹 | detect/:chapter |
| `create_candidate` | 创建候选稿 | POST candidates |
| `accept_candidate` | 接受候选稿（合并/替换/另存草稿）| candidates/:id/accept |

3. 每个工具必须有清晰的参数定义、返回值 schema 和中文描述。
4. 工具注册后，现有 ChatWindow 中的 Agent 能通过 `/LOAD` 或工具列表发现并使用这些工具。
5. 验证：工具注册测试覆盖每个工具的调用成功和参数校验失败。

---

## Requirement 2：必须有小说创作专用 Agent 角色

**User Story:** 作者不需要每次告诉 Agent"你是一个网文作者，帮我做......"。系统应该提供预设的小说创作 Agent 角色，自带领域知识。

### Acceptance Criteria

1. 新增至少 3 个小说创作专用 Agent 预设（子代理类型）：

| Agent | 系统提示词核心 | 工具权限 |
|-------|--------------|---------|
| **探索 Agent** | 分析当前作品状态，输出当前应该关注的重点 | 所有读取工具 |
| **写作 Agent** | 根据规划和上下文生成正文内容 | 读取工具 + 生成工具 |
| **审计 Agent** | 检查连续性、设定一致性、AI 味、字数合理性 | 读取工具 + 审校工具 |

2. 每个 Agent 的系统提示词必须包含：
   - 网文创作的领域知识（题材特征、节奏规则、爽点设计、伏笔管理）
   - 当前作品的基本信息（书名、题材、目标字数、章节规模）
   - 使用工具的指导（什么场景用什么工具）

3. Agent 预设保存到 routines 子代理配置中，通过 `/api/routines` API 持久化。
4. 作者在 ChatWindow 中创建新会话时能选择这些 Agent 角色。
5. 验证：Agent 预设的持久化/读取测试通过。

---

## Requirement 3：Agent 必须能获取当前作品上下文

**User Story:** Agent 不应该从头开始了解作品——它应该能自动获取当前打开的作品和章节信息。

### Acceptance Criteria

1. 当 ChatWindow 会话绑定到某本书时（通过 session 的 projectId = bookId），Agent 的系统提示词自动注入：
   - 书名、题材、当前章节数
   - 最近 3 章的摘要
   - 当前待回收的伏笔列表
   - 当前焦点（从 `current_focus.md`）

2. 注入的内容来自已有 API（books、bible、truth-files），不新增存储。
3. Agent 首次调用时不需要作者手动粘贴上下文——上下文已自动注入 system prompt。
4. 验证：session chat 测试覆盖 book 绑定后上下文注入。

---

## Requirement 4：必须有最小可用的多 Agent 写作流程

**User Story:** 作者说"写下一章"，Agent 自动完成「探索→规划→写作→审计→展示结果」的全流程，而不是只做一个步骤。

### Acceptance Criteria

1. 新增一个「写作流程」Agent，它作为编排者，按顺序调用：
   - 探索 Agent（分析当前状态）
   - 写作 Agent（生成正文）
   - 审计 Agent（检查质量）
2. 结果以结构化的方式展示给作者：
   - 生成的正文
   - 审计报告（连续性问题、AI 味评分、伏笔状态更新建议）
   - 可执行的动作按钮（接受/修改/重新生成）
3. 流程中任何一步失败时，向作者报告具体失败原因，不假装成功。
4. 验证：集成测试覆盖完整流程（mock LLM 响应）。

---

## Requirement 5：Agent 不能绕过非破坏性写入原则

**User Story:** Agent 调用生成工具后，结果不能直接覆盖正式章节。

### Acceptance Criteria

1. 所有 Agent 调用的生成工具 SHALL 将结果写入候选稿或草稿，不得直接修改正式章节。
2. Agent 展示结果后 SHALL 等待作者确认，才能执行 accept 操作。
3. Agent 不得在作者未确认的情况下自动调用 `accept_candidate` 工具。
4. 验证：Agent 测试覆盖非破坏性写入路径。

---

## Requirement 6：必须复用现有基础设施

**User Story:** 作为开发者，Agent 系统不能另起炉灶——必须复用 ChatWindow、session-chat-service、Routines 和现有 API。

### Acceptance Criteria

1. 小说工具注册复用现有 tool registry（`packages/studio/src/api/lib/tools/` 或 `packages/core/src/registry/`）。
2. Agent 预设复用现有 Routines 子代理系统（`routines-api.ts`、`/api/routines`）。
3. Agent 调用 LLM 复用现有 session-chat-service 和 LLM runtime service。
4. 上下文注入复用现有 `GET /api/sessions/:id/chat` WebSocket 协议的 snapshot 机制。
5. 不新建独立的路由或 websocket 端点。

---

## Requirement 7：必须有测试覆盖

**User Story:** 作为开发者，Agent 工具和流程必须有自动化测试。

### Acceptance Criteria

1. 每个小说工具必须有测试覆盖：成功调用、参数校验失败。
2. Agent 预设的持久化/读取有测试覆盖。
3. 多 Agent 流程有集成测试（mock LLM）。
4. `bun run typecheck` + `bun run test` 全量通过。

---

## Non-goals

- 不做独立的 Agent 运行时（复用现有 ChatWindow + session-chat-service）
- 不做 UI 重构（ChatWindow 已有完整 UI）
- 不做 Agent 并行执行（v1 串行：探索→写作→审计）
- 不做 Agent 训练/fine-tuning
- 不做 Agent 记忆系统（复用现有 session message history）
- 不做驾驶舱聚合 API（Agent 直接调用各数据源）
