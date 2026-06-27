**版本**: v3.0.0
**创建日期**: 2026-06-25
**更新日期**: 2026-06-25
**状态**: current
**文档类型**: current

# CodeWiki

NovelFork 的代码知识库。

这个目录不是功能说明书，而是系统长期记忆：

- 记录当前已经定型的边界
- 记录已经废弃的概念
- 记录需要整理的模块
- 记录为什么做出这些决策
- 记录以后如何避免重复混乱

## 推荐阅读顺序

1. [总览](./00-overview.md)
1. [Canonical Writing Model](./architecture/canonical-writing-model.md)
1. [概念索引](./01-concepts/README.md)
1. [流程索引](./02-workflows/README.md)
1. [工具地图](./03-tool-map/README.md)
1. [存储边界](./04-storage-boundaries/README.md)
1. [模块索引](./modules/README.md)
1. [API 索引](./api/README.md)
1. [Data 索引](./data/README.md)
1. [UI 索引](./ui/README.md)
1. [删除清单](./05-deletion-list.md)
1. [Candidate / Draft / Writing Resource 代码级清单](./cleanup/candidate-draft-writing-resource-inventory.md)
1. [整理清单](./06-refactor-list.md)
1. [风险清单](./07-risk-register.md)
1. [决策日志](./08-decision-log.md)
1. [维护规则](./09-maintenance-rules.md)

## 当前重点

- 收口候选稿 / 草稿体系
- 保留正式章节
- 强化经纬与叙事记忆分层
- 将工具收敛为用户体验入口
- 避免微服务化带来的额外复杂度

## 稳定边界

| 层级 | 主概念 | 说明 |
|------|--------|------|
| 静态层 | 经纬 | 作者维护的静态参考 |
| 动态层 | 叙事记忆 | 创作过程中的动态事实 |
| 结果层 | 正式章节 | 可发布、可展示、可回溯的正文结果 |
| 配置层 | 预设 / 模板 / 节拍 | 用户可编辑的创作参数 |
| 工具层 | 文风提取 / 扩写 / 改写 / 多版本 | 用户体验入口 |

## 废弃方向

- 候选稿不再作为主产品概念
- 草稿不再作为主产品概念
- SQLite 不再作为章节资源主存储
- 不做微服务拆分，维持模块化单体
