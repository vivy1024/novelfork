# Session Memory 增强

## 概述

补全 session fork 的追溯能力，确保 Context Ring 的压缩/清空功能正确接通后端。书籍级长期记忆已通过 `buildAgentContext` 实现，本 spec 聚焦会话级 memory 管理。

## 用户故事

1. 作为作者，我希望 fork 一个会话后能看到它是从哪个会话分叉的
2. 作为作者，我希望通过 Context Ring 按钮压缩或清空上下文，不需要手动输入命令
3. 作为作者，我希望新开的写作会话自动带有书籍上下文（已实现）

## 功能需求

### FR-1: Fork 追溯字段

- session record 新增 `parentSessionId?: string`
- session record 新增 `forkMode?: "full" | "compressed"`
- fork API 创建新会话时写入这两个字段
- 会话信息面板（Info Sheet）展示 fork 来源

### FR-2: Context Ring 操作接通

验证并确保以下操作正确工作：
- Context Ring 点击弹出菜单：显示当前 token 使用量 / 压缩阈值 / 清空选项
- "压缩上下文"：调用 `compactSession` API，按设置中的比例压缩
- "清空上下文"：调用 `compactSession` API，清空到只保留 system prompt
- 操作后 Context Ring 百分比实时更新

### FR-3: 压缩策略配置（已有，验证）

确认设置中的以下字段正确生效：
- `contextCompressionThresholdPercent`（默认 80%）— 自动触发压缩的阈值
- `contextTruncateTargetPercent`（默认 70%）— 压缩后目标占比
- `largeWindowCompressionThresholdPercent`（默认 60%）
- `largeWindowTruncateTargetPercent`（默认 50%）

## 非功能需求

- fork 字段向后兼容（已有会话 parentSessionId 为 null）
- Context Ring 操作响应 < 2s

## 验收标准

1. fork 会话后，新会话的 parentSessionId 指向源会话
2. 会话信息面板显示"分叉自：{源会话标题}"
3. Context Ring 点击后弹出菜单，压缩/清空按钮可用
4. 压缩后 Context Ring 百分比下降
