---
title: 调试与排错
summary: 遇到问题时如何诊断：日志、Prompt Dump、上下文详情
tags: [调试, 日志, dump, 排错, 诊断]
routes:
  - /next/settings
---

# 调试与排错

> 遇到问题时如何定位原因，而不是反复重试。

## 结构化日志格式

系统运行时产生结构化 JSON 日志：

```json
{"ts":"2025-01-15T10:23:45.123Z","level":"info","msg":"tool executed","fields":{"tool":"jingwei.read","duration":234,"tokens":1520}}
```

| 字段 | 说明 |
|------|------|
| ts | ISO 时间戳 |
| level | info / warn / error |
| msg | 人类可读描述 |
| fields | 结构化附加数据 |

日志在开发者工具 Console 中可见，生产模式写入文件。

## 如何开启 Prompt Dump

Prompt Dump 可以看到 AI **实际收到了什么**——这是排查"AI 答非所问"的最有效手段。

1. 进入 **设置 → 开发者选项**
2. 开启"Dump API 请求"
3. 之后每次 AI 回复都会在 `.narrafork/prompt-dumps/` 生成一个 JSON 文件
4. 文件内容包含完整的 messages 数组、system prompt、工具定义

## 上下文详情面板

点击状态栏的上下文圆环 → "查看上下文详情"：

- 当前 token 使用量 / 窗口总量
- 各部分占比（系统提示、历史消息、工具结果、经纬数据）
- 最近一次压缩的时间和摘要内容

## 常见问题排查

### "AI 答非所问"

**原因**：AI 收到的上下文和你以为的不一样。

排查步骤：
1. 开启 Prompt Dump
2. 复现问题
3. 打开 dump 文件，看 messages 数组中实际包含了什么
4. 常见原因：经纬数据缺失、上下文被压缩丢了关键信息、系统提示被覆盖

### "上下文百分比不动"

**原因**：模型没有正确返回 usage 信息。

排查步骤：
1. 检查供应商是否支持 usage 返回（部分代理会剥离 usage 字段）
2. 查看 Console 日志中是否有 `usage missing` 警告
3. 尝试换一个供应商测试

### "工具卡住不动"

**原因**：有待确认的权限请求未回答。

排查步骤：
1. 检查对话区域是否有未回答的确认按钮
2. 检查是否处于 ask-always 模式且弹窗被遮挡
3. 查看日志中是否有 `tool_timeout` 错误

### "网络错误"

**原因**：供应商 URL 或 API Key 配置问题。

排查步骤：
1. 设置 → AI 供应商 → 测试连接
2. 检查 Base URL 格式（不要多加 `/`，不要漏掉 `https://`）
3. 检查 API Key 是否过期或额度用完
4. 检查网络代理设置

### "模型幻觉（编造内容）"

**原因**：经纬数据不完整，AI 没有足够的设定参考。

排查步骤：
1. 检查经纬中是否有该角色/地点/事件的条目
2. 补充缺失的设定数据
3. 重新生成，观察是否改善

## Turn Profiler（开发者工具）

在开发模式下可用，显示每个 Agent 回合的性能数据：

| 指标 | 说明 |
|------|------|
| total_duration | 整个回合耗时 |
| llm_time | 模型推理耗时 |
| tool_time | 工具执行耗时 |
| tokens_in | 输入 token 数 |
| tokens_out | 输出 token 数 |
| tool_calls | 工具调用次数 |

在 Console 中搜索 `[turn-profiler]` 可看到每回合的性能摘要。

## Agent 查阅提示

- Prompt Dump 文件路径：`.narrafork/prompt-dumps/{timestamp}-{session-id}.json`
- 日志级别可在设置中调整（info/debug/warn）
- Turn Profiler 仅开发模式启用，生产模式关闭
- 上下文详情数据来自最近一次 API 响应的 usage 字段
- 网络错误时检查 error.code 区分超时(TIMEOUT)、拒绝(ECONNREFUSED)、DNS(ENOTFOUND)

## 可跳转功能入口

- 开发者选项: Prompt Dump、日志级别等调试设置。 (/next/settings)
