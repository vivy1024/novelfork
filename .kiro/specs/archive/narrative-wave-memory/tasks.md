# Implementation Plan

## Overview

本计划从已批准的 Narrative Wave Memory Kiro spec（`requirements.md` + `design.md`）生成，按“分层终局架构”执行：先完成 0 新 native 依赖的 MVP（ContextCard、多通道检索、预算打包、NarrativeEvent/reducer、pipeline.write 接入），再实现 embedding exact cosine 中期层，最后实现 Wave Memory 叙事化终局算法层（tag graph、EPA、残差金字塔、脉冲传播、测地线重排）和评估/可观察性。

所有任务必须遵守 spec 边界：不引入外部向量数据库/GraphDB/LangChain；LLM 不直接查 SQL、不直接改经纬、不自动覆盖 canon；用户可见写作链路必须用实际运行验证。

## Tasks

- [x] 1. 建立 Narrative Memory 模块骨架与类型定义
  - 新增 `packages/novel-plugin/src/engine/narrative-memory/` 目录。
  - 新增 `types.ts`，定义 `NarrativeContextCard`、`NarrativeContextPackage`、`NarrativeFact`、`NarrativeEvent`、`NarrativeRetrievalDiagnostics`、`BuildNarrativeContextInput`、channel/source/purpose union types。
  - 为公开输入/落库对象提供 Zod schema，遵循项目 `type Xxx` + `XxxSchema` 约定。
  - 确保所有字段使用 readonly，内部 import 使用 `.js` 后缀。
  - 验证：新增类型编译通过，无跨 `core/studio` 的小说领域依赖。

- [x] 2. 实现 Narrative Memory SQLite 存储初始化
  - 新增 `storage.ts`，负责创建/访问 `narrative_fact`、`narrative_event`、`narrative_retrieval_log` 表。
  - 使用 `CREATE TABLE IF NOT EXISTS` 和必要索引，避免破坏旧书。
  - 提供 `ensureNarrativeMemorySchema(storage)`、`insertNarrativeFact`、`queryNarrativeFacts`、`insertNarrativeEvent`、`updateNarrativeEventStatus`、`insertRetrievalLog`。
  - 不引入新 native 依赖；复用现有 SQLite storage 获取方式。
  - 验证：针对空数据库重复调用 schema 初始化应幂等。

- [x] 3. 实现 ContextCard adapter 基础层
  - 新增 `context-card.ts`。
  - 实现从 SceneSpec、JingweiReadableItem/StoryJingweiEntryRecord、RuntimeStateSnapshot、HookRecord、章节摘要、style/preset 文本到 `NarrativeContextCard` 的 adapter。
  - 每个 adapter 必须设置 `sourceType`、`channel`、`reason`、`brief`、`estimatedTokens`、`validFromChapter/validUntilChapter`（可推断时）。
  - 对旧 `jingweiContext?: string` 提供 compatibility card adapter。
  - 验证：单元测试覆盖每类 adapter 的字段完整性和 reason 非空。

- [x] 4. 实现 facts 查询与 1-hop 扩展
  - 新增 `facts.ts`。
  - 实现 `upsertNarrativeFact`、`searchFactsByEntities`、`expandFactsOneHop`、`factToContextCard`。
  - 1-hop 扩展限制每个实体最多 3 条，总量受调用参数限制。
  - 查询必须应用 `currentChapter` 过滤，禁止返回未来 facts。
  - 验证：单元测试覆盖 direct hit、1-hop expansion、future leakage blocked、duplicate facts dedupe。

- [x] 5. 实现 FTS/LIKE 精确召回通道基础工具
  - 新增 `channels/fts-channel.ts` 或配套 `fts.ts` 工具函数。
  - 实现 `sanitizeFtsQuery`，避免 MATCH 特殊字符导致报错。
  - 优先使用 SQLite FTS5；不可用或查询失败时 fallback 到 LIKE。
  - 检索范围覆盖 title、aliases、tags、brief/summary、content。
  - 每个结果输出 matchReason。
  - 验证：单元测试覆盖普通关键词、人名/别名、特殊字符、FTS fallback。

