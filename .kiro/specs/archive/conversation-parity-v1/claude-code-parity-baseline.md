# Claude Code Parity Baseline

> 日期：2026-05-06  
> 本机调查对象：Claude Code CLI 2.1.69  
> 本文件服务 `conversation-parity-v1` Task 1，只作为能力对照和范围守护，不把未实现能力写成 NovelFork current。

## 调查命令与事实

| 调查项 | 命令 | 事实 |
|---|---|---|
| 版本 | `claude --version` | 返回 `2.1.69 (Claude Code)`。 |
| 顶层帮助 | `claude --help` | CLI 默认启动交互会话；`-p/--print` 进入非交互输出；支持 `--continue`、`--resume`、`--fork-session`、`--input-format stream-json`、`--output-format stream-json/json/text`、`--include-partial-messages`、`--no-session-persistence`、`--allowedTools`、`--disallowedTools`、`--permission-mode`、`--max-budget-usd`、`--session-id`、`--model`、`--agent`、`--agents`、`--worktree`、`--tmux`、`--chrome`、`server`、`mcp`、`agents`、`plugin` 等。 |
| 子帮助探测 | `claude --help slash-commands`、`claude --help output-format` | 两者均返回同一顶层 help；本机 CLI 没有暴露独立 `slash-commands` / `output-format` 帮助子页。 |
| NovelFork 当前会话 API | `packages/studio/src/api/routes/session.ts` | 已有 session list/get/create/update/delete、chat snapshot/history/state、tool state、tool confirmation API；尚无 continue latest / fork session lifecycle route。 |
| NovelFork 当前会话 UI | `SessionCenterPage.tsx`、`SessionCenter.tsx` | 已有会话中心、搜索、binding/status 筛选、打开、归档/恢复；尚无最近会话继续、fork dialog 或 resume picker 的 Claude Code parity 体验。 |
| NovelFork 当前 headless | `routes/exec.ts`、`routes/session.ts`、`packages/cli/src/commands/chat.ts`、`packages/cli/src/commands/exec.ts` | Task 8/9 后已有 `POST /api/sessions/headless-chat`、`novelfork chat` 与兼容 `novelfork exec`，支持 text/stream-json input、NDJSON stream-json output、sessionId 复用、book/project、provider:model、stdin/maxSteps、ephemeral/no-session-persistence、maxTurns/maxBudget stop result 与 pending confirmation exit code 映射；`POST /api/exec` 保留兼容入口。 |
| NovelFork 当前 compact | `packages/studio/src/api/lib/compact/micro-compact.ts` | 已有 micro compact 工具结果折叠资产；尚未产品化为 session compact record、context budget、summary 注入。 |
| NovelFork 当前权限 | `shared/session-types.ts`、`shared/agent-native-workspace.ts`、Conversation status bar | 已有 permissionMode（ask/edit/allow/read/plan）、风险判定、确认门与模型工具能力提示；尚无 per-session allow/deny/ask tool policy store。 |
| NovelFork 当前 checkpoint/rewind | `resource-checkpoint-service.ts`、`resource-rewind-service.ts`、`storage-write-service.ts`、`narrative-line-service.ts` | Task 11 后已有正式资源 checkpoint 与 Rewind preview/apply：preview 返回 diff/hash/risk，apply 必须经 destructive confirmation，批准时写 safety checkpoint 与 rewind audit，冲突/资源移动失败返回真实错误。 |
| NovelFork 当前用量 | `shared/session-types.ts` | 已有 message runtime usage 与 session cumulativeUsage；尚无 headless run result 层级的完整 duration/stop_reason/permission_denials/cost unknown 统计合同。 |

## Claude Code → NovelFork 能力对照

