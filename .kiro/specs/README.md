# Kiro Specs 索引

本目录记录 NovelFork 的 Kiro specs。已完成 spec 归档到 `archive/`，当前 active spec 保留在本目录下。

## 当前状态

**当前 active 主线：** `conversation-surface-real-closure` — 对话页面真实闭环。

经过 11 个 spec 的迭代（~395 任务），后端 API、类型系统、session runtime、command registry、tool policy、settings truth model 已完整就绪。但对话页面的前端渲染层始终是最后被跳过的部分。本主线专注于：复用现有成熟组件、修复接线断裂、激活 dead code、浏览器截图验证。

| 当前 Spec | 任务数 | 状态 |
|---|---:|---|
| `conversation-surface-real-closure` | 10 | ⏳ 新建，待执行 |
| `v0-1-0-release-readiness` | 23 | ⏸️ 暂停（20/23；Task21-23 等待对话页面闭环后恢复） |

## 历史教训（从 11 个已归档 spec 中提取）

1. **组件重复实现**：每次新 spec 都重写对话组件而不复用 `components/` 下的成熟版本
2. **接线断裂**：按钮无 handler、props 不传入、计时器永远不显示
3. **Dead code 积累**：workflow-executor、mcp-client-runtime、subagent-runtime 有完整实现但零生产调用
4. **测试代替验活**：Vitest 组件测试通过 ≠ 浏览器可用
5. **Spec 膨胀**：每个 spec 都宣称解决了 UI 问题，但实际只解决底层合同/类型/API 层面

## 归档清单

| 已归档 Spec | 任务数 | 说明 |
|---|---:|---|
| `backend-contract-v1` | 9 | 合同层 |
| `backend-core-refactor-v1` | 9 | 后端拆分 |
| `legacy-source-retirement-v1` | 7+ | 旧代码删除 |
| `frontend-refoundation-v1` | 10+ | 新前端底座 |
| `frontend-live-wiring-v1` | 9+ | live 接线 |
| `conversation-parity-v1` | 8+ | session lifecycle/slash/compact |
| `ui-live-parity-hardening-v1` | 14 | 设置 truth model、E2E |
| `novelfork-ui-v1` | 8 | 已被 superseded |
| `claude-codex-novel-agent-v1` | 48 | Agent runtime + novel commands |
| `real-functionality-closure` | 20 | NarraFork 对标 UI 重写 |
| 其他 28 个历史 spec | ~250 | 见 archive/ |
| **总计** | **~395** | |

## 当前总原则

1. **复用现有组件**，不再重写已有成熟实现
2. **接线必须完整**，不能有无 handler 的按钮或不传入的 props
3. **Dead code 必须激活或删除**，不能继续积累
4. **浏览器截图验证**，不能只靠 Vitest 组件测试宣称完成
5. AI 输出只进候选区，不直接覆盖正文
6. 未接入能力标记 unsupported/planned/reference-only，不伪造成功
7. 功能完成必须以端到端用户路径证明