- [x] 6. 实现 MVP 通道接口与并行调度协议
  - 新增 `channels/types.ts` 或在 `types.ts` 中定义 `NarrativeRetrievalChannel`、`ChannelResult`。
  - 每个 channel 返回 `{ channel, status, cards, latencyMs, warnings, error? }`。
  - 通道错误必须捕获并写入 diagnostics，不向上抛出阻断整体。
  - 实现通用 `runChannelWithTimeout`，默认 2-3 秒超时。
  - 验证：单元测试覆盖成功、error、timeout 三态。

- [x] 7. 实现 SceneSpec Channel
  - 新增 `channels/scene-spec-channel.ts`。
  - 从当前 SceneSpec 生成本章目标、场景列表、constraints/hard rules ContextCards。
  - 设置最高 priority，并将 constraints 分配到 hard channel 或 scene-spec source card。
  - 验证：给定含多场景 SceneSpec，应生成稳定卡片和非空 reason。

- [x] 8. 实现 Hard Channel
  - 新增 `channels/hard-channel.ts`。
  - 读取 canon layer 经纬、book_rules、SceneSpec constraints、平台/合规硬规则。
  - hard channel 卡片标记不可直接 drop 的预算属性。
  - 当 hard channel 为空时返回 warning，不阻断。
  - 验证：构造 canon 经纬和 book_rules，确认输出进入 hard section；空数据返回 warning。

- [x] 9. 实现 State Channel
  - 新增 `channels/state-channel.ts`。
  - 读取 dynamic layer 经纬、runtime current state、角色/地点/组织当前状态、当前有效 narrative facts。
  - 根据 sceneSpec characters/location、entities、sceneText 进行实体命中排序。
  - 应用章节有效期过滤，禁止未来状态注入。
  - 验证：测试当前状态命中、旧状态过期、未来状态过滤。

- [x] 10. 实现 Hooks Channel
  - 新增 `channels/hooks-channel.ts`。
  - 读取 RuntimeState hooks、pending_hooks、foreshadowing 经纬分类。
  - 对本章涉及实体/地点/主题相关伏笔加权。
  - 对长时间未提及但未解决伏笔提高 priority，并在 reason 中说明。
  - 验证：测试 active hook、resolved hook、长期未提及 hook 的排序。

- [x] 11. 实现 Timeline Channel
  - 新增 `channels/timeline-channel.ts`。
  - 读取最近 3-5 章摘要、runtime timeline、previousChapterTail compatibility card。
  - 当 sceneSpec 或 sceneText 命中旧事件时，允许通过 FTS/facts 召回更早摘要。
  - 验证：测试最近章节摘要注入、前章尾部转换、未来章节摘要不注入。

- [x] 12. 实现 Facts Channel
  - 新增 `channels/facts-channel.ts`。
  - 从 sceneSpec、entities、sceneText 中收集 query entities。
  - 调用 facts 查询与 1-hop 扩展，输出 fact ContextCards。
  - 每条 fact card 必须包含来源、有效章节、confidence 和 reason。
  - 验证：测试直接 facts、1-hop facts、预算上限和去重。

- [x] 13. 实现 Style Channel
  - 新增 `channels/style-channel.ts`。
  - 读取写作预设、节拍、文风规则、合规约束、style drift hints 的可用信息。
  - 预算较小，不得覆盖 hard/state 优先级。
  - 验证：在有 preset/beat 的测试书中输出 style section；无配置时 skipped/empty 不报错。

- [x] 14. 实现 card merge、dedupe 与基础 scoring
  - 新增 `merge.ts` 和 `scoring.ts`。
  - 按 spec 实现同 sourceType+sourceId、同 fact tuple、同 entryId/title 去重。
  - 实现 MVP score：channelBoost、entityMatchBoost、layerBoost、chapterProximityBoost、importanceBoost、ftsBoost、factConfidenceBoost、recencyBoost、tokenCostPenalty。
  - hard 与非 hard 重复时保留 hard channel。
  - 验证：单元测试覆盖重复来源、重复 fact、hard 优先、score breakdown 基础字段。

