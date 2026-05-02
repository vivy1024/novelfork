# NovelFork Agent Rules

本仓库的主规则源是 `CLAUDE.md` 与 `.kiro/steering/`。任何 agent、子代理或自动化工具执行任务前，都必须优先遵守这些项目规则。

---

## 版本与发布

- **当前版本**: v0.0.3
- **版本管理**: `CLAUDE.md` 标题 → `package.json` → `AGENTS.md` → `CHANGELOG.md` → `git tag`
- **版本变动**: 任何版本号变动必须同步更新 release 资料：`package.json`、`CLAUDE.md`、`AGENTS.md`、`CHANGELOG.md`；正式发布还必须提交、打 `git tag vX.Y.Z` 并推送提交与 tag
- **每次功能合入**: 在 `CHANGELOG.md` 的 `## Unreleased` 段下记录
- **正式发版时**: 将 Unreleased 内容移到新版本号下，打 `git tag vX.Y.Z`
- **禁止**: 手动改版本号到未来版本、虚构 changelog 条目

## 废弃代码处理纪律

- 废弃前端、废弃路由、历史 Provider 或旧兼容入口一旦阻塞编译/测试，优先删除、迁移为真实复用资产，或从构建路径中正式退役。
- 禁止为了兼容废弃代码而新增 shim、空实现、假 provider、假 routes、noop adapter，或任何只为"让旧代码继续编译"的低质量兼容层。
- 旧代码备份以 Git 历史为准；不得把旧前端源码复制到主源码树内继续被扫描、编译或误判为当前事实。
- 若旧模块仍有价值，必须按当前新工作台边界重构为真实组件/API/类型，而不是用兼容层续命。

## 当前前端边界

- `packages/studio/src/main.tsx` 与 `packages/studio/src/app-next/**` 是 Studio 当前前端入口。
- 不再恢复旧 routes / 旧 provider / 旧 shell。遇到旧代码阻塞时，删除或迁移，不做假兼容。

## Spec 驱动开发

- 新功能必须先写 spec（`requirements.md` → `design.md` → `tasks.md`）再实现
- 归档目录：`.kiro/specs/archive/`
- 活跃 spec 在 `.kiro/specs/` 根目录（当前无活跃 spec）
- 每个 spec 必须通过 typecheck + test 才能标记完成

## AI 输出原则

- AI 结果只进候选区/草稿区，用户确认后才影响正式正文
- 不恢复 mock/fake/noop 假成功
- 未接入能力标记 unsupported，不伪造
- 数据来源必须标注 source

## 构建与测试

- `bun run typecheck` — 类型检查
- `bun run test` — 全量测试（137 files / 801 tests）
- `bun run compile` — 单文件编译（→ dist/novelfork.exe 115MB）
- `bun run docs:verify` — 文档验证
