# Claude Code Parity Baseline

> 日期：2026-05-06  
> 服务范围：`ui-live-parity-hardening-v1` Task 11  
> 目的：把 Claude Code CLI 能力与 NovelFork 当前状态逐项分开，禁止把 partial/planned/non-goal 写成 UI “已接入”。

## 来源与版本

| 来源 | 证据 | 读取日期 | 事实 |
|---|---|---:|---|
| 本机 CLI | `claude --version` | 2026-05-06 | 返回 `2.1.69 (Claude Code)`。 |
| 本机 help baseline | `.kiro/specs/conversation-parity-v1/claude-code-parity-baseline.md` 同日记录的 `claude --help` | 2026-05-06 | 顶层 help 暴露 `--continue`、`--resume`、`--fork-session`、`--input-format stream-json`、`--output-format json/text/stream-json`、`--allowedTools`、`--disallowedTools`、`--permission-mode`、`--max-budget-usd`、`--no-session-persistence`、`--session-id`、`--model`、`--agent`、`--agents`、`--worktree`、`--tmux`、`--chrome`、`server`、`mcp`、`agents`、`plugin` 等。当前会话中直接重跑 `claude --help` 被工具权限层拒绝，因此本文件采用同日旧 baseline + 本地源码双证据，不虚构 fresh help 输出。 |
| 官方文档 | Claude Code CLI reference：`https://code.claude.com/docs/en/cli-reference` | 2026-05-06 | 官方 CLI reference 是 help surface 的公开口径来源；本矩阵仅使用与本地 2.1.69 源码/旧 help baseline 相互印证的能力。 |
| 本地源码 | `claude/restored-cli-src/src/main.tsx` | 2026-05-06 | 记录 `--print`、`--output-format`、`--input-format`、`--allowedTools`/`--allowed-tools`、`--tools`、`--disallowedTools`/`--disallowed-tools`、`--mcp-config`、`--permission-prompt-tool`、`--permission-mode`、`--continue`、`--resume`、`--fork-session`、`--settings`、`--agents`、`--add-dir`、`--worktree`、`--tmux`、`--chrome`、`--ide`、`--plugin-dir` 等 CLI surface。 |
| 本地源码 | `claude/restored-cli-src/src/types/permissions.ts` | 2026-05-06 | `EXTERNAL_PERMISSION_MODES = acceptEdits / bypassPermissions / default / dontAsk / plan`；内部还存在 `auto`、`bubble` 类型；permission rule source 包含 user/project/local/flag/policy settings、cliArg、command、session。 |
| 本地源码 | `claude/restored-cli-src/src/utils/permissions/permissions.ts` | 2026-05-06 | permission request message 能来自 rule、mode、hook、permissionPromptTool、sandboxOverride、workingDir、safetyCheck 等来源。 |

## 状态定义

| 状态 | 含义 | UI 守护 |
|---|---|---|
| `current` | NovelFork 已有真实 UI/API/CLI，并有测试或浏览器/CLI 证据 | 可显示为当前可用，但必须附验证来源 |
| `partial` | NovelFork 有产品化等价能力，但与 Claude 原语不完全一致 | 不得写“完整 Claude parity” |
| `planned` | 计划做但当前不可调用 | 设置页只显示计划/未接入原因 |
| `non-goal` | 明确不做 | 不得进入 UI “已接入/可用/current” |
| `unknown` | 信息不足 | 不得宣传为能力 |

## Claude Code → NovelFork 守护矩阵