- [x] 15. 实现 channel-aware budget packer
  - 新增 `budget.ts`。
  - 复用/适配 `applyTokenBudgetWithDegradation` 思路，支持按 channel 分桶预算。
  - 每张卡提供 full/normal/summary/brief levels；hard channel 不直接 drop。
  - 输出 packed cards、degraded cards、dropped cards、分通道 token。
  - 验证：单元测试覆盖 hard 不丢、非 hard 降级/丢弃、总预算缩放、dropped/degraded diagnostics。

- [x] 16. 实现 section formatter 与 diagnostics
  - 新增 `diagnostics.ts` 和 section formatting 工具。
  - 将 packed cards 格式化成 `<hard_constraints>`、`<narrative_state>`、`<timeline_context>`、`<active_hooks>`、`<known_facts>`、`<style_rules>`、`<semantic_memory>`。
  - diagnostics 记录 totalMs、channelStats、totalEstimatedTokens、droppedCardIds、degradedCards、warnings。
  - retrieval log 写入 `narrative_retrieval_log`。
  - 验证：单元测试检查 section 标签稳定、reason 保留、diagnostics 完整。

- [x] 17. 实现 buildNarrativeContext 统一入口
  - 新增 `build-narrative-context.ts`。
  - 调度 MVP channels，merge/scoring/budget/format/diagnostics/log 全流程。
  - 支持 purpose：write_chapter、continue、revise、audit、outline。
  - 支持 `maxTokens`、`chapterNumber`、`sceneSpec`、`sceneText`、`entities`。
  - 验证：集成测试构造测试书，调用 `buildNarrativeContext(write_chapter)` 返回 hard/state/timeline/hooks/facts/style diagnostics。

- [x] 18. 实现 NarrativeEvent 风险分类与基础写入
  - 新增 `events.ts`。
  - 实现 `classifyNarrativeEventRisk`、`createNarrativeEvent`、`persistNarrativeEvents`。
  - 风险规则遵循 spec：canon/world_fact_introduced/重大关系变化默认 high/pending；低风险 dynamic 可 applied。
  - 保存 evidenceText 和 confidence。
  - 验证：单元测试覆盖 eventType 风险、confidence 阈值、canon pending。

- [x] 19. 实现 NarrativeEvent reducer 初版
  - 新增 `reducer.ts`。
  - 实现 `applyNarrativeEvents(bookId, events)`。
  - applied event upsert narrative_fact；pending/rejected 只更新事件状态。
  - 禁止自动应用 canon 覆盖；同章重复事件去重。
  - reducer 错误不阻断章节保存，但写 diagnostics/log。
  - 验证：单元测试覆盖 low-risk applied、world_fact_introduced pending、重复事件幂等、reducer error fallback。

- [x] 20. 接入 pipeline.write 上下文构建
  - 修改 `packages/novel-plugin/src/handlers/pipeline-write-service.ts`。
  - 扩展 `PipelineWriteInput` 支持 `narrativeContext?: NarrativeContextPackage`，保留 `jingweiContext?: string`。
  - 若未传 narrativeContext，则根据 bookId/sceneSpec/chapterNumber 调用 `buildNarrativeContext()`。
  - 将 `NarrativeContextPackage.sections` 转成现有 `ContextPackage.selectedContext` 条目。
  - candidate metadata 写入 retrieval diagnostics 摘要。
  - 验证：集成测试确认 WriterAgent 收到 narrative-memory/hard/state/timeline 等 selectedContext。

- [x] 21. 接入 candidate accept 安全回写路径
  - 修改 `packages/novel-plugin/src/engine/writing-resource/service.ts`。
  - accept 时若 metadata 含 `narrativeEvents`，优先写入事件日志并调用 reducer。
  - 保留旧 `jingweiDelta` 兼容路径，但避免其覆盖 canon；必要时将高风险更新转为 pending NarrativeEvent。
  - 验证：测试 candidate accept 后 low-risk event applied，高风险 canon event pending，旧 jingweiDelta 不破坏现有行为。

- [x] 22. 从 RuntimeStateDelta/settle 产出 NarrativeEvents 的桥接
  - 找到 Writer settle / RuntimeStateDelta 产出位置，新增转换函数 `runtimeDeltaToNarrativeEvents`。
  - 将 hookOps、knowledgeOps、timelineOp、resourceOps、currentStatePatch 转为候选 NarrativeEvents。
  - 不改写 Writer 生成逻辑，只在解析后桥接。
  - 验证：给定 RuntimeStateDelta fixture，应生成期望 eventType、evidence/source/chapter。

