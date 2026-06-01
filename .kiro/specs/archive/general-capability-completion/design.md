# 通用能力补全 — Design

## 架构决策

### 斜杠命令

- 存储在 `UserConfig.commands[]`，与 NarraFork 一致
- Composer 组件监听 `/` 输入，弹出补全列表
- 命令展开在前端完成（不经过后端），展开后作为普通消息发送
- "先 Bash"模式：前端先调用 `/api/tools/execute` 执行 Bash，将结果拼接到 prompt 后再发送
- 叙事线级命令存储在项目的 `.novelfork/commands.json`

### 全局系统提示词

- 文件路径：`~/.novelfork/CLAUDE.md`（已有读取逻辑）
- 新增 API：`GET/PUT /api/settings/global-prompt` 读写文件内容
- 设置页 AgentSettingsPanel 添加 Textarea 编辑区
- 修改即时保存到文件，下次 turn 自动生效（loadProjectRules 已读取）

### 首 Token 超时

- 在 `provider-adapters/index.ts` 的 `AnthropicCompatibleAdapter.generate()` 中实现
- 流式模式：启动 setTimeout，收到第一个 stream event 时 clearTimeout
- 非流式模式：整个请求用 AbortSignal.timeout
- 重试逻辑包裹在 generate 外层，指数退避
- 可重试错误：429、500、502、503、ECONNRESET、ETIMEDOUT

### 更新系统

- 启动时 + 手动触发检查 GitHub API
- 对比 `package.json` version 与 latest release tag
- 前端显示：有更新时在设置页显示 badge + 下载链接
- 不做自动安装（exe 替换需要用户手动操作）

### 自定义子代理

- 存储在 `UserConfig.customSubagents[]`
- Agent handler 的 `subagent_type` 先查自定义类型，再查内置类型
- 自定义类型的 systemPrompt 直接作为子代理的 system prompt
- allowedTools 为空时继承父级全部工具

## 数据流

```
用户输入 /命令
  → Composer 拦截
  → 查找匹配命令（user commands → project commands）
  → 展开模板（替换 {{参数}}）
  → [可选] 执行 Bash 命令，拼接结果
  → 作为普通消息发送给 session
```

```
Agent turn 启动
  → loadProjectRules() 读取 CLAUDE.md（已有）
  → 全局提示词注入 context
  → 首 token 超时计时器启动
  → generate() 调用
  → 收到首 token → 清除计时器
  → 超时 → abort + 退避 + 重试
```
