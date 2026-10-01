**版本**: v3.0.0
**创建日期**: 2026-06-25
**更新日期**: 2026-06-25
**状态**: current
**文档类型**: current

# NovelFork 技术文档

## 当前事实入口

- [学习中心](./learning/) — 面向作者的两条线：「用 NovelFork 写书」（`learning/book/`）与「网文写作课」（`learning/craft/`）

产品行为的事实来源是**当前源码**；`docs/learning/` 是与之配套的人类可读说明。开发约定、包边界与验证纪律见仓库根 `CLAUDE.md`。

> 应用内学习中心（`/next/learn`）的 NovelFork 文章由 `bun scripts/generate-learning-contribution.ts` 从 `docs/learning/` 生成到 `packages/novel-plugin/src/learning-contribution.generated.ts`；改完文档要重新生成，测试会核对两者一致。Runtime 自带的通用教程不在这个目录。叙述者用的学习中心查询工具目前只读 Runtime 自带教程。

写作相关的常用入口：

| 文档 | 用途 |
|------|------|
| `learning/book/04-write-next-chapter.md` | 写下一章：写 → 改 → 收尾 |
| `learning/book/10-foreshadow-memory.md` | 伏笔与记忆：章后结算、记忆过期、重新结算 |
| `learning/book/14-platforms.md` | 各连载平台的字数与合规口径 |

## 目录

| 目录 | 内容 | 性质 |
|------|------|------|
| `learning/` | 小说产品教程与网文写作课，生成后贡献给应用内学习中心 | 手写，随功能更新 |
| [design/](./design/) | 架构评估与写作功能设计 | 设计资料 |
| [路线与任务.md](./路线与任务.md) | 当前阶段任务与验收口径 | 规划 |
| `market/` | 题材模板与预设市场数据 | 静态资源与索引 |
| `codegraph/` | `bun run codegraph` 生成的代码导航索引 | 生成物，未生成时不存在，不要手改 |
| [90-参考资料/](./90-参考资料/) | 小说写作与 AI 调研 | 背景资料 |

> 历史上这里还有 01-codewiki 到 08-测试与质量 共 8 个分类目录，已在 `7696334e` 随退役产物一并清理。它们的内容分别并入 `docs/learning/`、根 `CLAUDE.md` 与源码注释。
>
> `learning/` 与 `codegraph/` 不受 docs 治理规范头（`**版本**`/`**文档类型**` 等）管辖，因此不作为「当前事实入口」的具体文件链接列出。
