**版本**: v3.0.0
**创建日期**: 2026-06-25
**更新日期**: 2026-06-25
**状态**: current
**文档类型**: current

# 修订流程

## 目标

修订流程负责对已有章节或片段进行定向改写、润色、扩写或压缩。

## 推荐流程

```text
用户选择章节或片段
  → 指定修订目标
  → 读取经纬与叙事记忆
  → 生成修订结果
  → 用户选择应用方式
  → 更新正式章节或形成版本
  → 必要时产生叙事记忆事件
```

## 典型动作

- 选段扩写
- 改写
- 润色
- 桥接
- 对话增强
- 节奏调整

## 输出去向

修订结果只能进入以下位置之一：

1. 直接应用到正式章节
2. 作为多版本结果供比较
3. 作为建议被用户手动采纳

## 不允许的路径

- 修订结果进入候选稿中心
- 修订结果进入草稿中心
- 修订工具绕过用户确认直接覆盖正文

## 相关代码

- `packages/novel-plugin/src/routes/writing-modes.ts`
- `packages/novel-plugin/src/engine/agents/inline-writer.ts`
- `packages/novel-plugin/src/pages/writing-workbench/resource-viewers/ChapterEditor.tsx`

## 待整理

- 将 `candidate` / `draft` apply target 改造成版本或章节编辑目标
- 清理旧的候选稿保存函数
