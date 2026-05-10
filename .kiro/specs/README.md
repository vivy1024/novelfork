# Kiro Specs 索引

本目录记录 NovelFork 的 Kiro specs。已完成 spec 归档到 `archive/`，当前 active spec 保留在本目录下。

## 当前状态

**当前 active 主线：** `novel-writing-features` — 小说写作特有功能开发。

| 当前 Spec | 任务数 | 状态 |
|---|---:|---|
| `novel-writing-features` | 7 Phases / 60+ tasks | 🟡 Active |
| `functionality-audit` | 17 (P0-P3) | ✅ 全部完成；缺口清单已生成 |
| `narrafork-ui-parity` | 15 | ⏸️ 暂停 |
| `v0-1-0-release-readiness` | 23 | ⏸️ 暂停（20/23） |

## 功能缺口清单

`functionality-audit/gaps-from-archived-specs.md` 从 37 个归档 spec 中提取了所有未实现功能。**全部已实现：**

| 优先级 | 功能 | 状态 |
|--------|------|------|
| **P0** | PGI 用户回答交互 | ✅ UserQuestionGate 组件 |
| **P0** | Guided Plan 批准/拒绝 | ✅ 同上，复用 permission 机制 |
| **P1** | Tier 1 问卷 UI | ✅ QuestionnaireWizard 集成建书流程 |
| **P1** | 多 Agent 编排可见执行链 | ✅ WorkflowProgressCard |
| **P2** | 写作工具面板 | ✅ WritingToolsPanel（7 种工具） |
| **P2** | 驾驶舱增强 Tab | ✅ 经纬摘要 + 候选稿摘要 |
| **P3** | Onboarding 教学 | ✅ FirstRunDialog + 空态引导 |
| **P3** | Checkpoint/Rewind UI | ✅ CheckpointPanel + listCheckpoints API |
| **P3** | 学习中心 | ✅ 9 篇文档 + /next/learn 页面 |

详见：[gaps-from-archived-specs.md](./functionality-audit/gaps-from-archived-specs.md)

## 归档 Spec 索引

`archive/` 下共 37 个已完成或已废弃的 spec：

| 分类 | Spec |
|------|------|
| 核心引擎 | agent-writing-pipeline-v1, claude-codex-novel-agent-v1, web-agent-runtime-v1 |
| 前端工作台 | novel-creation-workbench-complete-flow, studio-ide-layout-v1, frontend-refoundation-v1, frontend-live-wiring-v1, studio-frontend-rewrite, studio-frontend-integration-v1 |
| 写作功能 | writing-modes-v1, writing-tools-v1, writing-presets-v1, ai-taste-filter-v1 |
| 经纬与叙事 | novel-bible-v1, onboarding-and-story-jingwei, longform-cockpit-v1 |
| 对话与会话 | conversation-parity-v1, agent-native-workspace-v1 |
| 供应商与设置 | provider-integration-rewrite, provider-runtime-control-plane-v1, real-provider-model-runtime |
| 基础设施 | backend-contract-v1, backend-core-refactor-v1, storage-migration, engineering-foundation-v1 |
| 平台与合规 | narrafork-platform-upgrade, platform-compliance-v1, novelfork-narrafork-closure |
| UI 质量 | novelfork-ui-v1, ui-live-parity-hardening-v1, ui-quality-cleanup, workspace-gap-closure-v1 |
| 清理与退役 | legacy-source-retirement-v1, old-frontend-decommission, project-wide-real-runtime-cleanup, real-functionality-closure |
| 其他 | desktop-app-window, docs-system-rearchitecture |

## NarraFork 参考资料

`.narrafork-reference/` 目录包含从 NarraFork 0.4.2 爬取的第一手参考：

| 文件 | 内容 |
|------|------|
| `API-REFERENCE.md` | 完整 API 端点 |
| `UI-COMPONENTS.md` | DOM 结构 + 状态指示器行 + 设置→对话数据流 |
| `PROVIDERS.md` | 三种 API 模式 + Codex 多账号 + 额度管理 |
| `GAPS.md` | 功能差距清单 |
| `assets/` | 核心 JS 模块（api/useNarrator/useModels/status-registry/i18n） |
