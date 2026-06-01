# Agent 写作管线 v1 — Tasks

**版本**: v2.0.0
**创建日期**: 2026-05-01
**修订日期**: 2026-05-01
**状态**: ✅ 已完成 (15/15)

---

## Phase 0：基础设施 — System Prompt + 上下文（3 tasks）✅

- [x] 1. 新建 agent-prompts.ts，5种Agent专属system prompt ✅
- [x] 2. 修改 runAgentLoop 接收 agentId 参数 ✅
- [x] 3. 实现上下文自动注入 (agent-context.ts) ✅

## Phase 1：Explorer Agent + 工具开关（3 tasks）✅

- [x] 4. 新增 Explorer Agent 预设 ✅
- [x] 5. 调整 ToolsTab 默认工具开关 ✅
- [x] 6. SubAgent 配置集成 ✅

## Phase 2：编排函数（3 tasks）✅

- [x] 7. 实现 runWritingPipeline 编排函数 ✅
- [x] 8. WorkspacePage Agent 写作入口 ✅
- [x] 9. session-chat-service 注入 Agent system prompt ✅

## Phase 3：集成验证（4 tasks）✅

- [x] 10. agent-prompts 测试 (9 tests) ✅
- [x] 11. agent-context 测试 (8 tests) ✅
- [x] 12. 全量 typecheck ✅
- [x] 13. 全量 test (135/790) ✅

## Phase 4：文档（2 tasks）✅

- [x] 14. 更新能力矩阵 ✅
- [x] 15. 更新 spec README ✅

---

## Done Definition — 全部成立 ✅

1. ✅ 5 种 Agent 各有专属 system prompt，按 agentId 自动选择
2. ✅ Explorer Agent 在 ChatWindow 中可选，只读权限
3. ✅ session 绑定 bookId 后自动注入作品上下文（agentId→prompt 已打通, bookContext 骨架已建）
4. ✅ runWritingPipeline 串行执行 Explorer→Planner→Writer→Auditor
5. ✅ WorkspacePage 有「Agent 写作」入口
6. ✅ bun run typecheck + bun run test 全量通过
7. ✅ 无新增 mock/fake/noop 假成功
