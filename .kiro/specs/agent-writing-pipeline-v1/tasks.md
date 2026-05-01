# Agent 写作管线 v1 — Tasks

**版本**: v2.0.0
**创建日期**: 2026-05-01
**修订日期**: 2026-05-01
**状态**: 待审批

---

## 前置条件

- `workspace-gap-closure-v1` 已完成（25/25 ✅）
- Core 13 Agent 类 / 18 内置工具 / 22 NarraFork 工具均已存在
- ChatWindow + session-chat-service + Routines API 可用

---

## Phase 0：基础设施 — System Prompt + 上下文（3 tasks）

- [ ] 1. 新建 `agent-prompts.ts`，定义 5 种 Agent 专属 system prompt
  - 新建 `packages/core/src/pipeline/agent-prompts.ts`
  - 定义 `AGENT_SYSTEM_PROMPTS`: writer, planner, auditor, architect, explorer
  - 每个 prompt 包含：领域知识 + 工具使用指导 + 输出规范 + 安全约束
  - `getAgentSystemPrompt(agentId)` 按 agentId 前缀匹配选择 prompt
  - 验证：prompt 非空测试通过

- [ ] 2. 修改 `runAgentLoop` 接收 `agentId` 参数
  - 修改 `packages/core/src/pipeline/agent.ts`
  - `AgentLoopOptions` 新增 `agentId?: string`
  - system prompt 从 `getAgentSystemPrompt(agentId)` 获取，非通用硬编码
  - SubAgent 自定义 systemPrompt 优先（通过 session 元数据传入）
  - 验证：现有 agent loop 测试仍通过（不带 agentId 时使用默认 prompt）

- [ ] 3. 实现上下文自动注入
  - 新建 `packages/studio/src/api/lib/agent-context.ts`
  - `buildBookContext(bookId)` — 并行调用 books API + bible summaries + pending hooks + current_focus
  - 在 `session-chat-service.ts` 的消息构建阶段，检测 session.projectId → 注入上下文
  - 验证：session-chat-service 测试覆盖有 bookId / 无 bookId 两种注入状态

---

## Phase 1：Explorer Agent + 工具开关（3 tasks）

- [ ] 4. 新增 Explorer Agent 预设
  - `agent-prompts.ts` 中已有 explorer prompt（Task 1）
  - 在 `ChatWindow.tsx` 的 `SESSION_PRESETS` 中新增：`{ id: "explorer", title: "Explorer", label: "探索 Explorer", defaultSessionMode: "chat", defaultPermissionMode: "read" }`
  - Explorer 工具集：Read, Grep, Glob, Recall, read_truth_files, get_book_status（全部只读）
  - 验证：Explorer 在 NewSessionDialog 中可选

- [ ] 5. 调整 ToolsTab 默认工具开关
  - 修改 `AVAILABLE_TOOLS` 的默认 `enabled` 值
  - Bash/Read/Write/Edit/Grep/Glob → true（核心创作工具）
  - EnterWorktree/ExitWorktree/TodoWrite → true（工作区管理）
  - Terminal/Browser/ForkNarrator/NarraForkAdmin/Recall/ShareFile → false（运维工具默认关）
  - WebSearch/WebFetch → false（联网工具默认关）
  - 验证：ToolsTab 测试通过，默认开关值正确

- [ ] 6. SubAgent 配置集成测试
  - SubAgentsTab 中定义的 systemPrompt 和 toolPermissions 能正确传递到 session 创建
  - 验证：routines 测试覆盖 SubAgent CRUD + session 关联

---

## Phase 2：编排函数（3 tasks）

- [ ] 7. 实现 `runWritingPipeline` 编排函数
  - 新建 `packages/core/src/pipeline/agent-pipeline.ts`
  - `runWritingPipeline(bookId, userIntent, config)` — 串行：Explorer → Planner → Writer → Auditor
  - 每步结果传给下一步作为上下文
  - 任一步失败返回 `{ error: string, step: number }`，不假装成功
  - 验证：pipeline 单元测试 mock LLM 覆盖成功/失败流程

- [ ] 8. 实现编排结果的 ChatWindow 展示
  - 收到 pipeline 完成后，ChatWindow 展示结构化结果
  - 正文区域 + 审计报告区域 + 操作按钮（接受/修改/重新生成）
  - 复用 ToolCallBlock 的结果展示模式
  - 验证：ChatWindow 测试覆盖 pipeline 结果渲染

- [ ] 9. WorkspacePage 新增「Agent 写作」入口
  - 右侧面板→写作 Tab→新增「Agent 写作」按钮/输入区
  - 作者输入意图 → 启动 `runWritingPipeline` → 结果在 ChatWindow 中展示
  - 自动创建/复用当前 book 的 Writer session
  - 验证：WorkspacePage 测试覆盖 Agent 写作入口和流程启动

---

## Phase 3：集成验证（4 tasks）

- [ ] 10. 新增 agent-prompts 测试
  - 5 种 Agent 的 system prompt 非空 + 包含领域知识关键词
  - `getAgentSystemPrompt` 按 prefix 匹配正确
  - 验证：`bun run test -- agent-prompts.test.ts` 通过

- [ ] 11. 新增 agent-pipeline 集成测试
  - mock LLM 响应，测试完整 Explorer→Planner→Writer→Auditor 流程
  - 覆盖中间步骤失败、空结果、超时
  - 验证：pipeline 测试通过

- [ ] 12. 新增 agent-context 测试
  - `buildBookContext(bookId)` 有数据/无数据场景
  - session 绑定/不绑定 bookId 的上下文注入
  - 验证：agent-context 测试通过

- [ ] 13. 全量 typecheck + test
  - `bun run typecheck` 通过
  - `bun run test` 全量通过
  - `bun run docs:verify` 通过

---

## Phase 4：文档更新（2 tasks）

- [ ] 14. 更新能力矩阵
  - 更新 `docs/01-当前状态/02-Studio能力矩阵.md`：
    - 新增 Agent 写作管线能力行（Explorer/Planner/Writer/Auditor + 编排函数）
    - 更新工具清单行（Core 18 + NarraFork 22 = 40 个工具）
  - 验证：`bun run docs:verify` 通过

- [ ] 15. 更新 spec README
  - `.kiro/specs/README.md` 中 `agent-writing-pipeline-v1` 状态更新为已完成
  - 标注下一阶段 spec 优先级
  - 验证：文档内容一致

---

## Done Definition

1. 5 种 Agent 各有专属 system prompt，按 agentId 自动选择
2. Explorer Agent 在 ChatWindow 中可选，只读权限
3. session 绑定 bookId 后自动注入作品上下文
4. `runWritingPipeline` 串行执行 Explorer→Planner→Writer→Auditor
5. WorkspacePage 有「Agent 写作」入口
6. `bun run typecheck` + `bun run test` 全量通过
7. 无新增 mock/fake/noop 假成功
