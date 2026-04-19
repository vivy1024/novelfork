# Changelog

本文件记录 **NovelFork** 仓库当前阶段的重要变更。

> 说明：
> 过去一段时间的 changelog 混杂了大量旧路线时期内容（PWA、旧 monorepo 叙事、InkOS 口径）。
> 为避免继续误导，当前先收敛为 NovelFork 视角的简化变更记录。

---

## Unreleased

### Docs
- 重构 docs 目录结构，统一为 `00-07` 编号体系
- 新增 `docs/00-文档命名整理规则.md`
- 新增平台纠偏文档，明确 NovelFork 当前目标是回归 NarraFork 路线
- 新增平台迁移方案、回正规划和迁移待办清单
- 删除误导性的 `docs/05-发布文档/` 整组文档
- 将旧架构、实现参考、规划、测试和历史分析重新归档到新目录
- 新增 NarraFork 依赖参考与更新日志参考文档

### Planning
- 明确当前阶段不是继续强化旧 PWA/Node 外壳，而是进行平台回正
- 形成 Bun 单入口、本地单体应用、`bun compile` 单文件分发的目标口径

### Cleanup
- 将 `VERSION_HISTORY.md` 迁入 docs 体系
- 将 `TEST_REPORT.md` 迁入 docs 体系
- 重写根目录 `README.md` 与 `ROADMAP.md`，去除 InkOS 主叙事

---

## Historical Note

如果需要查看旧路线时期的历史资料，请看：
- `docs/07-测试报告/02-历史归档/`
- `docs/04-开发指南/05-调研规划/05-版本演进历史.md`
