# Kiro Specs Execution Guardrails

本目录记录 NovelFork 的 Kiro specs。已完成 spec 归档到 `archive/`，当前 active spec 保留在本目录下。

## 当前状态

**当前 active 主线：** 后端能力合同 → 前端重建 → 前端 live 接线 → 旧源码退役 → 对话能力补齐 → 后端核心整理 → UI 真实接线与 parity 硬化 → v0.1.0 全量发布准备。

当前不再继续把 `novelfork-ui-v1` 作为实现主线。该 spec 记录了“sidebar + 全宽对话”的过渡方案，但已被更完整的 `backend-contract-v1` 与 `frontend-refoundation-v1` 取代；后续主线已依次完成前端 live 接线、旧源码退役、对话能力补齐与后端核心整理。`ui-live-parity-hardening-v1` 作为硬化主线，专门修复真实浏览器暴露的 UI 组件未闭环、设置页硬编码、对话窗口运行态不透明与 Claude/Codex CLI parity 口径失真问题。2026-05-07 手工 UI 对比后，新增 `v0-1-0-release-readiness` 作为全量发布准备主线：用户明确要求完整功能才发布 v0.1.0，因此必须把产品入口、作品工作台、叙述者中心、会话页、设置/Provider/Routines、干净 root 验活、spec 归档与 GitHub Release 产物统一纳入发布阻塞门槛。该 spec 以 7778 端口 NarraFork 实测和本地 Claude/Codex 源码/文档为参考源，但所有 NovelFork 可见能力必须绑定自身真实合同。新功能仍必须遵守真实后端合同、Agent Shell + Writing Workbench 边界和后端 route/service 分层纪律。

| 当前 Spec | 任务数 | 状态 |
|---|---:|---|
| `backend-contract-v1` | 9 | ✅ 已完成（9/9 已完成） |
| `frontend-refoundation-v1` | 12 | ✅ 已完成（12/12 已完成） |
| `frontend-live-wiring-v1` | 10 | ✅ 已完成（10/10 已完成） |
| `legacy-source-retirement-v1` | 10 | ✅ 已完成（10/10 已完成） |
| `conversation-parity-v1` | 13 | ✅ 已完成（13/13 已完成） |
| `backend-core-refactor-v1` | 10 | ✅ 已完成（10/10 已完成） |
| `ui-live-parity-hardening-v1` | 14 | ⏳ 执行中（13/14 已完成；资源主链路、Shell session/recovery sync、SettingsTruthModel、模型/Agent runtime、provider callable、对话透明化、Claude/Codex parity baseline 与设置/会话浏览器 E2E 已闭环；最终文档收口待后续任务） |
| `v0-1-0-release-readiness` | 20 | ⏳ 待执行（0/20；requirements/design/tasks 已创建；覆盖完整功能发布门槛、UI 成品化、干净 root 验活、spec 归档与 v0.1.0 Release） |
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

1. 新功能必须先写 spec（requirements → design → tasks）再实现。
2. 新前端先走 `backend-contract-v1`，所有 UI 能力必须来自真实 route / WebSocket / session tool 合同，并通过 `packages/studio/src/app-next/backend-contract/` 的集中 contract client / adapter 访问。
3. `frontend-refoundation-v1` 已完成新前端结构底座；`frontend-live-wiring-v1` 负责把已有 Conversation runtime、Writing Workbench 和 Tool Result Renderer 接入真实 `/next` 路由。
4. `legacy-source-retirement-v1` 负责删除旧三栏、旧 ChatWindow、windowStore 会话事实源和未挂载 route 残留；删除前必须迁移 current consumer。
5. `conversation-parity-v1` 参考 Claude Code CLI，只实现对 NovelFork 有价值的 resume/fork、slash、compact、tool policy、headless、checkpoint/rewind，不复制终端 TUI。
6. `backend-core-refactor-v1` 是后端整理主线：只在合同稳定后拆分后端巨型 route/service。
7. `ui-live-parity-hardening-v1` 是当前硬化主线：所有“UI 可用”声明必须通过真实浏览器路径证明，设置页状态必须有真实来源；NovelFork 借鉴 NarraFork 设置页和对话窗口的信息架构，但不得硬编码 NarraFork 字段；Claude/Codex parity 必须标 current/partial/planned/non-goal。
8. `v0-1-0-release-readiness` 是 v0.1.0 发布准备主线：完整功能、真实 UI 体验、干净 root 验活、归档和 Release 产物全部达标前不得发布 v0.1.0。
9. 不恢复 mock/fake/noop 假成功。
10. AI 输出只进候选区，不直接覆盖正文。
11. 旧前端已退役，不新增旧前端代码。
12. 未接入能力标记 unsupported，不伪造成功。
