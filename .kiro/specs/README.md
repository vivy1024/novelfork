# Kiro Specs Execution Guardrails

本目录记录 NovelFork 的 Kiro specs。已完成 spec 归档到 `archive/`，当前 active spec 保留在本目录下。

## 当前状态

**当前 active 主线：** 后端能力合同 → 前端重建 → 后端核心整理。

当前不再继续把 `novelfork-ui-v1` 作为实现主线。该 spec 记录了“sidebar + 全宽对话”的过渡方案，但已被更完整的 `backend-contract-v1` 与 `frontend-refoundation-v1` 取代：新前端必须先冻结真实后端合同，再基于 Agent Shell + Writing Workbench 重建，而不是继续修补失败三栏实验。

| 当前 Spec | 任务数 | 状态 |
|---|---:|---|
| `backend-contract-v1` | 9 | ✅ 已完成（9/9 已完成） |
| `frontend-refoundation-v1` | 12 | ⏳ 执行中（3/12 已完成） |
| `backend-core-refactor-v1` | 10 | ⏸️ 后续阶段（依赖前端合同稳定） |
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
| **总计** | **~362** | |

## 归档清单

完整清单见 `archive/` 目录。归档 spec 作为历史、参考或可复用资产来源。

## 当前总原则

1. 新功能必须先写 spec（requirements → design → tasks）再实现。
2. 新前端先走 `backend-contract-v1`，所有 UI 能力必须来自真实 route / WebSocket / session tool 合同，并通过 `packages/studio/src/app-next/backend-contract/` 的集中 contract client / adapter 访问。
3. `frontend-refoundation-v1` 是当前前端实现主线：Agent Shell + Backend Contract Adapter + Writing Workbench；组件内不得散写未登记 API 字符串。
4. `backend-core-refactor-v1` 是后续整理主线：只在合同稳定后拆分后端巨型 route/service。
5. 不恢复 mock/fake/noop 假成功。
6. AI 输出只进候选区，不直接覆盖正文。
7. 旧前端已退役，不新增旧前端代码。
8. 未接入能力标记 unsupported，不伪造成功。
