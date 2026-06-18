# 开发者指南

NovelFork v1.11.2 开发指引。涵盖调试工具、工具注册、安全层、前端页面等开发知识。

## 开发与运行

```bash
# 安装依赖
bun install

# 开发模式（前后端热重载）
bun run dev

# 编译 Windows exe
cd packages/studio && bun run compile

# 产物路径
dist/novelfork-vX.Y.Z-windows-x64.exe
```

## 调试工具

### Prompt Dump

完整转储 LLM 请求体，用于诊断模型行为。

两种启用方式：
1. **设置页开关**：设置 → 运行时控制 → dumpApiRequests（重启后生效）
2. **环境变量**：`PROMPT_DUMP=1`（启动时生效）

转储文件保存在 `PROMPT_DUMP_DIR` 指定目录（默认为工作目录下的 `.prompt-dumps/`），包含 messages 数组、system prompt、tools 列表、model 信息。

### Turn Profiler

`turn-profiler.ts` — 每轮计时打点，记录 generate 耗时、TTFT、工具执行耗时。通过 `logRequest()` 统一写入请求日志。

### 结构化日志

`logger.ts` 提供统一日志接口（log.info/warn/error），`runtime-log-sink.ts` 将日志持久化到 SQLite。

### Runtime Status

前端设置页 → 运行时状态面板，可查看活跃 session、内存占用、Provider 健康度。

## 工具体系

### 工具总表

通用工具（`session-tool-registry.ts`）：

| 工具 | 类型 | 说明 |
|------|------|------|
| Bash | destructive | Shell 命令执行 |
| Read | read | 文件读取 |
| Write | confirmed-write | 文件创建/覆盖 |
| Edit | confirmed-write | 精确文本替换 |
| ApplyPatch | confirmed-write | Unified diff 补丁 |
| Glob | read | 文件模式匹配 |
| Grep | read | 正则内容搜索 |
| WebSearch | read | 网络搜索 |
| WebFetch | read | 网页抓取 |
| Browser | destructive | 浏览器交互（多步操作） |
| Agent | confirmed-write | 启动隔离子代理 |
| Await | read | 等待后台任务完成 |
| Send | read | 向子代理发消息 |
| ForkNarrator | confirmed-write | 创建独立叙述者 |
| Terminal | destructive | 交互式终端（PTY） |
| ShareFile | read | 生成临时下载链接 |
| Recall | read | 搜索对话历史 |
| EnterWorktree | confirmed-write | 进入 git worktree |
| ExitWorktree | confirmed-write | 退出 worktree |
| Snip | confirmed-write | 移除旧消息段 |
| AskUserQuestion | read | 结构化提问 |
| EnterPlanMode | read | 进入计划模式 |
| ExitPlanMode | read | 提交计划 |
| TaskCreate | read | 创建/更新任务列表 |
| StartPipeline | read | 进入管道模式 |
| EndPipeline | read | 退出管道模式 |
| LearningGuide | read | 学习中心文档 |
| Skill | read | 调用注册技能 |
| ToolSearch | read | 搜索按需加载工具 |
| GetGoals | read | 获取目标列表 |
| AddGoal | read | 添加目标 |
| UpdateGoal | read | 更新目标状态 |
| **CtxInspect** | read | 查看当前上下文使用情况（token/百分比/占比） |
| **Sleep** | read | 等待指定时间（1-300秒） |
| **TaskGet** | read | 获取后台任务状态和输出 |
| **TaskStop** | draft-write | 停止后台任务 |

### 添加新工具

1. 在 `session-tool-registry.ts` 中添加 `sessionTool({...})` 定义
2. 在 `session-tool-executor.ts` 中添加对应的 case 处理
3. 如果是只读工具，加入 `PARALLEL_SAFE_TOOLS` 和 `CONCURRENT_SAFE_TOOLS`

### PARALLEL_SAFE_TOOLS（18 个）

这些工具在同一 batch 中可并行执行（`Promise.all`）：

