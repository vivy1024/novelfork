# 文档同步 v0.7.1 — Tasks

## Overview

将 docs/ 目录与 v0.6.0→v0.7.1 的 556 个 commit 同步。以 git log、CHANGELOG.md、代码实际为信息源。

## Tasks

### Phase 1：当前状态文档（最高优先）

- [ ] 1. 更新 `docs/01-当前状态/01-项目当前状态.md`：全面重写"当前已真实可用的能力"和"当前透明过渡"段落。删除对 WritingToolsPanel、旧编辑器选段写作的引用。新增 Artifact Surfacing、上下文可见性、ToolConfigBar、去AI味闭环、文风仿写。
- [ ] 2. 更新 `docs/01-当前状态/02-Studio能力矩阵.md`：逐项核对能力状态，标记新增能力为 ✅，删除已废弃能力。
- [ ] 3. 更新 `docs/01-当前状态/03-当前执行主线.md`：主线从 plugin-architecture-split 更新为 context-visibility-system + writing-tools-completion。
- [ ] 4. 更新 `docs/01-当前状态/04-产品能力重新验收矩阵.md`：按竞品对比表的最新状态更新验收结论。

### Phase 2：用户指南

- [ ] 5. 更新 `docs/02-用户指南/02-小说管理与创作.md`：编辑器现在是纯 TipTap 编辑器（无 BubbleMenu），选段写作通过 Agent 对话完成。驾驶舱底部面板（预设/节拍/质量/警告）。
- [ ] 6. 更新 `docs/02-用户指南/03-AI辅助写作.md`（如存在）：Agent 对话面板的 ToolConfigBar + AgentQuickActions + Artifact Surfacing 体验。5 个 Agent 角色及其独特能力。
- [ ] 7. 检查 `docs/02-用户指南/` 其他文件中对 WritingToolsPanel 的引用并删除。

### Phase 3：产品与流程

- [ ] 8. 更新 `docs/03-产品与流程/01-小说创作流程.md`：写作工具功能拆散后的新流程（Agent 对话驱动，不再有独立工具面板）。
- [ ] 9. 更新 `docs/03-产品与流程/04-故事经纬流程.md`：新增上下文可见性（tracked/global/nested）、visibleAfterChapter、自动链接、buildJingweiContext 组装流程。
- [ ] 10. 更新 `docs/03-产品与流程/03-AI输出与候选稿流程.md`：新增 Artifact Surfacing（候选稿生成时实时流式展示）。

### Phase 4：架构与设计

- [ ] 11. 更新 `docs/04-架构与设计/01-系统架构总览.md`：反映插件化架构（novel-plugin 独立包）。
- [ ] 12. 更新 `docs/04-架构与设计/06-长篇驾驶舱设计.md`：差距修复后的实际状态（StatusBar/PresetPanel/BeatPanel/QualityPanel 全部接通真实数据）。
- [ ] 13. 更新 `docs/04-架构与设计/10-经纬系统架构.md`：新增上下文可见性系统设计（buildJingweiContext + auto-linker + ToolConfigBar 接通）。

### Phase 5：API 文档

- [ ] 14. 在 `docs/06-API与数据契约/` 中补充新增 API：`PUT /api/books/:id/beat-template`、`POST/GET /api/books/:id/style-profile`、`POST/GET /api/books/:id/chapters/:ch/link(s)`、`PUT /api/sessions/:id`（toolPolicy）。

### Phase 6：清理与验证

- [ ] 15. 全文搜索 docs/ 中对 `WritingToolsPanel`、`InlineWritePanel`、`BubbleMenu`、`onInlineWrite` 的引用并删除/替换。
- [ ] 16. 全文搜索 docs/ 中版本号 `v0.1.0`、`v0.5.0`、`v0.6.0` 的过时引用，更新为 v0.7.1 或删除。
- [ ] 17. 运行 `bun run docs:verify`（如果存在）确认文档链接和格式正确。