| Claude Code 2.1.69 能力 | 本机 CLI 证据 | NovelFork 当前基础 | `conversation-parity-v1` 范围 | 非目标 / 守护 |
|---|---|---|---|---|
| Continue latest | `-c, --continue` | session list 支持 status/binding/search/sort；会话中心能打开已有 session | Task 2/3 实现 continue latest service 与 UI 入口 | 不实现终端 TUI 式 picker 复制；按书籍/章节/project scope 定义最近会话 |
| Resume by id/search | `-r, --resume [value]`、`--session-id <uuid>` | `/api/sessions/:id`、chat state/history、WebSocket replay cursor | Task 2/3 实现 resume service、picker、失败错误展示 | 不创建空假会话；归档会话默认只读或显式恢复 active |
| Fork session | `--fork-session` 与 resume/continue 搭配 | `createSession` 可创建新 session；无 fork 语义 | Task 2/3 创建 fork service/dialog，继承必要配置与摘要 | 不复用原 sessionId；不复制无限完整历史 |
| Slash commands | 交互 CLI 支持 slash 体验；本机 help 没有单独子页 | Composer 当前发送普通文本；状态栏可改模型/权限 | Task 4 建立 registry 与 `/help`、`/status`、`/model`、`/permission`、`/fork`、`/resume` | 命令错误不得发送给模型；不一次性照搬所有 Claude Code 命令 |
| Compact | 交互命令经验 + print/headless 需要上下文控制 | microCompact 仅折叠工具结果 | Task 5 产品化 `/compact`、summary record、context budget、后续 turn 注入 | compact 失败不得破坏原历史 |
| Memory | Claude Code 有记忆/偏好类工作流 | NarraFork/记忆 MCP 可用；Studio session 未接 memory 写入边界 | Task 6 定义偏好/项目事实/临时剧情边界与可审计写入 | 临时剧情草稿不得自动写长期 memory |
| Tool policy | `--allowedTools`、`--disallowedTools`、`--permission-mode` | permissionMode、工具风险、确认门、模型工具能力检测 | Task 7 支持 session/project allow/deny/ask 策略并合并 dirty canvasContext | 不绕过候选稿/确认门治理；模型不支持工具时不给假 schema |
| Headless stream-json | `-p`、`--input-format stream-json`、`--output-format stream-json`、`--include-partial-messages`、`--no-session-persistence` | `/api/exec` 与 `novelfork exec --json` | Task 8/9 新增 headless chat API/CLI，支持 text + stream-json input/output、pending confirmation、ephemeral | 不替代已有 `novelfork exec`；不另起假 agent loop |
| Max budget / turns | `--max-budget-usd`、print 模式限制 | `/api/exec` 有 maxSteps | Task 8/12 输出 max turns / budget stop result | provider 无成本时只显示 unknown，不虚构 USD |
| Worktree / tmux | `--worktree`、`--tmux` | NovelFork 有 worktree 管理，但 Studio 不是终端 TUI | 不在本 spec 实现 | 排除 tmux / 完整终端 TUI / worktree session 自动创建 parity |
| Chrome / IDE / remote control | `--chrome`、`--ide`、`server`、`open` | Studio 本身是 Web 工作台 | 不在本 spec 实现 | 排除 Chrome bridge、IDE 自动连接、remote-control/server parity |
| Agents/plugins/MCP 管理 | `agents`、`plugin`、`mcp` | Routines/MCP/settings 页面已有部分资产 | 仅在 slash/status 中引用当前可用状态 | 排除插件市场与完整 Claude Code plugin 生态 |
| Checkpoint / rewind | Claude Code 产品体验包含检查点回滚；本机 help 不暴露独立 flag | Workbench/工具会写正式资源，但无统一 checkpoint service | Task 10/11 实现正式资源写入前快照与 rewind preview/apply | 候选稿、草稿、prompt-preview 不强制 checkpoint |
| Structured result / usage | `--output-format json/stream-json`、`--max-budget-usd` | cumulativeUsage 与 exec result 有基础 | Task 12 记录 turn/run duration、stop_reason、usage、modelUsage、permission_denials、errors、session_id | 成本 unknown 必须透明，不编造金额 |

## 本 spec 明确实现范围

1. 会话继续、恢复与 fork：service + API + UI。
2. Slash command registry：`/help`、`/status`、`/model`、`/permission`、`/fork`、`/resume`，后续 `/compact` 接 Task 5。
3. Session compact 与 context budget：基于真实 session history 与 compact record。
4. Memory 写入边界：偏好、项目事实、临时剧情草稿三分法。
5. 细粒度工具权限策略：allow/deny/ask 与 permissionMode/resource risk/dirty canvasContext 合并。
6. Headless stream-json API 与 CLI：复用 AgentTurnRuntime/session tools，不另起 direct agent loop。
7. 写作资源 checkpoint 与 rewind：仅正式资源写入前创建，恢复必须走确认门。
8. 会话执行结果与用量统计：区分 turn、session cumulative、headless run。

## 本 spec 明确排除范围

- 不复制完整终端 TUI。
- 不实现 tmux parity。
- 不实现 Chrome bridge / IDE 自动连接 / remote-control server parity。
- 不实现插件市场或完整 Claude Code plugin 生态。
- 不一次性照搬所有 Claude Code slash commands。
- 不绕过 NovelFork 候选稿、草稿、prompt-preview 与确认门边界。
- 不虚构 provider 成本、工具能力、checkpoint 或 rewind 成功结果。

## Task 1 后续守护

- `requirements.md`、`design.md`、本 baseline 和后续能力矩阵只能把上述排除项写成 non-goal / out-of-scope。
- 新增能力必须在任务对应阶段补 service/API/UI/CLI 测试；不能只补按钮、文案或 mock 成功。
- 恢复任何排除项前必须新开 spec 或修改 requirements/design/tasks，并重新验收。
