**版本**: v3.0.0
**创建日期**: 2026-06-25
**更新日期**: 2026-06-25
**状态**: current
**文档类型**: current

# 叙事记忆

## 定义

叙事记忆是 NovelFork 的动态事实层。

它保存小说创作过程中不断变化的运行时真相。

## 归属

- 层级：动态层
- 主归属：`packages/novel-plugin/src/engine/narrative-memory/`
- 使用方式：写作前召回、写作后回写、审计时校验

## 应该放入叙事记忆的内容

- 事件推进
- 时间线变化
- 角色状态变化
- 角色关系变化
- 伏笔状态
- 冲突状态
- 已发生的动态事实
- 写后需要结算的 NarrativeEvent

## 不应该放入叙事记忆的内容

- 作者手工维护的静态设定
- 风格预设
- 模板
- 节拍模板
- 单纯的 UI 临时状态

这些分别属于经纬或配置层。

## 设计原则

1. 叙事记忆是动态事实的主归属
2. 写作工具不能绕过叙事记忆直接制造事实
3. LLM 只能提出候选事件，最终是否应用由 reducer / 审批机制决定
4. 高风险事实变更必须 pending，不应直接覆盖 canon

## 相关代码

- `packages/novel-plugin/src/engine/narrative-memory/`
- `packages/novel-plugin/src/routes/narrative-memory.ts`
- `packages/novel-plugin/src/pages/writing-workbench/NarrativeMemoryPanel.tsx`
- `packages/novel-plugin/src/handlers/pipeline-write-service.ts`

## 当前清理目标

- 强化叙事记忆作为动态层唯一主归属
- 将候选稿 / 草稿中的动态事实回写语义迁移到叙事记忆
- 避免旧资源系统继续承担动态事实职责
