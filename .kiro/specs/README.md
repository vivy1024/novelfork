# Kiro Specs Execution Guardrails

本目录记录 NovelFork 的 Kiro specs。已完成 spec 归档到 `archive/`，当前 active spec 保留在本目录下。

## 当前状态

**当前 active spec：** `novelfork-ui-v1` — NarraFork 风格布局：sidebar + 全宽对话框（对标 Claude Code CLI），叙事线详情页独立（写作工作台）。回退之前失败的三栏 IDE 布局实验。

| 当前 Spec | 任务数 | 状态 |
|---|---:|---|
| `novelfork-ui-v1` | 8 | ⏳ 待执行（0/8 已完成） |
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
| **总计** | **~331** | |

## 归档清单

完整清单见 `archive/` 目录。归档 spec 作为历史、参考或可复用资产来源。

## 当前总原则

1. 新功能必须先写 spec（requirements → design → tasks）再实现
2. 不恢复 mock/fake/noop 假成功
3. AI 输出只进候选区，不直接覆盖正文
4. 旧前端已退役，不新增旧前端代码
5. 未接入能力标记 unsupported，不伪造成功
