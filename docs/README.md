**版本**: v3.0.0
**创建日期**: 2026-06-25
**更新日期**: 2026-06-25
**状态**: current
**文档类型**: current

# NovelFork 技术文档

## 当前事实入口

- [学习中心](./learning/) — 面向作者与开发者的产品说明文档

产品行为的事实来源是**当前源码**；`docs/learning/` 是与之配套的人类可读说明。开发约定、包边界与验证纪律见仓库根 `CLAUDE.md`。

> 注意：应用内 `/learn` 页面与 LearningGuide 工具**不读这个目录**。它们的内容来自 Runtime 的 `shared/learning-content.ts` 与产品侧 `packages/novel-plugin/src/learning-contribution.ts` 里的内联双语文档。改这里不会改变应用内看到的内容，反之亦然 —— 两边需要各自维护。

写作相关的常用入口：

| 文档 | 用途 |
|------|------|
| `learning/27-writing-sop.md` | 写下一章、续写旧书、废稿重开、发布自检的动作顺序 |
| `learning/08-agent-pipeline.md` | 当前写作主链路与工具清单 |
| `learning/26-platform-writing-cards.md` | 各连载平台的字数与合规口径 |

## 目录

| 目录 | 内容 | 性质 |
|------|------|------|
| `learning/` | 产品说明文档（YAML frontmatter，仅供阅读，非应用内 `/learn` 数据源） | 手写，随功能更新 |
| `codegraph/` | `bun run codegraph` 生成的代码导航索引 | 生成物，未生成时不存在，不要手改 |
| [90-参考资料/](./90-参考资料/) | 小说写作与 AI 调研 | 背景资料 |

> 历史上这里还有 01-codewiki 到 08-测试与质量 共 8 个分类目录，已在 `7696334e` 随退役产物一并清理。它们的内容分别并入 `docs/learning/`、根 `CLAUDE.md` 与源码注释。
>
> `learning/` 与 `codegraph/` 不受 docs 治理规范头（`**版本**`/`**文档类型**` 等）管辖，因此不作为「当前事实入口」的具体文件链接列出。
