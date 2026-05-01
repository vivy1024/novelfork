# Agent 写作管线 v1 — Tasks

**版本**: v1.0.0
**创建日期**: 2026-05-01
**状态**: 待审批

---

## 前置条件

- `workspace-gap-closure-v1` 已完成（25/25 ✅）
- ChatWindow + session-chat-service 已可用
- Routines 子代理系统已可用

---

## Phase 0：工具注册（3 tasks）

- [ ] 1. 定义小说工具 schema
  - 新建 `api/lib/tools/novel-tools.ts`
  - 定义 16 个工具的 name / description / parameters / execute
  - 复用已有 API handler 逻辑，不重复实现
  - 验证：typecheck 通过

- [ ] 2. 实现工具执行函数
  - 读取类工具：bookId 参数传入或从 session context 获取
  - 生成类工具：调用 writing-modes API 或 core 函数
  - 审校类工具：调用 audit/detect API
  - 管理类工具：调用 candidates API
  - 验证：每个工具有参数校验失败测试

- [ ] 3. 注册工具到 Agent 系统
  - 在 server 启动时调用 `registerNovelTools()`
  - 工具出现在 ChatWindow 的 tool list 中
  - 验证：工具注册测试通过；Agent 能发现并使用小说工具

---

## Phase 1：Agent 角色（3 tasks）

- [ ] 4. 定义三个 Agent 系统提示词
  - 新建 `api/lib/agent-prompts.ts`
  - 定义 novel-explorer、novel-writer、novel-auditor 的完整 system prompt
  - 包含领域知识（网文节奏、爽点、伏笔管理、题材特征）
  - 包含工具使用指导
  - 验证：prompt 字符串可正确导入、非空

- [ ] 5. 实现 Agent 角色持久化
  - 在 server 启动时将三个 Agent 预设写入 routines subAgent 配置
  - 复用 `POST /api/routines`（subAgent upsert）
  - 确保重启后 Agent 预设仍在
  - 验证：routines 测试覆盖 subAgent 持久化

- [ ] 6. 在 ChatWindow 中可选用 Agent 角色
  - NewSessionDialog 中显示三个小说 Agent 选项
  - 选择后自动设置 system prompt 和允许的工具列表
  - 验证：ChatWindow 测试覆盖 Agent 角色选择

---

## Phase 2：上下文注入（2 tasks）

- [ ] 7. 实现作品上下文构建
  - 新建 `api/lib/agent-context.ts`
  - `buildBookContext(bookId)` 函数并行调用：books API + bible summaries + pending hooks + current_focus.md
  - 返回结构化的上下文字符串，用于注入 system prompt
  - 验证：context 构建测试覆盖有数据和无数据场景

- [ ] 8. session 绑定书籍时自动注入上下文
  - 当 session.projectId 匹配 bookId 时，snapshot 的 system prompt 中自动包含上下文
  - 上下文注入在 session-chat-service 的 buildMessages 或 session recovery 流程中完成
  - 验证：session-chat-service 测试覆盖上下文注入

---

## Phase 3：多 Agent 编排（3 tasks）

- [ ] 9. 实现编排函数
  - 新建 `api/lib/agent-pipeline.ts`
  - `runWritingPipeline(bookId, userIntent)` — 串行编排：探索 → 写作 → 审计
  - `runAuditPipeline(bookId, chapterNumber)` — 审计流程
  - 每步调用 `chatCompletion`，传输上一步的上下文
  - 验证：pipeline 单元测试覆盖成功和中间步骤失败

- [ ] 10. 实现编排结果展示
  - ChatWindow 中收到 pipeline 结果后，展示结构化视图
  - 包含：生成的正文 / 审计报告 / 可执行动作
  - 复用现有 ToolCallBlock 的结果展示模式
  - 验证：ChatWindow 测试覆盖 pipeline 结果展示

- [ ] 11. 实现「写下一章」快捷入口
  - WorkspacePage 右侧面板新增一个「Agent 写作」入口
  - 点击后自动创建一个 novel-pipeline session
  - 发送「请根据当前作品状态写下一章」指令
  - 验证：WorkspacePage 测试覆盖 Agent 写作入口

---

## Phase 4：集成验证（4 tasks）

- [ ] 12. 新增工具测试
  - 为 16 个工具的 execute 函数编写测试
  - 覆盖成功调用和参数校验失败
  - 验证：`bun run test -- novel-tools.test.ts` 通过

- [ ] 13. 新增 pipeline 集成测试
  - 使用 mock LLM 响应测试完整 pipeline
  - 覆盖探索→写作→审计的完整流程
  - 验证：pipeline 测试通过

- [ ] 14. 全量 typecheck + test
  - `bun run typecheck` 通过
  - `bun run test` 全量通过
  - 验证：typecheck + vitest 均 exit 0

- [ ] 15. 更新文档
  - 更新 `docs/01-当前状态/02-Studio能力矩阵.md`，新增 Agent 写作管线能力行
  - 更新 `.kiro/specs/README.md`
  - 验证：`bun run docs:verify` 通过

---

## Done Definition

1. Agent 在 ChatWindow 中能调用小说专有工具（读章节、生成、审校等）
2. 三个小说创作 Agent 角色可用（探索/写作/审计）
3. 启动作家 Agent 时自动注入当前作品上下文
4. Agent 写作流程「探索→规划→写作→审计→展示」可用
5. Agent 生成结果进候选区，不直接覆盖正文
6. `bun run typecheck` + `bun run test` 全量通过
7. 无新增 mock/fake/noop 假成功
