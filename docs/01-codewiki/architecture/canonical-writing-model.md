**版本**: v3.0.0
**创建日期**: 2026-06-25
**更新日期**: 2026-06-25
**状态**: current
**文档类型**: current

# Canonical Writing Model

## 1. 状态

本页是 NovelFork 写作模型的权威定义。

当前目标不是继续增加写作对象，而是把系统收敛到稳定边界。

## 2. 目标模型

```text
经纬              静态参考层
叙事记忆          动态事实层
正式章节          结果层
预设 / 模板 / 节拍 配置层
工具              用户体验动作层
```

## 3. 保留对象

### 3.1 经纬

- 状态：保留
- 层级：静态参考层
- 真实代码：`packages/novel-plugin/src/engine/jingwei/`
- 主要路由：`packages/novel-plugin/src/routes/jingwei.ts`
- 规则：动态事实不写入经纬

### 3.2 叙事记忆

- 状态：保留
- 层级：动态事实层
- 真实代码：`packages/novel-plugin/src/engine/narrative-memory/`
- 主要路由：`packages/novel-plugin/src/routes/narrative-memory.ts`
- 规则：写作后的事实变化通过 NarrativeEvent / reducer 进入叙事记忆

### 3.3 正式章节

- 状态：保留
- 层级：结果层
- 真实代码：`packages/studio/src/api/routes/storage.ts`
- 章节编辑 UI：`packages/novel-plugin/src/pages/writing-workbench/resource-viewers/ChapterEditor.tsx`
- 规则：正式章节是稳定正文结果，不是候选稿/草稿状态机中的一个状态

### 3.4 预设 / 模板 / 节拍

- 状态：保留
- 层级：配置层
- 真实代码：`packages/novel-plugin/src/engine/presets/`
- 配置 UI：`packages/novel-plugin/src/pages/writing-config/`
- 规则：文风提取结果只是建议，必须经用户确认后进入配置

### 3.5 工具

- 状态：保留并重新定位
- 层级：用户体验动作层
- 代表代码：`packages/novel-plugin/src/routes/writing-modes.ts`
- 规则：工具输出只能进入正式章节、多版本、配置建议或 NarrativeEvent

## 4. 废弃对象

### 4.1 候选稿

- 状态：废弃主概念；短期仅允许兼容
- 类型源头：`packages/novel-plugin/src/engine/writing-resource/types.ts`
- 工具入口：`candidate.create_chapter` 已从主执行入口移除；旧实现文件已删除，状态记录见 cleanup inventory
- Studio 路由：已删除旧路由注册；回归测试覆盖 404
- 问题：把写作结果变成中间对象，增加状态机和存储复杂度

### 4.2 草稿

- 状态：废弃主概念；短期仅允许兼容
- 类型源头：`packages/novel-plugin/src/engine/writing-resource/types.ts`
- Studio 路由：已删除旧路由注册；回归测试覆盖 404
- 问题：与正式章节、多版本、编辑动作边界重叠

### 4.3 Writing Resource 状态机

- 状态：待收口兼容层
- 服务代码：`packages/novel-plugin/src/engine/writing-resource/service.ts`
- HTTP 路由：`packages/novel-plugin/src/routes/writing-resource.ts`
- 问题：同时承担章节、候选稿、草稿、状态流转、双存储兼容、叙事回写触发

## 5. 工具输出去向规则

| 工具输出类型 | 允许去向 | 禁止去向 |
|--------------|----------|----------|
| 正文稳定结果 | 正式章节 | 候选稿中心、草稿中心 |
| 多个表达方案 | 多版本 | 候选稿列表 |
| 风格分析结果 | 预设建议 | 叙事记忆、自动覆盖预设 |
| 故事事实变化 | NarrativeEvent | 经纬、正文 metadata 私自记录 |
| 临时编辑结果 | 用户确认后应用或丢弃 | 自动落库为新业务对象 |

## 6. 章节存储规则

正式章节正文以文件系统为主存储。

SQLite 可继续承担：

- 会话
- 设置
- 运行时状态
- 索引
- 诊断日志

SQLite 不再承担：

- 正式章节正文主存储
- 候选稿/草稿主存储
- 写作中间态主系统

相关文件：

- `packages/core/src/storage/schema.ts`
- `packages/core/src/storage/migrations/0016_writing_resource.sql`
- `packages/novel-plugin/src/engine/writing-resource/file-store.ts`

## 7. 当前迁移原则

1. 先文档化真实旧入口，再删除
2. 删除候选稿/草稿主概念，不删除用户体验能力
3. 保留正式章节、经纬、叙事记忆、预设、工具
4. 多版本单独设计，不用候选稿替代
5. 所有动态事实走 NarrativeEvent / reducer

## 8. 相关 CodeWiki 页面

- `docs/01-codewiki/cleanup/candidate-draft-writing-resource-inventory.md`
- `docs/01-codewiki/01-concepts/jingwei.md`
- `docs/01-codewiki/01-concepts/narrative-memory.md`
- `docs/01-codewiki/01-concepts/chapter.md`
- `docs/01-codewiki/01-concepts/presets-templates-beats.md`
- `docs/01-codewiki/01-concepts/tools.md`