```
Read, Glob, Grep, WebSearch, WebFetch, GetGoals, LearningGuide, Recall,
jingwei.read, chapter.read, cockpit.snapshot, chapter.list, chapter.audit,
presets.read, beat.read, outline.suggest_next, character.check_consistency,
hooks.manage, presets.check_compliance
```

## 安全层

### 子命令拆分 + 引号感知分类

`permission-pipeline.ts` 的 `classifyBashCommand()` 流程：

1. `splitCommandSegments(command)` — 在 `&&`、`||`、`;`、`|` 处拆分，尊重引号
2. 对每个子段调用 `classifySingleCommand()` 分类
3. 取最严格分类（dangerous > untrusted > trusted）

分类依据：
- **trusted**（read）：ls、cat、head、grep、git status/log/diff 等
- **untrusted**（write）：rm、mv、git commit/push、npm install 等
- **untrusted**（network）：curl、wget、git clone/fetch 等
- **dangerous**：13+ 种危险模式正则匹配

### 14 条危险模式（destructive-command-warning.ts）

```
1. rm -rf/-r/-f 递归删除
2. git push --force 强制推送
3. git reset --hard 丢弃修改
4. git clean -f 删除未跟踪文件
5. git checkout -- 丢弃文件修改
6. DROP/TRUNCATE TABLE/DATABASE
7. DELETE FROM
8. npm publish
9. chmod 777
10. curl|bash 远程脚本执行
11. sudo rm
12. format 磁盘格式化
13. dd of=/dev/ 原始设备写入
14. shutdown/reboot
```

每条模式提供人类可读的中文风险说明和 severity（high/critical）。

### 命令语义（command-semantics.ts）

正确解释退出码，避免模型误判"失败"：

| 命令 | exit 0 | exit 1 | exit 2+ |
|------|--------|--------|---------|
| grep/rg | 有匹配 | 无匹配（非错误） | 真正错误 |
| diff | 无差异 | 有差异（正常） | 错误 |
| test/[ | 条件为真 | 条件为假（非错误） | 错误 |
| git | 成功 | 有变更检测到 | 错误 |
| find | 成功 | 部分目录不可访问 | 错误 |

### 用户 Allow/Block List

多来源权限规则系统（`resolvePermissionRules`）：
- 规则来源：user / project / session / cli / policy / default
- 优先级：**deny > ask > allow**（deny 总是赢）
- 支持通配符和命令前缀匹配

### Secret Detection

`security/secret-detector.ts` — 20+ 种模式检测 API key 并脱敏：
- AWS keys、GitHub tokens、OpenAI keys、Anthropic keys 等
- 防止秘钥泄露到 LLM 请求或日志中

### Path Sandbox

`security/path-sandbox.ts` — 路径越界防护：
- 支持 Windows/Unix 路径分隔符
- 确保文件操作不超出工作目录边界

## 前端 Routines 页面

Routines 页面（`studio/src/app-next/routines/`）提供三个管理入口：

1. **Rules File 编辑器** — 编辑项目级 rules 文件（如 `.kiro/rules`），Agent 会在每次对话中加载
2. **MCP 管理** — 查看/添加/删除 MCP server 配置，可视化连接状态
3. **Skills / Commands** — 管理注册的 skills 和 slash commands

## 添加安全模式

### 添加新的危险命令检测

在 `destructive-command-warning.ts` 的 `DESTRUCTIVE_PATTERNS` 数组中添加：

```typescript
{ regex: /\byour-pattern\b/i, warning: "人类可读风险说明", severity: "high" | "critical" }
```

### 添加新的危险模式（permission-pipeline.ts）

在 `DANGEROUS_PATTERNS` 数组中添加：

```typescript
{ pattern: /\byour-pattern\b/, reason: "internal reason string" }
```

### 添加命令语义规则

在 `command-semantics.ts` 的 `COMMAND_SEMANTICS` Map 中添加：

```typescript
["your-command", (exitCode, stdout, stderr) => ({
  isError: exitCode >= 2,  // 定义什么算真正的错误
  message: exitCode === 1 ? "Non-error meaning" : undefined,
})]
```
