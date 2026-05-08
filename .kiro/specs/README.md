# Kiro Specs Execution Guardrails

本目录记录 NovelFork 的 Kiro specs。已完成 spec 归档到 `archive/`，当前 active spec 保留在本目录下。

## 当前状态

**当前 active 主线：** `claude-codex-novel-agent-v1` 纠偏主线：NovelFork 必须对标 Claude Code CLI / Codex CLI 的 Agent runtime、CLI/headless、工具、权限、会话、设置与套路控制能力，并在此基础上兑现小说创作端到端工作流。

历史主线“后端能力合同 → 前端重建 → 前端 live 接线 → 旧源码退役 → 对话能力补齐 → 后端核心整理 → UI 真实接线与 parity 硬化 → v0.1.0 全量发布准备”仍作为可复用资产和事实记录保留，但不再代表功能完成。复核确认：大量已完成任务是为了靠近功能而做的合同、重构、壳层、接线、退役和守卫，不能替代当前 Studio/CLI/headless 的端到端创作验收。`v0-1-0-release-readiness` release 动作继续暂停；Task21-23 不继续推进，直到 `claude-codex-novel-agent-v1` 重新定义 NovelFork 的 Agent 产品化完成标准。

当前不推翻已有前端思考：叙事线 / 资源面、创作画布、叙述者、设置页和套路页均保留为产品结构。新主线要求把叙述者接成 Claude/Codex-class Agent 主操作面，把叙事线接成剧情上下文面，把画布接成候选稿/计划/diff/工具结果面，把设置和套路页接成真实 Agent runtime 控制台。新功能仍必须遵守真实后端合同、Agent Shell + Writing Workbench 边界和后端 route/service 分层纪律。

| 当前 Spec | 任务数 | 状态 |
|---|---:|---|
| `claude-codex-novel-agent-v1` | 38 | ⏳ 执行中（27/38；Phase 0-5 完成，Phase 6-9 需要真实接入叙事线/经纬/写作模式/MCP/hooks/subagents + E2E + 文档） |
| `backend-contract-v1` | 9 | ✅ 已完成（9/9 已完成） |
| `frontend-refoundation-v1` | 12 | ✅ 已完成（12/12 已完成） |
| `frontend-live-wiring-v1` | 10 | ✅ 已完成（10/10 已完成） |
| `legacy-source-retirement-v1` | 10 | ✅ 已完成（10/10 已完成） |
| `conversation-parity-v1` | 13 | ✅ 已完成（13/13 已完成） |
| `backend-core-refactor-v1` | 10 | ✅ 已完成（10/10 已完成） |
| `ui-live-parity-hardening-v1` | 14 | ⚠️ 阶段性收口（14/14 仅代表当时的 UI hardening checklist 完成；Claude/Codex parity 只能视为参考基线与 UI claim guard，不等同完整对标实现；用户已指出该口径阻塞 v0.1.0 发布，需在 `v0-1-0-release-readiness` 中重新审计） |
| `v0-1-0-release-readiness` | 23 | ⏸️ 暂停（20/23；Task19-20 已完成，release 仍暂停：GitHub Release 未创建，远端 `v0.1.0` tag 已撤回；Task21-23 等待 `claude-codex-novel-agent-v1` 重新定义 Agent 产品化完成标准后再决定是否恢复） |
| `novelfork-ui-v1` | 8 | ⏸️ 已被重建主线取代，保留作历史参考 |
| `studio-ide-layout-v1` | 30 | ❌ 归档（前端布局失败，后端功能保留） |
| `studio-frontend-integration-v1` | 10 | ❌ 归档（未完成） |
| `web-agent-runtime-v1` | 16 | ✅ 已完成（16/16 已完成） |
| `agent-native-workspace-v1` | 23 | ✅ 已完成（23/23 已完成） |

| 已归档 Spec | 任务数 | 状态 |
|---|---:|---|
| `novel-creation-workbench-complete-flow` | 53 | ✅ |
| `workspace-gap-closure-v1` | 25 | ✅ |
| `agent-writing-pipeline-v1` | 15 | ✅ |
| `agent-native-workspace-v1` | 23 | ✅ |
| `longform-cockpit-v1` | 15 | ✅ |
| `engineering-foundation-v1` | 10 | ✅ |
| 其他 14 个历史 spec | ~190 | ✅ |
| **总计** | **~395** | |

## 归档清单

完整清单见 `archive/` 目录。归档 spec 作为历史、参考或可复用资产来源。

## 当前总原则

1. 新功能必须先写 spec（requirements → design → tasks）再实现；`claude-codex-novel-agent-v1` 是当前纠偏主线。
2. NovelFork 的基础产品形态是 Claude Code CLI / Codex CLI 级 Agent 产品，小说创作是内置领域能力，不得再拆成“普通小说前端 + Claude/Codex 参考”。
3. 不推翻当前前端结构：叙事线 / 资源面、创作画布、叙述者、设置页和套路页均保留；新主线只负责把它们接入真实 runtime 和端到端工作流。
4. 设置页是 Agent Runtime Control Center，套路页是 Agent Capability Workbench；模型、权限、工具、MCP、sandbox、subagent、hooks、skills、workflow 配置必须接真实功能。
5. 所有 UI 能力必须来自真实 route / WebSocket / session tool 合同，并通过 `packages/studio/src/app-next/backend-contract/` 的集中 contract client / adapter 访问。
6. `conversation-parity-v1`、`web-agent-runtime-v1`、`agent-native-workspace-v1` 和 archive 功能 specs 作为可复用资产，但其 checkbox 不等于当前产品端到端完成。
7. 功能完成必须以 Studio 或 CLI/headless 的端到端用户路径证明；API/组件/unit test 只能证明底座完成。
8. `v0-1-0-release-readiness` release 动作暂停；完整 Agent 产品化与小说创作闭环达标前不得发布 v0.1.0。
9. 不恢复 mock/fake/noop 假成功。
10. AI 输出只进候选区，不直接覆盖正文。
11. 旧前端已退役，不新增旧前端代码。
12. 未接入能力标记 unsupported/planned/reference-only，不伪造成功。