| Capability | Upstream evidence | NovelFork status | UI/API/CLI surface | Verification | Notes |
|---|---|---|---|---|---|
| continue latest | CLI help baseline `--continue`；`main.tsx` `.option('-c, --continue', ...)` | current | SessionCenter continue latest、`/api/sessions/lifecycle/latest` | conversation-parity-v1 lifecycle/session tests；当前能力矩阵已标 current | NovelFork 按书籍/章节/worktree scope 定义最近会话，不复制终端 picker。 |
| resume by id/search | CLI help baseline `--resume [value]`、`--session-id`；`main.tsx` resume option | current | ResumePicker、`/api/sessions/:id`、chat state/history、WebSocket replay | session lifecycle + runtime tests | 归档会话默认只读或显式 restore，不创建空假会话。 |
| fork session | CLI help baseline `--fork-session`；`main.tsx` fork option | current | ForkDialog、`/api/sessions/:id/fork` | fork service/UI tests | 继承必要配置/绑定和 summary，不复制无限历史、不复用源 sessionId。 |
| print/headless | CLI help baseline `-p/--print`；`main.tsx` output/input format options | current | `POST /api/sessions/headless-chat`、`novelfork chat`、兼容 `novelfork exec` | headless API/CLI tests | NovelFork 输出 text/json/stream-json 与 pending confirmation exit code；不复刻完整 Claude SDK daemon。 |
| stream-json input/output | CLI help baseline `--input-format stream-json`、`--output-format stream-json` | current | headless chat NDJSON + CLI stream-json | headless stream-json tests | 不虚构模型成功；provider unavailable/permission_request 走真实 envelope。 |
| permission-mode | `types/permissions.ts` external modes；`main.tsx --permission-mode` | partial | NovelFork `ask/edit/allow/read/plan` sessionConfig + toolPolicy | session config/tool policy tests | NovelFork 中文产品语义映射 Claude default/acceptEdits/bypassPermissions/dontAsk/plan，但没有 1:1 sandbox/classifier。 |
| allowed/disallowed tools | `main.tsx --allowedTools/--disallowedTools`；`permissions.ts` allow/deny/ask rules | current | `sessionConfig.toolPolicy.allow/deny/ask`、provider schema filter | session-tool-policy tests | NovelFork 按小说资源风险、dirty canvasContext、模型工具能力合并治理。 |
| tool set filtering | `main.tsx --tools` | partial | provider tools schema + denied tools filter | provider/session tool policy tests | NovelFork 当前不提供完整 CLI `--tools` built-in set 选择 UI。 |
| MCP config | `main.tsx --mcp-config`、`--strict-mcp-config`；Claude 组件参考 MCPSettings | partial | `/next/routines` MCP 页面、settings/runtime facts | routines/MCP 页面作为 current 资产，Task 11 仅标 partial | NovelFork 不把 Claude MCP config JSON CLI 语义写成已完整接入。 |
| permission prompt tool | `main.tsx --permission-prompt-tool`；`permissions.ts` reason type `permissionPromptTool` | planned | 仅 pending confirmation UI/tool policy | Task 10 UI 展示 permission source；无 MCP prompt-tool 后端 | 不显示“permission prompt tool 已接入”。 |
| settings file/json | `main.tsx --settings <file-or-json>` | partial | `/api/settings/user`、SettingsTruthModel | settings tests | NovelFork 是 Web settings API，不等同 Claude settings file precedence。 |
| agents json | `main.tsx --agents <json>`；Claude agent tool selection 源码参考 | partial | Subagent runtime settings、Routines/subagents | SettingsTruthModel/RuntimeControlPanel tests | NovelFork 子代理模型/类型 current，但无 Claude `--agents` JSON CLI 完整等价。 |
| add-dir | `main.tsx --add-dir`；`types/permissions.ts` additional working directories | partial | runtimeControls allowlist/blocklist facts | SettingsTruthModel tests | NovelFork 表达全局目录/命令 allow/deny，不做 Claude working directory source 完整 UI。 |
| worktree | `main.tsx --worktree`、entrypoint worktree fast path | partial | session `worktree`、`/api/worktree/status?path=`、Conversation header | Task 9 tests | NovelFork 显示/读取 worktree 状态，不自动创建 Claude 式 worktree session。 |
| tmux | `main.tsx --tmux`；Windows 分支提示 `--tmux is not supported on Windows` | non-goal | 能力矩阵/文档 only | parity validator non-goal guard | 本项目 Windows 原生运行，不要求 WSL；不实现 tmux parity。 |
| Chrome bridge | `main.tsx --chrome/--no-chrome`、`commands/chrome/chrome.tsx` | non-goal | 能力矩阵/文档 only | parity validator non-goal guard | NovelFork 不实现 Claude Chrome extension bridge；不得在 UI 显示已接入。 |
| IDE/server remote-control | `main.tsx --ide`、`server`/`ssh` command 源码 | non-goal | 能力矩阵/文档 only | parity validator non-goal guard | 不实现 IDE auto-connect、remote-control server 或 SSH remote agent parity。 |
| plugins/plugin-dir | CLI help baseline `plugin`、`--plugin-dir` | non-goal | 能力矩阵/文档 only | parity validator non-goal guard | 不实现 Claude plugin marketplace 或 plugin runtime。 |
| usage/result | CLI json/stream-json result、`--max-budget-usd` | current | headless result envelope、session cumulativeUsage、status bar usage | conversation-parity Task 12 tests；Task 9/10 status tests | 成本未知显示 unknown，不编造 USD。 |

## 权限模式映射守护

| Claude external mode | NovelFork closest mode | 状态 | 差异 |
|---|---|---|---|
| `default` | `ask` | partial | Claude 还叠加 setting sources、permission rules、hooks/classifier；NovelFork 以 sessionConfig/toolPolicy/resource risk 为准。 |
| `acceptEdits` | `edit` | partial | NovelFork edit 是允许编辑类工具的产品化模式，不等于 Claude 全部 accept edits 规则。 |
| `bypassPermissions` | `allow` | partial | NovelFork allow 仍不得绕过候选稿/正式资源 checkpoint/dirty guard。 |
| `dontAsk` | `read`/deny-like policy | partial | NovelFork 没有完全同名模式；read 表示只读/更保守能力。 |
| `plan` | `plan` | partial | NovelFork plan 禁用 allow/edit 更新，仍按会话类型和 UI validation 执行。 |
| internal `auto` / `bubble` | none | non-goal/unknown | 不在 NovelFork UI 暴露为 current。 |

## Validator 与 UI 守护

- `packages/studio/src/app-next/settings/parity-matrix.ts` 定义 `current/partial/planned/non-goal/unknown` 状态枚举和 validator。
- `packages/studio/src/app-next/settings/parity-matrix.test.ts` 覆盖非法状态、缺来源、缺日期、non-goal 不得进入 UI current claim。
- `deriveClaudeParitySettingsFacts()` 只把 Claude TUI/Chrome bridge 显示为 `unsupported` / `non-goal`，permission modes 显示 `partial`，不写“已接入”。

## 仍需后续任务覆盖

- Codex CLI sandbox/approval 对照由 Task 12 单独建模；不得把本文件的 Claude permission partial 映射复用成 Codex sandbox current。
- 浏览器 E2E 验证对话窗口和设置页 current 声明由 Task 13 执行。
