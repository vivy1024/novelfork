# Studio Bug 修复 + 功能补全 — Requirements

## Bug 修复

### BUG-1: 供应商模型在设置页模型 Select 里看不见
- 模型设置页的 SimpleSelect 下拉无法看到已配置供应商的模型
- 可能是 API 路径或数据格式不匹配

### BUG-2: 切换页面对话暂停
- 离开对话页面后 agent 停止工作
- 可能是 WebSocket 断开或 agent turn runtime 被中断
- 应该：后台继续执行，回来后恢复显示

### BUG-3: 工具调用出错卡住不继续
- 工具执行失败后 agent turn 卡住，不继续下一步
- 需要工具执行超时机制 + 失败后自动继续

### BUG-4: 失败的工具调用没显示耗时
- ToolCallCard 右侧 duration 为空
- 需要在工具失败时也记录 startedAt/finishedAt

### BUG-5: 会话详情显示不准确
- 快速模式/宽松规划/自动裁剪 显示"关闭"但实际配置可能不同
- 需要从 session 实际配置读取而非全局 settings

## 功能补全

### FEAT-1: 使用历史真实记录
- 每次 LLM API 调用写入 SQLite 请求日志（provider/model/tokens/duration/status/error）
- /api/usage/requests 返回真实分页数据
- /api/usage/trend 返回真实趋势聚合
- 前端 UsagePanel 展示真实数据

### FEAT-2: 服务器配置可编辑
- 端口号（修改后重启生效）
- 监听地址（127.0.0.1 / 0.0.0.0）
- 默认项目目录
- 启动时打开浏览器方式（不打开 / 网页打开 / 应用打开）
- 持久化到 user-config.json

### FEAT-3: TLS/HTTPS
- 生成自签名证书按钮
- 启用/禁用 TLS 开关
- 证书路径配置
- 修改后重启生效

## 文件范围

- `packages/studio/src/api/` — 后端路由和服务
- `packages/studio/src/app-next/settings/` — 设置页面
- `packages/studio/src/app-next/agent-conversation/` — 对话面板
- `packages/studio/src/api/lib/session-tool-executor.ts` — 工具执行
- `packages/studio/src/api/lib/request-observability.ts` — 请求日志
- `packages/studio/src/api/server.ts` — 服务器启动
