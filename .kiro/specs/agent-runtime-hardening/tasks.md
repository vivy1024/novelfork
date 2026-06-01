# Implementation Plan

## Overview

为 NovelFork Studio Agent 运行时实现四项生产级加固：级联压缩、分段压缩、YOLO 模式 + 安全反思、中断恢复、流式中断检查加强。采用独立模块方案，在 agent-turn-runtime.ts 核心循环的关键节点插入钩子，不改动循环结构本身。

## Tasks

### 基础设施

- [x] 1. 新增数据库迁移：创建 `turn_checkpoints` 表，为 `session_messages` 添加 `collapsed` 字段
  - 文件：`packages/core/src/storage/migrations/` 新增迁移文件
  - 验证：迁移可正常执行，表结构正确

- [x] 2. 在 session 配置类型中新增运行时加固配置项（yoloMode、safetyReflection、cascadeCompactEnabled、turnCheckpointEnabled、健康监控参数）
  - 文件：`packages/studio/src/shared/session-types.ts`
  - 验证：类型编译通过，默认值正确

### 模块 1：上下文压缩增强

- [x] 3. 实现 `compact-utils.ts`：提取 `splitMessagesByTokenBudget()`、`estimateTokens()` 等共享工具函数
  - 文件：`packages/studio/src/api/lib/compact/compact-utils.ts`
  - 验证：单元测试覆盖分块边界情况

- [x] 4. 实现 `cascade-compact.ts`：级联压缩核心逻辑（分块 → 逐块压缩 → 合并摘要）
  - 文件：`packages/studio/src/api/lib/compact/cascade-compact.ts`
  - 依赖：任务 3
  - 验证：单元测试覆盖正常压缩、单块不压缩、失败回退场景

- [x] 5. 在 `context-compaction.ts` 中集成级联压缩：当历史超过摘要模型窗口 80% 时自动切换到级联压缩
  - 文件：`packages/studio/src/api/lib/compact/context-compaction.ts`（或现有入口）
  - 依赖：任务 4
  - 验证：集成测试确认自动切换逻辑

- [x] 6. 实现 `segment-compact.ts`：分段压缩核心逻辑（取 beforeSeq 之前消息 → 压缩 → 标记 collapsed → 插入摘要）
  - 文件：`packages/studio/src/api/lib/compact/segment-compact.ts`
  - 依赖：任务 1（collapsed 字段）
  - 验证：单元测试覆盖压缩和 undo 流程

- [x] 7. 新增分段压缩 API 路由：`POST /api/sessions/:id/compact-segment` 和 `POST /api/sessions/:id/compact-segment/undo`
  - 文件：session 相关路由文件
  - 依赖：任务 6
  - 验证：curl 测试 API 正常响应

- [x] 8. 新增 `session:compact-progress` WebSocket 事件广播，压缩过程中推送进度
  - 文件：`packages/studio/src/api/lib/session-chat-service.ts`
  - 依赖：任务 5、6
  - 验证：WS 客户端能收到进度事件

### 模块 2：YOLO 模式 + 安全反思

- [x] 9. 实现 `yolo-mode.ts`：工具风险分级（TOOL_RISK_MAP）+ Bash 命令危险模式检测（DANGEROUS_PATTERNS）+ `classifyToolRisk()` 函数
  - 文件：`packages/studio/src/api/lib/yolo-mode.ts`
  - 验证：单元测试覆盖各风险级别分类和危险命令模式匹配

- [x] 10. 实现安全反思逻辑：`performSafetyReflection()` 函数，使用当前对话模型带完整历史进行二次确认
  - 文件：`packages/studio/src/api/lib/yolo-mode.ts`
  - 依赖：任务 9
  - 验证：单元测试覆盖 APPROVE/REJECT 解析、超时处理

- [x] 11. 在 `permission-pipeline.ts` 中集成 YOLO 层：在 risk classification 之后插入 YOLO 判定，safe/write 自动放行，dangerous 触发安全反思
  - 文件：`packages/studio/src/api/lib/permission-pipeline.ts`
  - 依赖：任务 9、10
  - 验证：集成测试确认 YOLO 开/关时的不同行为

- [x] 12. 新增 `session:safety-pause` 和 `session:safety-decision` WebSocket 事件，实现安全反思暂停/恢复通信
  - 文件：`packages/studio/src/api/lib/session-chat-service.ts`
  - 依赖：任务 11
  - 验证：WS 客户端能收到暂停事件并发送决策

