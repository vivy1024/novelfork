# Kiro Specs 索引

本目录记录 NovelFork 的 Kiro specs。已完成/过时 spec 归档到 `archive/`，当前 active spec 保留在本目录下。

---

## Active Specs

| Spec | 状态 | 说明 |
|------|------|------|
| `docs-rewrite-v3` | 🔥 当前执行 | 重写 docs 为够准、够短、可验证的文档中心；保留 `learning/` 与 `codegraph/`。 |
| `ide-file-tree-and-tabs` | 📋 待执行 | IDE 文件树与标签页体验改进。 |
| `lore-memory-boundary` | 📋 待执行 | 经纬静态 Lore 与动态叙事记忆边界治理。 |
| `narrative-wave-memory` | 📋 待执行 | 叙事浪潮记忆能力建设。 |
| `writing-panel-triage` | 📋 待执行 | 写作面板问题整理与收口。 |

---

## 已完成 Specs（近期）

| Spec | 完成日期 | 成果 |
|------|---------|------|
| `simplify-writing-model-codewiki` | 2026-06-21 | 候选稿/草稿主概念清理、正式章节结果流、CodeWiki 第一入口与维护规则。 |
| `agent-tool-gaps` | 2026-05-31 | Agent 工具缺口补全：pipeline.revise / pipeline.import_chapters / rewrite.apply / style.import / style.get_profile。PipelineRunner 已删除，Agent 工具层为唯一执行层。 |

---

## 执行纪律

- 执行任何 spec 前必须同时读取 `requirements.md`、`design.md`、`tasks.md`。
- 完成任务不等于完成需求；必须满足 requirements 的验收条件。
- 用户可见能力必须有实际验证证据，不能只靠文档声明。
- 文档相关 spec 必须运行 `bun run docs:verify` 与 `bun run docs:drift`。

---

## 归档 Specs

`archive/` 下保存已完成/过时 spec。归档内容只作为历史参考，不作为当前事实入口。

---

## 非 Spec 参考资料

### `.narrafork-reference/`

从 NarraFork 0.4.2 爬取的第一手参考，**不是 spec，不产生任务**。用于设计对标时查阅。

| 文件 | 内容 |
|------|------|
| `API-REFERENCE.md` | NarraFork 完整 API 端点 |
| `UI-COMPONENTS.md` | DOM 结构 + 状态指示器 + 设置→对话数据流 |
| `PROVIDERS.md` | 三种 API 模式 + Codex 多账号 + 额度管理 |
| `CONVERSATION-INTERNALS.md` | WebSocket 事件、流式渲染、工具状态机 |
| `PROVIDER-AND-NARRATOR-MANAGEMENT.md` | 供应商、权限、叙述者创建 |
| `FRONTEND-LOGIC.md` | 前端逻辑分析 |
| `ARCHITECTURE-ANALYSIS.md` | 架构分析 |
