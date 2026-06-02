---
title: 子代理系统
summary: ForkNarrator 分叉、Send 通信、Await 等待、Recall 记忆、TaskCreate 任务管理、Pipeline 工具
tags: [子代理, subagent, ForkNarrator, Send, Await, Recall, TaskCreate, Pipeline]
routes:
  - /next/narrators/:id
---

# 子代理系统

> 将复杂任务拆分给专门的子代理执行，支持分叉叙述者、跨代理通信、后台任务和记忆检索。

## 核心概念

### 四种内置类型

| 类型 | 用途 | 特点 |
|------|------|------|
| explore | 搜索和阅读代码/文档 | 只读，不修改文件 |
| plan | 规划方案和设计架构 | 输出计划，不执行实现 |
| general | 通用任务执行 | 可读写文件、运行命令 |
| fork | 继承当前上下文的分支 | 携带父对话的完整记忆 |

### 高级工具

| 工具 | 功能 | 说明 |
|------|------|------|
| **ForkNarrator** | 分叉独立叙述者 | 创建独立的叙述者会话，有自己的上下文和工具权限 |
| **Send** | 跨代理消息 | 向后台运行的子代理或兄弟代理发送消息 |
| **Await** | 等待结果 | 等待后台任务完成并获取结果，支持超时 |
| **Recall** | 记忆检索 | 搜索历史对话和上下文，找到之前讨论过的内容 |
| **TaskCreate** | 任务管理 | 创建和管理待办任务列表 |
| **Pipeline** | 写作管线 | 调用小说写作工具链（pipeline.generate_chapter 等） |

## ForkNarrator 详解

ForkNarrator 创建一个独立的叙述者分支，适合需要完全隔离的场景：

```
主叙述者 → ForkNarrator("尝试修仙风格写第三章")
         → 新叙述者独立运行
         → 结果满意 → 采纳
         → 不满意 → 丢弃，主叙述者不受影响
```

与 fork 子代理的区别：
- **fork 子代理**：临时任务，完成后回收，结果汇报给父代理
- **ForkNarrator**：创建持久的独立叙述者，有独立的对话历史和生命周期

## Send 消息通信

Send 工具实现子代理间的异步通信：

```
主代理 → Send(targetId, "已完成大纲，请开始写第一章")
子代理 ← 收到消息，开始执行
```

使用场景：
- 协调多个后台子代理的工作顺序
- 向正在运行的子代理追加指令
- 兄弟代理间的信息传递

## Await 等待机制

等待后台任务完成并获取结果：

```
// 派发后台任务
Agent(type="general", background=true, id="scan-task")

// 稍后获取结果
Await(id="scan-task", timeout=60000)
```

- 支持超时设置（毫秒）
- 超时后返回当前已有的部分结果
- 未超时时阻塞直到任务完成

## Recall 记忆检索

搜索历史对话，找到之前讨论过的内容：

```
Recall("上次讨论的修仙体系")
→ 返回匹配的历史对话片段
```

适用于：
- 找回之前讨论过但没有写入经纬的设定想法
- 回顾之前的写作决策和理由
- 跨会话的信息检索

## TaskCreate 任务管理

创建结构化任务列表，跟踪写作进度：

```
TaskCreate([
  { id: "ch5", content: "写第五章", status: "pending" },
  { id: "audit", content: "审计第四章", status: "in_progress" },
])
```

任务状态：`pending` → `in_progress` → `completed`

## 推荐使用流程

1. 复杂任务 → 派 plan 代理先规划
2. 耗时操作（全书扫描）→ 派 general 代理后台执行，用 Await 获取结果
3. 探索不同写法 → 用 ForkNarrator 创建独立分支尝试
4. 信息收集 → 派 explore 代理搜索，不影响主对话
5. 需要协调 → 用 Send 向后台代理发送指令

## 最佳实践

- explore 代理适合"帮我查一下前面哪章提到过这个角色"
- 后台任务适合批量检查，完成后用 Await 获取结果
- ForkNarrator 适合"试试另一种写法"——完全隔离，不满意直接丢弃
- Recall 用于找回之前讨论过的想法，避免重复决策
- TaskCreate 用于规划多步骤写作计划

## 常见坑

- **子代理无响应** → 检查子代理模型池配置是否有可用模型
- **后台任务结果丢失** → 未使用 Await 获取结果。任务完成后结果仍可查询
- **ForkNarrator 上下文过大** → 继承了父对话全部历史，考虑先 `/compact` 再分叉
- **Send 消息未送达** → 目标代理已完成或被回收

## Agent 查阅提示

- 子代理通过 `Agent` 工具派发，`Await` 工具等待结果
- `ForkNarrator` 创建独立叙述者，有持久生命周期
- `Send` 工具可向后台运行的子代理或兄弟代理发送消息
- `Recall` 工具搜索历史对话上下文
- `TaskCreate` 工具管理结构化待办列表
- `Pipeline` 工具调用小说写作管线（pipeline.generate_chapter 等）
- 子代理继承父代理的供应商配置和套路设置
- 后台任务生命周期：派发（background=true） → 运行 → Await 获取结果
- MCP 工具自动继承父代理配置
- 自定义子代理在套路的 SubAgents tab 中定义

## 可跳转功能入口

- 叙述者对话: 子代理在对话中派发和管理。 (/next/narrators/:id)
- 套路管理: 自定义子代理类型定义。 (/next/routines)
