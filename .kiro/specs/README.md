# Kiro Specs Execution Guardrails

本目录记录 NovelFork 的 Kiro specs。所有 spec 已归档到 `archive/`。

## 当前状态

**全部 spec 已完成并归档。** 下一个 spec 待制定。

| 已归档 Spec | 任务数 | 状态 |
|---|---|---|
| `novel-creation-workbench-complete-flow` | 53 | ✅ |
| `workspace-gap-closure-v1` | 25 | ✅ |
| `agent-writing-pipeline-v1` | 15 | ✅ |
| `longform-cockpit-v1` | 15 | ✅ |
| `engineering-foundation-v1` | 10 | ✅ |
| 其他 14 个历史 spec | ~190 | ✅ |
| **总计** | **~308** | |

## 归档清单

完整清单见 `archive/` 目录。归档 spec 作为历史、参考或可复用资产来源。

## 当前总原则

1. 新功能必须先写 spec（requirements → design → tasks）再实现
2. 不恢复 mock/fake/noop 假成功
3. AI 输出只进候选区，不直接覆盖正文
4. 旧前端已退役，不新增旧前端代码
5. 未接入能力标记 unsupported，不伪造成功
