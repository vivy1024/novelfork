# Kiro Specs 索引

本目录记录 NovelFork 的 Kiro specs。已完成 spec 归档到 `archive/`，当前 active spec 保留在本目录下。

---

## Active Specs

| Spec | 任务数 | 状态 | 说明 |
|------|-----:|------|------|
| `v0-1-0-release-readiness` | 23 | ⏸️ 暂停（20/23） | 发布前验收 |
| `v0-1-0-experience-and-pipeline-fix` | 23 | 📋 规划完成 | 整合 P0-P3 全部体验阻塞+管线修复 |
| `character-arc-auto-tracking` | 10 | ✅ 实现完成，待浏览器验证 | Hook+规则引擎+LLM可选 |
| `template-market-v2` | 14 | ✅ 实现完成，待浏览器验证 | 26流派+用户自建+远程市场 |
| `session-memory-enhancement` | 8 | ✅ 实现完成，待浏览器验证 | fork追溯+Context Ring菜单 |

### 已整合进 `v0-1-0-experience-and-pipeline-fix` 并删除的旧 Spec

| 旧 Spec | 说明 |
|------|------|
| `book-management-and-writing-flow-v2` | P0-P2 断裂点审计 + 功能缺口 |
| `workbench-interaction-redesign-v1` | 5 Agent 窗口 + 即时工具弹窗 |
| `jingwei-type-unification-v1` | Bible → Jingwei 类型统一 |
| `experience-blockers.md` | QF-1~5, DP-1~4 |
| `experience-blockers-round2.md` | B-1~4, 流式/右键/压缩 |

---

## 归档 Specs（41 个）

`archive/` 下已完成或已废弃的 spec：

| 分类 | Spec |
|------|------|
| **核心引擎** | agent-writing-pipeline-v1, claude-codex-novel-agent-v1, web-agent-runtime-v1 |
| **前端工作台** | novel-creation-workbench-complete-flow, studio-ide-layout-v1, frontend-refoundation-v1, frontend-live-wiring-v1, studio-frontend-rewrite, studio-frontend-integration-v1 |
| **写作功能** | writing-modes-v1, writing-tools-v1, writing-presets-v1, ai-taste-filter-v1, novel-writing-features |
| **经纬与叙事** | novel-bible-v1, onboarding-and-story-jingwei, longform-cockpit-v1 |
| **对话与会话** | conversation-parity-v1, agent-native-workspace-v1 |
| **供应商与设置** | provider-integration-rewrite, provider-runtime-control-plane-v1, real-provider-model-runtime |
| **基础设施** | backend-contract-v1, backend-core-refactor-v1, storage-migration, engineering-foundation-v1 |
| **平台与合规** | narrafork-platform-upgrade, platform-compliance-v1, novelfork-narrafork-closure |
| **UI 质量** | novelfork-ui-v1, ui-live-parity-hardening-v1, ui-quality-cleanup, workspace-gap-closure-v1, narrafork-ui-parity |
| **审计与缺口** | functionality-audit |
| **清理与退役** | legacy-source-retirement-v1, old-frontend-decommission, project-wide-real-runtime-cleanup, real-functionality-closure |
| **其他** | desktop-app-window, docs-system-rearchitecture |

---

## 非 Spec 参考资料

### `.narrafork-reference/`

从 NarraFork 0.4.2 爬取的第一手参考，**不是 spec，不产生任务**。用于设计对标时查阅。

| 文件 | 内容 | 状态 |
|------|------|------|
| `API-REFERENCE.md` | NarraFork 完整 API 端点 | 参考完毕 |
| `UI-COMPONENTS.md` | DOM 结构 + 状态指示器行 + 设置→对话数据流 | 参考完毕，已对标 |
| `PROVIDERS.md` | 三种 API 模式 + Codex 多账号 + 额度管理 | 参考完毕 |
| `CONVERSATION-INTERNALS.md` | WebSocket 事件、流式渲染、工具状态机 | 参考完毕 |
| `PROVIDER-AND-NARRATOR-MANAGEMENT.md` | 供应商、权限、叙述者创建 | 参考完毕 |
| `FRONTEND-LOGIC.md` | 前端逻辑分析 | 参考完毕 |
| `ARCHITECTURE-ANALYSIS.md` | 架构分析 | 参考完毕 |
| `GAPS.md` | NarraFork 功能差距清单（含未转化为 spec 的功能） | 见下方 |