- [x] 23. 完成 MVP 测试矩阵
  - 增加单元测试覆盖 tasks 3-19 的纯函数与存储逻辑。
  - 增加集成测试：测试书 + 经纬 + facts + runtime state → buildNarrativeContext → pipeline.write selectedContext。
  - 增加 no future chapter leakage 测试。
  - 增加 canon 不自动 applied 测试。
  - 验证：运行相关 vitest 测试并记录输出。

- [x] 24. MVP 后端验证与日志检查
  - 运行 `pnpm --dir packages/studio typecheck`。
  - 使用测试入口或 curl/内部脚本调用 `buildNarrativeContext`，确认 diagnostics 包含 channelLatency、injectedTokens、dropped/degraded cards。
  - 实际触发一次 `pipeline.write`（可使用测试 book 和 mock/真实 provider 按项目约定选择），确认 selectedContext 包含 narrative-memory sections。
  - 验证：保存关键输出摘要，不虚构结果。

- [x] 25. Semantic 中期：新增 vector metadata 存储
  - 扩展 storage 初始化 `narrative_context_vector` 表。
  - 定义 vector metadata 类型：embeddingModelId、embeddingDim、vectorBlob、vectorUpdatedAt。
  - 提供读写 vector 的 storage API。
  - 验证：单元测试覆盖 vector 写入、读取、dimension mismatch 检测。

- [x] 26. Semantic 中期：接入 embedding provider 与 exact cosine
  - 新增 `channels/semantic-channel.ts`。
  - 接入现有 LLM/provider 基础设施中可用的 embedding provider；无 provider 时 skipped。
  - 实现候选预过滤：bookId、chapter visibility、category/entities。
  - 实现 exact cosine 排序，不引入 HNSW/ANN。
  - semantic 结果与其它通道 merge，且不得覆盖 hard channel。
  - 验证：测试 provider unavailable、dimension mismatch、semantic hit、hard priority preserved。

- [x] 27. Semantic 中期：补充 diagnostics 与配置开关
  - 增加 semantic channel 配置：enabled、maxCandidates、topK、minSimilarity。
  - diagnostics 记录 embedding latency、candidate count、hit count、skipped reason。
  - 默认不开启或在 provider 缺失时自动 skipped。
  - 验证：配置关闭/开启行为测试。

- [x] 28. Wave 终局：实现 narrative tag graph 存储与构建
  - 扩展 storage 初始化 `narrative_tag`、`narrative_card_tag`、`narrative_tag_edge`。
  - 新增 `wave/tag-graph.ts`。
  - 从 ContextCard tags/entities/sourceType 构建 narrative tags。
  - 建立有向共现边，支持 ordinalPotential、chapterProximity 基础权重。
  - 实现防抖/批处理重建接口，不在每次写作全量重建。
  - 验证：纯函数测试 tag extraction、edge direction、weight normalization、rebuild idempotency。

- [x] 29. Wave 终局：实现 semantic gain 与 residual anchors
  - 在 `wave/tag-graph.ts` 或独立模块实现 bell-shaped semantic gain。
  - 实现 residual anchor 基础计算：优先纯 TS 数组数学，不引入 scikit/native 依赖。
  - 对无 vector/tag 不足场景提供 fallback 默认值。
  - 验证：测试过近/中等/过远相似度的 gain 曲线，测试 residual fallback。

- [x] 30. Wave 终局：实现 EPA
  - 新增 `wave/epa.ts`。
  - 实现 query projection/entropy/logicDepth；如缺少足够 tag vectors，返回中性值。
  - 不引入 native PCA/SVD 依赖；第一版可使用已缓存 basis 或简化纯 TS power iteration/协方差近似，无法稳定时返回 neutral。
  - 验证：确定性 fixture 下 entropy/logicDepth 稳定；数据不足 fallback neutral。

