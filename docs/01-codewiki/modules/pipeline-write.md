**版本**: v3.0.0
**创建日期**: 2026-06-26
**更新日期**: 2026-07-02
**状态**: current
**文档类型**: current

# Pipeline Write

## 职责

主写作管线入口，组合 cockpit、lore、memory、PGI、scene.spec、writer、audit/revise 和 settle 结果。

## 真实代码路径

- `packages/novel-plugin/src/handlers/pipeline-write-service.ts`
- `packages/novel-plugin/src/handlers/chapter-settlement-service.ts`
- `packages/novel-plugin/src/engine/agents/writer.ts`
- `packages/novel-plugin/src/engine/agents/continuity.ts`
- `packages/novel-plugin/src/engine/agents/reviser.ts`
- `packages/novel-plugin/src/engine/agents/severity-gate.ts`
- `packages/novel-plugin/src/routes/pipeline.ts`

## 主要入口

- `executePipelineWrite()`：执行章节写作主链路。
- `pipeline.write` 工具：Agent 触发写作管线。
- `memory.events`：结算后事实回写通道。

## 输入 / 输出

- 输入：bookId、chapterNumber、chapterIntent、上下文、PGI 指令、经纬和记忆召回结果。
- 输出：章节正文、审计结果、修订结果、正式章节资源、Narrative Memory 结算摘要和高风险 pending 提醒。

## 当前问题

- 文档历史中仍可能出现“候选稿”表述；当前方向是将稳定结果落到正式章节或多版本结算。

## 维护规则

1. 写作前读取 Lore 和 Narrative Memory。
2. `pipeline.write` 保存/更新 accepted 正式章节后触发 Chapter Settlement；空正文或保存失败不写事实。
3. Chapter Settlement 只从正式章节正文抽取 NarrativeEvent；生产路径使用 LLM 正文抽取 + runtime delta 结构化草案 + 规则兜底，低风险自动沉淀为 NarrativeFact，中高风险进入 pending。
4. 下一次写作前检查 high-risk pending；默认先返回提醒和 memory.events 处理入口，只有用户明确 `continueWithHighRiskPending=true` 才继续写作。
5. 正式章节是结果层，不删除。
