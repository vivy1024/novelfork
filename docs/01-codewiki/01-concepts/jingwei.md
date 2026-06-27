**版本**: v3.0.0
**创建日期**: 2026-06-25
**更新日期**: 2026-06-25
**状态**: current
**文档类型**: current

# 经纬

## 定义

经纬是 NovelFork 的静态参考层。

它保存作者明确维护的世界、人物、规则和写作参考资料。

## 归属

- 层级：静态层
- 主归属：`packages/novel-plugin/src/engine/jingwei/`
- 使用方式：写作、审计、修订前作为参考上下文读取

## 应该放入经纬的内容

- 人物设定
- 地点设定
- 势力设定
- 世界规则
- 术语定义
- 作者备注
- 长期稳定的背景材料

## 不应该放入经纬的内容

- 当前章节刚发生的事件
- 角色在写作过程中刚改变的状态
- 伏笔的当前完成度
- 动态关系变化
- 临时生成结果

这些应该进入叙事记忆。

## 设计原则

1. 经纬是参考，不是运行时事实流
2. 经纬可以被工具读取，但不应被 LLM 随意覆盖
3. 经纬的更新应当带有明确作者意图
4. 动态事实不要混入经纬

## 相关代码

- `packages/novel-plugin/src/engine/jingwei/`
- `packages/novel-plugin/src/routes/jingwei.ts`
- `packages/novel-plugin/src/handlers/jingwei-read-unified.ts`
- `packages/novel-plugin/src/handlers/jingwei-write-handler.ts`
- `packages/novel-plugin/src/handlers/jingwei-audit-handler.ts`
- `packages/novel-plugin/src/handlers/lore-memory-boundary-handlers.ts`

## 当前代码事实

- `lore.read` / `jingwei.read` 走静态 Lore 读取。
- `lore.write` / `jingwei.write` 只应在作者意图明确时写静态条目。
- `jingwei.audit` 检查 active + confirmed + participates_in_ai + visibility 门禁。
- 写作动作产生的动态关系、时间线、伏笔状态通过 `memory.events` 进入 Narrative Memory。

## 当前清理目标

- 保留经纬作为静态层
- 明确它与叙事记忆的边界
- 禁止把动态写作事实塞回经纬