- [x] 31. Wave 终局：实现 Residual Pyramid
  - 新增 `wave/residual-pyramid.ts`。
  - 实现 `maxLevels`、`topK`、`minEnergyRatio` 参数。
  - 对 query vector 分层搜索 tag facets，并从 residual 中扣除已解释分量。
  - 提供数据不足/无 embedding fallback。
  - 验证：复合 query fixture 能覆盖多个 facets；residual energy 低于阈值停止。

- [x] 32. Wave 终局：实现 Spike Routing
  - 新增 `wave/spike-routing.ts`。
  - 基于 narrative_tag_edge 从 seed tags 扩散能量。
  - 支持 `maxHops`、`firingThreshold`、`maxEmergentNodes`、`maxNeighborsPerNode`。
  - 根据 EPA logicDepth 调整扩散动量：聚焦少扩散，发散多扩散。
  - 验证：图 fixture 中能量扩散、阈值过滤、max limits 生效。

- [x] 33. Wave 终局：实现 Geodesic Rerank
  - 新增 `wave/geodesic-rerank.ts`。
  - 用 graph energy 修正 semantic/FTS/facts 候选排序。
  - hard channel 不参与降权。
  - 支持 L0/L1/L2 fallback：完整 graph energy、简化能量加成、跳过返回原排序。
  - 验证：测试 graph-linked old hook 被提升，hard candidate 不被降权，异常 fallback。

- [x] 34. Wave 终局：接入 wave channel 与配置开关
  - 将 EPA/residual/spike/geodesic 接入 `buildNarrativeContext` 的 semantic/wave 后处理。
  - 增加总开关和每算法开关，默认可关闭。
  - diagnostics 输出 logicDepth、entropy、activatedTags、rerank alpha、fallback level。
  - 验证：关闭时与 semantic/MVP 行为一致；开启时 diagnostics 有 wave 字段。

- [x] 35. 评估基准与 recall@budget
  - 新增小型 benchmark fixture：10-20 个测试故事片段，每个标注必须召回 facts/rules/hooks/timeline。
  - 实现 baseline 对比：priority-only、FTS-only、facts+FTS、semantic、wave。
  - 输出 recall@budget、injectedTokens、latency。
  - 验证：benchmark 可本地运行，结果可复现，不依赖外部服务时跳过 semantic/wave embedding 项。

- [x] 36. 可观察性 UI/API 初版
  - 若已有合适设置/调试面板，增加 retrieval diagnostics 展示入口；否则先提供后端 API/日志摘要。
  - 展示最近一次 buildNarrativeContext 的 channels、tokens、dropped/degraded、warnings。
  - pending NarrativeEvents 提供查询接口，UI 可后续批准/拒绝。
  - 验证：前端改动必须 Browser 截图；后端 API 用 curl 验证。

- [x] 37. 文档与 CHANGELOG 同步
  - 更新相关开发文档或功能索引，说明 Narrative Wave Memory 的阶段能力和默认依赖策略。
  - 更新 CHANGELOG，标注新增叙事记忆引擎、MVP/semantic/wave 能力边界。
  - 不把未完成终局能力写成已完成；按阶段准确描述。
  - 验证：文档无 planned/current 混淆。

- [x] 38. 全量验证与完成门禁
  - 运行 `pnpm --dir packages/studio typecheck`。
  - 运行相关 vitest 测试。
  - 对后端上下文构建用 curl/脚本实测。
  - 对用户可见写作链路实际运行：scene.spec → buildNarrativeContext → pipeline.write → candidate → accept → reducer。
  - 若涉及 UI，使用 Browser 截图。
  - 记录验证结果；未实际运行的项目不得宣称通过。
  - 验证记录（2026-06-22）：`bun test packages/novel-plugin/src/engine/narrative-memory packages/novel-plugin/src/routes/narrative-memory.test.ts packages/novel-plugin/src/handlers/pipeline-write-service.test.ts` → 82 pass / 0 fail；`pnpm --dir packages/studio typecheck` → pass；`bun run compile` → pass，产物 `dist/novelfork.exe` 与 `dist/novelfork-v2.2.0-windows-x64.exe`；exe 端口 4591 smoke：`/`、`/api/books`、`/api/books/smoke-narrative-memory/narrative-memory/diagnostics/latest`、`/events/pending` 均 200；Browser 截图 `dist/smoke-narrative-wave-memory-4591.png`，控制台无报错。