### 模块 3：中断恢复

- [x] 13. 实现 `turn-checkpoint.ts`：`saveTurnCheckpoint()`、`getUnfinishedCheckpoints()`、`clearTurnCheckpoint()` 三个核心函数
  - 文件：`packages/studio/src/api/lib/turn-checkpoint.ts`
  - 依赖：任务 1（turn_checkpoints 表）
  - 验证：单元测试覆盖写入/读取/清理

- [x] 14. 在 `agent-turn-runtime.ts` 中插入 checkpoint 钩子：每次工具执行完成后异步写入 checkpoint，turn 完成/失败时清除
  - 文件：`packages/studio/src/api/lib/agent-turn-runtime.ts`
  - 依赖：任务 13
  - 验证：集成测试确认 checkpoint 正确写入和清除

- [x] 15. 实现服务器启动时的 checkpoint 恢复逻辑：扫描未完成 checkpoint → 注入工具结果到消息历史 → 标记 session 为 interrupted
  - 文件：`packages/studio/src/api/lib/session-chat-service.ts`
  - 依赖：任务 13、14
  - 验证：模拟服务器重启后 session 正确标记为 interrupted

- [x] 16. 实现 `session:continue` 消息处理：后端收到 continue 后构造继续消息并启动新 turn
  - 文件：`packages/studio/src/api/lib/session-chat-service.ts`
  - 依赖：任务 15
  - 验证：中断后发送 continue 能正确恢复 agent turn

### 模块 4：流式中断检查加强

- [x] 17. 实现 `turn-health-monitor.ts`：TurnHealthMonitor 类，包含循环模式检测、token 消耗追踪、连续失败升级、空转检测
  - 文件：`packages/studio/src/api/lib/turn-health-monitor.ts`
  - 验证：单元测试覆盖四种检测规则的触发和不触发场景

- [x] 18. 实现 `computeSimilarity()` 工具调用相似度算法
  - 文件：`packages/studio/src/api/lib/turn-health-monitor.ts`（内部函数）
  - 依赖：任务 17
  - 验证：单元测试覆盖同名不同参数、完全相同、完全不同的场景

- [x] 19. 在 `agent-turn-runtime.ts` 中集成健康监控：每次工具执行后调用 `checkHealth()`，根据结果注入提示或停止 turn
  - 文件：`packages/studio/src/api/lib/agent-turn-runtime.ts`
  - 依赖：任务 17
  - 验证：集成测试确认 warn 注入提示、stop 终止 turn

- [x] 20. 将现有 `consecutiveFailures` 逻辑迁移到 TurnHealthMonitor 中统一管理，升级为 2→3→5 三级
  - 文件：`packages/studio/src/api/lib/agent-turn-runtime.ts`、`turn-health-monitor.ts`
  - 依赖：任务 17、19
  - 验证：现有 consecutiveFailures 测试仍通过 + 新增第 5 次强制停止测试

### 前端

- [x] 21. 设置页新增 YOLO 模式开关 + 安全反思开关 + 健康监控参数调节 UI
  - 文件：前端设置页相关组件
  - 依赖：任务 2
  - 验证：设置能正确保存和读取

- [x] 22. 对话框消息右键菜单新增"压缩到此消息前"选项，调用分段压缩 API
  - 文件：前端消息组件
  - 依赖：任务 7
  - 验证：右键菜单显示，点击后调用 API 并更新 UI

- [x] 23. 实现中断后"继续"按钮：检测 session interrupted 状态，显示按钮，点击发送 session:continue
  - 文件：前端对话面板组件
  - 依赖：任务 16
  - 验证：中断后按钮显示，点击后 agent 恢复执行

- [x] 24. 实现安全反思暂停 UI：收到 safety-pause 事件时显示黄色警告卡片（操作详情 + 确认/拒绝按钮），发送 safety-decision
  - 文件：前端对话面板组件
  - 依赖：任务 12
  - 验证：暂停时卡片显示，用户决策后 agent 继续或停止

- [x] 25. 实现压缩进度指示：收到 compact-progress 事件时显示进度条/状态文字
  - 文件：前端对话面板组件
  - 依赖：任务 8
  - 验证：压缩过程中进度可见

### 国际化

- [x] 26. 为所有新增 UI 文案添加中英文翻译：设置项标签、右键菜单、继续按钮、安全警告卡片、进度提示
  - 文件：前端 i18n 资源文件
  - 依赖：任务 21-25
  - 验证：切换语言后文案正确显示
