# Runtime 能力对标 Claude Code — Requirements

## 目标

将 NovelFork Studio 的 Agent Runtime 从"UI 摆设"升级为真正可用的 AI 工作台，对标 2026 年初的 Claude Code CLI 核心能力。

## 当前状态

- 单 agent 对话能工作（LLM 调用 + 工具执行 + 流式输出）
- 大量配置项（子代理模型、摘要模型、MCP、Skills、模型聚合）已有 UI 和持久化，但 runtime 不消费
- 压缩摘要是文本拼接（假的），不调用 LLM
- Agent 不读取项目规则文件（CLAUDE.md）
- 无 subagent、无后台任务、无沙箱、无 prompt cache 利用

---

## Phase 1: 基础 Runtime（让 agent 真正有上下文）

### FR-1.1: 项目规则文件读取（CLAUDE.md）

Agent turn 启动时自动读取并注入 system prompt：
- `{workDir}/CLAUDE.md` — 项目级规则
- `{workDir}/.claude/rules/*.md` — 分文件规则
- `~/.novelfork/CLAUDE.md` — 用户级全局规则
- 合并后注入到 context（在 system prompt 之后、对话历史之前）
- Token 预算限制（如 20K tokens），超出时截断并提示

### FR-1.2: 压缩摘要改 LLM 生成

- `compactSession` 调用摘要模型（`modelDefaults.summaryModel`）生成智能摘要
- 摘要 prompt 对标 Claude Code：要求保留关键决策、文件修改、未完成任务
- 压缩前剥离图片消息（替换为 `[image]` 标记）
- 压缩后恢复最近 5 个文件上下文（已有逻辑，确认接通）
- 如果摘要请求本身超长（prompt-too-long），逐步丢弃最旧消息重试

### FR-1.3: Staleness Check（Write/Edit 前检查文件修改）

- 维护 `readFileState: Map<filePath, { mtime, content_hash }>` 
- Write/Edit 前检查目标文件 mtime 是否在上次 Read 之后变化
- 如果变化，返回错误："文件已被外部修改，请重新 Read 后再编辑"
- 已存在的文件必须先 Read 才能 Write（防止盲写）

### FR-1.4: 文件 Dedup（重复读返回 stub）

- Read 工具维护 `readFileState` 缓存（路径 → mtime + content）
- 相同文件 + mtime 未变 → 返回 `"[file_unchanged] 文件未修改，内容与上次读取相同。"`
- 节省大量 token（agent 经常重复读同一文件）
- 压缩后清空 readFileState（因为模型已失去文件上下文）

---

## Phase 2: 多 Agent 与后台任务

### FR-2.1: Subagent 系统

- 主 agent 可以 spawn 子代理（Explore/Plan/General 三种类型）
- 子代理使用对应的模型配置（`modelDefaults.exploreSubagentModel` 等）
- 子代理有独立的消息历史，完成后返回结果给主 agent
- 子代理工具集可以受限（如 Explore 只有 Read/Grep/Glob）

### FR-2.2: 后台任务

- Bash 长命令支持 `run_in_background: true`
- 后台任务不阻塞主 agent turn
- 主 agent 可以通过 `Await` 工具等待后台任务完成
- 超时后自动转后台（可配置阈值）

### FR-2.3: 模型聚合与路由

- 消费 `modelDefaults.aggregations` 配置
- 支持 priority（主备切换）、round-robin（负载均衡）、random
- 模型不可用时自动 fallback 到下一个
- 记录每个模型的成功率/延迟用于智能路由

---

## Phase 3: Prompt Cache 与成本优化

### FR-3.1: Prompt Cache 利用

- Anthropic API: 使用 `cache_control` 标记 system prompt 和前几条消息为可缓存
- 压缩后通知 cache 基线重置（避免误报 hit rate 下降）
- 统计 cache hit/miss/creation tokens 到使用历史
- 前端显示 cache 命中率