### `GAPS.md` 中未转化为 spec 的功能

以下功能在 GAPS.md 中记录但**从未创建正式 spec**。对于 NovelFork（小说写作工具）来说，大部分是 coding agent 特有功能，不需要实现：

| 功能 | 是否需要 | 理由 |
|------|---------|------|
| 章节系统（react-flow 图 + fork/merge） | ❌ 不需要 | coding agent 特有，小说不需要 worktree |
| 终端集成（xterm.js） | ❌ 不需要 | coding agent 特有 |
| 容器管理（podman） | ❌ 不需要 | coding agent 特有 |
| 工作区（多叙述者） | ❌ 不需要 | 小说场景一个会话够用 |
| IM 网关（钉钉/飞书/微信/QQ） | ❌ 不需要 | v0.1.0 不需要 |
| 多用户管理 | ❌ 不需要 | 本地单用户工具 |
| PixiJS 渲染器 | ❌ 不需要 | 实验性功能 |
| 消息右键菜单（回退/分叉/压缩） | ✅ 已实现 | ContextMenu 已有 |
| 文件修改追踪 | ✅ 已实现 | FileChangesPanel |
| 段落压缩 | ✅ 已实现 | Context Ring + compactSession |
| Codex 额度可视化 | ⚠️ 可选 | 仅 Codex 用户需要 |
| 权限细节（白名单/黑名单） | ⚠️ 可选 | toolPolicy 已有基础 |
| 浏览器会话管理 | ⚠️ 可选 | 当前无浏览器工具 |
| 通知声音 | ⚠️ 可选 | 锦上添花 |

---

## Spec 实现现状对照

### 调研文档路线图 vs 实现状态

来源：`docs/90-参考资料/小说写作与AI调研/01-小说写作与AI调研.md` 第十章路线图

| 阶段 | 包 | Spec | 实现状态 |
|------|---|------|---------|
| P0 | storage-migration | ✅ archive/storage-migration | ✅ 完成 |
| P0 | novel-bible-v1 | ✅ archive/novel-bible-v1 | ✅ 完成（4表+三种可见性+经纬） |
| P0 | ai-taste-filter-v1 | ✅ archive/ai-taste-filter-v1 | ✅ 完成（12特征+朱雀API） |
| P0 | onboarding-and-story-jingwei | ✅ archive/onboarding-and-story-jingwei | ✅ 完成 |
| P0 | writing-presets-v1 | ✅ archive/writing-presets-v1 | ✅ 完成（6流派→26流派升级） |
| P1 | writing-tools-v1 | ✅ archive/writing-tools-v1 | ✅ 完成 |
| P1 | writing-modes-v1 | ✅ archive/writing-modes-v1 | ✅ 完成 |
| P1 | platform-compliance-v1 | ✅ archive/platform-compliance-v1 | ✅ 完成 |
| P2 | coding-agent-workbench | — 不需要 spec | ❌ 不做（后续参照 NarraFork 学习中心） |
| P2 | template-market-v1 → v2 | ✅ template-market-v2 | ✅ 实现完成，待验证 |
| P3 | progressions-tracking | ✅ character-arc-auto-tracking | ✅ 实现完成，待验证 |
| P3 | session-object-v2 | ✅ session-memory-enhancement | ✅ 实现完成，待验证 |

### 本次会话新增实现（未经 spec 的直接修复）

| 改动 | Commit | 说明 |
|------|--------|------|
| 对话界面三行结构对标 | 52ec6f9c | 模型完整名称/权限完整文字/计时器/文字按钮 |
| truthFile → jingwei 全局重命名 | 8424c859 + c10cd12f | 90+ 文件架构债务清理 |
| 仪表盘"当前提供方"修复 | 9bc9d622 | 显示用户配置的默认模型 |
| 顶部栏补齐 7 图标 | 0ca38022 | 代码折叠/固定/图片 |
| Agent 写作会话自动加载书籍上下文 | e6ac1fe4 | buildAgentContext async 自动加载 |
| 资源树过滤内部文件 + 空文件隐藏 | 9ee3377f | jingwei_sections.json 等不暴露 |
| 书籍右键删除 + 归档会话删除 | 11494568 | 前端缺失入口补齐 |
| InkOS 伏笔兑现规则合并 | 227f8c9b | hook 账硬对应 + 连续短段硬规则 |
