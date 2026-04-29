# NovelFork Agent Rules

本仓库的主规则源是 `CLAUDE.md` 与 `.kiro/steering/`。任何 agent、子代理或自动化工具执行任务前，都必须优先遵守这些项目规则。

## 废弃代码处理纪律

- 废弃前端、废弃路由、历史 Provider 或旧兼容入口一旦阻塞编译/测试，优先删除、迁移为真实复用资产，或从构建路径中正式退役。
- 禁止为了兼容废弃代码而新增 shim、空实现、假 provider、假 routes、noop adapter，或任何只为“让旧代码继续编译”的低质量兼容层。
- 旧代码备份以 Git 历史为准；不得把旧前端源码复制到主源码树内继续被扫描、编译或误判为当前事实。
- 若旧模块仍有价值，必须按当前新工作台边界重构为真实组件/API/类型，而不是用兼容层续命。

## 当前前端边界

- `packages/studio/src/main.tsx` 与 `packages/studio/src/app-next/**` 是 Studio 当前前端入口。
- 不再恢复旧 routes / 旧 provider / 旧 shell。遇到旧代码阻塞时，删除或迁移，不做假兼容。
