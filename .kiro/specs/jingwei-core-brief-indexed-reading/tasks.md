# Implementation Plan

## Overview

本计划实现 Jingwei 从“全量上下文注入”升级为“核心包 + 分类目录 + 按需分页阅读”的读取协议，并为后续分类导入、摘要/详情分离和 UI 可视化打基础。执行顺序优先保证兼容层不破坏现有调用，再逐步引入新工具与新读取模型。

## Tasks

- [ ] 1. ENABLER: 扩展 `packages/novel-plugin/src/engine/jingwei/types.ts` 与相关类型，加入 `JingweiReadCategory`、`JingweiDetailLevel`、核心包/目录/分类读取结果类型，以及 `summaryMd` 兼容字段的类型约束。
- [ ] 2. ENABLER: 新建 `packages/novel-plugin/src/engine/jingwei/read-model/` 下的基础模块（category-map、entry-summary、token-budget），把分类归属、摘要 fallback、token 估算与预算裁剪抽成可复用函数。
- [ ] 3. FEATURE: 实现 `buildJingweiBrief` 与 `buildJingweiIndex`，让 `read_brief` 可以返回核心包、分类目录、推荐下一步阅读建议、dropped 条目和省略摘要。
- [ ] 4. FEATURE: 实现 `readJingweiCategory` 与 `searchJingwei`，支持按分类分页、detailLevel、tokenBudget、sceneText 相关性排序，以及关键词/别名/标签搜索。
- [ ] 5. FEATURE: 新增 `jingwei.read_brief`、`jingwei.read_category`、`jingwei.search` 三个工具 schema，并把 `jingwei.read_context` 改成兼容层，明确 `mode=full` 不再表示无界全量读取。
- [ ] 6. FEATURE: 更新 `packages/novel-plugin/src/handlers/jingwei-read.ts` 与工具注册逻辑，让旧入口路由到新的读取模型，并保持旧字段 `items`、`totalTokens`、`droppedEntryIds` 的兼容输出。
- [ ] 7. FEATURE: 更新相关 agent prompt / tool 使用说明，明确默认先读核心包和目录，再按任务逐类读取，禁止把 `read_context mode=full` 作为默认路径。
- [ ] 8. ENABLER: 为 `story_jingwei_entry` 增加 `summary_md` 迁移与仓储兼容读取，保证没有摘要时自动 fallback 生成短摘要，不影响旧数据。
- [ ] 9. FEATURE: 实现分类导入/分类归档的数据流与导入报告，至少能将原始经纬候选分类到标准 category，并返回未分类、重复、超长摘要化与需确认条目。
- [ ] 10. GUARD: 补充单元测试与合同测试，覆盖核心包预算、分类目录统计、分页读取、搜索命中、兼容层行为、摘要 fallback、以及 `read_context` 不再鼓励全量读取。
- [ ] 11. DOCS: 同步更新经纬系统架构、故事经纬流程与开发指引，说明新的核心包 + 目录 + 按需阅读协议和导入报告口径。
- [ ] 12. FEATURE: 运行聚焦验证，使用真实 book 数据或测试数据验证 `read_brief`、`read_category`、`search` 的输出大小、分页行为和工具返回结构，确认不会再触发全量导入/全量读取型 token 膨胀。
