**版本**: v3.0.0
**创建日期**: 2026-06-26
**更新日期**: 2026-06-26
**状态**: current
**文档类型**: current

# Pipeline Write

## 职责

主写作管线入口，组合 cockpit、lore、memory、PGI、scene.spec、writer、audit/revise 和 settle 结果。

## 真实代码路径

- `packages/novel-plugin/src/handlers/pipeline-write-service.ts`
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
- 输出：章节正文、审计结果、修订结果、NarrativeEvents 或待确认事件。

## 当前问题

- 文档历史中仍可能出现“候选稿”表述；当前方向是将稳定结果落到正式章节或多版本结算。

## 维护规则

1. 写作前读取 Lore 和 Narrative Memory。
2. 写作后涉及事实变化时生成 NarrativeEvent。
3. 高风险事件 pending，不直接覆盖经纬。
4. 正式章节是结果层，不删除。
