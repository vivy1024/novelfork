# NovelFork Agent Rules

本仓库的主规则源是 `CLAUDE.md` 与 `.kiro/steering/`。任何 agent、子代理或自动化工具执行任务前，都必须优先遵守这些项目规则。

---

## 版本与发布

- **当前版本**: v0.0.6
- **版本管理**: `CLAUDE.md` 标题 → 根/包级 `package.json` → `AGENTS.md` → `CHANGELOG.md` → release commit → `git tag` → GitHub Release
- **版本变动**: 任何版本号变动必须同步更新 release 资料：`package.json`、`packages/*/package.json`、`CLAUDE.md`、`AGENTS.md`、`CHANGELOG.md`
- **任务验收**: 用户要求提交、验收完成或明确要求收尾时，视为授权执行相关验证、Git 提交与 `git push origin <branch>`；不得只停留本地提交
- **每次功能合入**: 在 `CHANGELOG.md` 的 `## Unreleased` 段下记录，并随提交一起 push
- **文档同步**: 代码、配置、流程、测试数量、构建命令、产物路径、发布状态任一变化，必须同步相关 README、`docs/`、包级 README、`CLAUDE.md`、`AGENTS.md`；文档更新本身也必须记录到 `CHANGELOG.md` Unreleased
- **正式发版时**: 将 Unreleased 内容移到新版本号下，运行 typecheck/test/compile/smoke，提交 release commit，打 `git tag vX.Y.Z`，推送提交与 tag，并上传 GitHub Release 产物
- **发布产物**: 正式分发源是 GitHub Release；必须上传 `dist/novelfork-vX.Y.Z-windows-x64.exe` 与 SHA256；本地 dist 不等于已发布
- **禁止**: 手动改版本号到未来版本、虚构 changelog 条目、只打本地 tag 或只本地构建就宣称 release 完成

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
- 活跃 spec 在 `.kiro/specs/` 根目录；`backend-contract-v1` 与 `frontend-refoundation-v1` 已完成，当前主线进入 `backend-core-refactor-v1`（6/10 已完成；Task 6 已完成 destructive service 拆分）
- 每个 spec 必须通过 typecheck + test 才能标记完成

## AI 输出原则

- AI 结果只进候选区/草稿区，用户确认后才影响正式正文
- Studio 已交付口径是 session-first 工作台；Backend Contract 与 Frontend Refoundation 已完成验收收口（12/12）：`/next` 使用 Agent Shell 路由壳，Conversation runtime、单栏 surface、模型/权限状态栏动作、Tool Result Renderer Registry、Workbench 资源树、canvas/viewer 与写作动作入口已接入，主入口已切断旧三栏 WorkspacePage 默认依赖，失败三栏实验已从 Studio typecheck 构建路径正式退役；所有按钮、资源节点和写作动作必须来自 `packages/studio/src/app-next/backend-contract/` 的真实合同 client / adapter
- 历史驾驶舱/经纬/写作面板只能作为工具结果卡片或画布组件复用，不再作为右侧主 Tab
- app-next 组件不得散写未登记 API 字符串；新增后端能力必须先补 Backend Contract 矩阵、共享类型和 contract 测试
- 不恢复 mock/fake/noop 假成功
- 未接入能力标记 unsupported；模型不支持工具循环时返回 `unsupported-tools` 或只读 / prompt-preview 降级，不伪造执行
- 数据来源必须标注 source

## 文档纪律

- 修改代码/配置/流程后必须同步受影响文档与 CHANGELOG；禁止只改实现不改文档口径
- 更新测试数量、构建命令、产物名称、端口、运行方式、发布状态时，必须全仓搜索旧口径并更新当前文档
- 删除或迁移 `.md` 前必须先读取、提取有效信息、整合到目标文档；禁止创建一次性“完成报告/修复说明/实施总结”类临时文档

## 构建与测试

- `pnpm typecheck` — 类型检查
- `pnpm --dir packages/studio exec vitest run` — 全量 Studio 测试（156 files / 898 tests）
- `pnpm --dir packages/studio compile` — 单文件编译（→ dist/novelfork.exe / dist/novelfork-vX.Y.Z-windows-x64.exe，约 117MB）
- `bun run docs:verify` — 文档验证