### FR-3.2: 工具搜索（动态工具注入）

- 不再把所有工具 schema 全量注入 system prompt
- 只注入核心工具（Read/Write/Edit/Bash/Grep/Glob）
- 其他工具（小说工具、MCP 工具）通过 ToolSearch 动态发现
- Agent 需要时调用 ToolSearch 获取工具 schema，然后再调用
- 减少每次请求的 token 消耗（工具 schema 很大）

### FR-3.3: 文件行号格式

- Read 工具返回内容加行号前缀（`cat -n` 格式）
- 方便 agent 引用具体行号
- Edit 工具可以用行号定位（可选）

---

## Phase 4: Skills 与 MCP

### FR-4.1: Skills 系统接通

- Agent 可以调用 Skill 工具（已有 skill 路由和定义）
- Skill 内容在 turn 启动时按需注入（不是全量）
- 压缩后恢复已调用的 skill 内容
- Skill 可以定义自己的工具集和 prompt

### FR-4.2: MCP 真实连接

- 实现 MCP client（stdio/SSE 两种传输）
- 连接配置的 MCP 服务器，获取工具列表
- MCP 工具注册到 session 工具集
- MCP 工具调用通过 client 转发到服务器
- 支持 MCP 服务器的 resources 和 prompts

---

## Phase 5: 安全与隔离

### FR-5.1: 沙箱执行

- Windows: 使用 Job Object 限制子进程资源
- 可选：Docker 容器隔离（如果 Docker 可用）
- Bash 工具在沙箱内执行，限制文件系统访问范围
- 配置项：sandbox mode（none / basic / strict）

### FR-5.2: Bash 进程管理

- 超时策略：SIGTERM → 5s → SIGKILL（当前直接 SIGKILL）
- Windows 进程树杀：使用 `taskkill /F /T /PID`
- 输出大小限制：>30K chars 写入临时文件，返回文件路径
- `sleep` 命令检测并建议后台执行

---

## Phase 6: Browser 与终端

### FR-6.1: Browser 工具

- 接通已有的 Browser 工具定义
- 使用 Puppeteer/Playwright headless 执行
- 支持：navigate、click、fill、screenshot、evaluate、get_text
- 截图返回 base64 或文件路径

### FR-6.2: 真实终端 PTY

- 使用 Bun.spawn 创建 PTY 进程
- WebSocket 双向通信（前端 xterm.js ↔ 后端 PTY）
- 终端面板从列表升级为可交互终端
- Agent 的 Terminal 工具通过 PTY 执行

---

## 文件范围

| 模块 | 路径 |
|------|------|
| Agent Runtime | `packages/studio/src/api/lib/agent-turn-runtime.ts` |
| Session Chat | `packages/studio/src/api/lib/session-chat-service.ts` |
| Tool Executor | `packages/studio/src/api/lib/session-tool-executor.ts` |
| Real Tool Handlers | `packages/studio/src/api/lib/real-tool-handlers.ts` |
| Compact Service | `packages/studio/src/api/lib/session-compact-service.ts` |
| Context Compaction | `packages/studio/src/api/lib/context-compaction.ts` |
| Provider Adapters | `packages/studio/src/api/lib/provider-adapters/` |
| MCP | `packages/studio/src/api/routes/mcp.ts` |
| Skills | `packages/studio/src/api/routes/skills.ts` (待创建) |
| Terminal | `packages/studio/src/api/routes/terminals.ts` |
| Settings Types | `packages/studio/src/types/settings.ts` |
| Agent Prompts | `packages/novel-plugin/src/engine/pipeline/agent-prompts.ts` |

## 验收标准

每个 Phase 完成后：
1. 功能可通过前端实际使用（不是只有 API）
2. 配置项真正被 runtime 消费（不是摆设）
3. 有对应的错误处理和用户反馈
4. 编译通过 + exe 可运行
