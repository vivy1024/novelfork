# Codex CLI Parity Baseline

> 日期：2026-05-06  
> 服务范围：`ui-live-parity-hardening-v1` Task 12  
> 目的：把 OpenAI Codex CLI 的 TUI、exec、sandbox、approval、MCP、subagents、web search、image input、review 与 Windows 支持逐项映射到 NovelFork 当前状态，禁止把 partial/planned/non-goal 写成 UI “已接入”。

## 来源与版本

| 来源 | 证据 | 读取日期 | 事实 |
|---|---|---:|---|
| 本机 CLI | `codex --version` | 2026-05-06 | 返回 `codex-cli 0.80.0`。 |
| 本机 CLI | `codex --help` | 2026-05-06 | 顶层 help 暴露交互式 CLI、`exec`、`review`、`mcp`、`mcp-server`、`app-server`、`sandbox`、`resume`、`cloud`、`--config key=value`、`--profile`、`--image`、`--model`、`--sandbox read-only|workspace-write|danger-full-access`、`--ask-for-approval untrusted|on-failure|on-request|never`、`--full-auto`、`--dangerously-bypass-approvals-and-sandbox`、`--search`、`--add-dir` 等。 |
| 本机 CLI | `codex exec --help` | 2026-05-06 | non-interactive exec 支持 stdin prompt、`resume`、`review`、`--json`、`--output-schema`、`--output-last-message`、`--skip-git-repo-check`、`--image`、`--sandbox`、`--full-auto`、`--add-dir` 等。 |
| 本机 CLI | `codex mcp --help` | 2026-05-06 | `codex mcp` 支持 `list/get/add/remove/login/logout`；顶层 help 同时暴露 experimental `mcp-server`。 |
| 本机 CLI | `codex review --help` | 2026-05-06 | `review` 支持 `--uncommitted`、`--base`、`--commit`、`--title`。 |
| 本机 CLI | `codex sandbox --help` | 2026-05-06 | `sandbox` 暴露 `macos`、`linux`、`windows` 子命令；`windows` help 未继续执行（权限层拒绝），因此本文件不虚构其细项。 |
| 官方文档 | Codex CLI reference：`https://developers.openai.com/codex/cli/reference` | 2026-05-06 | 官方 CLI reference 是命令/flag 的公开口径来源；本矩阵记录本机 0.80.0 与官方文档存在差异处。 |
| 官方文档 | Codex config reference：`https://developers.openai.com/codex/config-reference` | 2026-05-06 | 记录 `sandbox_mode`、`approval_policy`、`sandbox_workspace_write`、`tools.web_search`、`mcp_servers`、profiles、feature flags 等配置口径。官方当前 `approval_policy` 包含 `untrusted`、`on-request`、`never`、`granular`；`on-failure` 已标 deprecated，但本机 0.80.0 help 仍列出。 |
| 官方文档 | Codex non-interactive mode：`https://developers.openai.com/codex/noninteractive` | 2026-05-06 | 记录 `codex exec` 在 CI/automation 的非交互用法、JSON/last-message 输出与 resume。 |
| 官方文档 | Codex subagents：`https://developers.openai.com/codex/subagents` | 2026-05-06 | 记录 Codex subagents、custom agents 与 `.codex/agents` / `~/.codex/agents` TOML 文件。 |
| 官方文档 | Codex Windows：`https://developers.openai.com/codex/windows` | 2026-05-06 | 记录 Windows native 使用与 Windows sandbox；本文只将其作为上游能力边界，不要求 NovelFork 切换 WSL。 |
| NovelFork 代码 | `packages/studio/src/app-next/settings/parity-matrix.ts`、`SettingsTruthModel.ts` | 2026-05-06 | 新增 `CODEX_CLI_PARITY_MATRIX` 与 `deriveCodexParitySettingsFacts()`，把 Codex sandbox/approval 差异作为 capability-matrix 来源守护。 |

## 状态定义

| 状态 | 含义 | UI 守护 |
|---|---|---|
| `current` | NovelFork 已有真实 UI/API/CLI，并有测试或浏览器/CLI 证据 | 可显示为当前可用，但必须附验证来源 |
| `partial` | NovelFork 有产品化等价能力，但与 Codex 原语不完全一致 | 不得写“完整 Codex parity” |
| `planned` | 计划做但当前不可调用 | 设置页只显示计划/未接入原因 |
| `non-goal` | 明确不做 | 不得进入 UI “已接入/可用/current” |
| `unknown` | 信息不足 | 不得宣传为能力 |

## Codex CLI → NovelFork 守护矩阵

| Capability | Upstream evidence | NovelFork status | UI/API/CLI surface | Verification | Notes |
|---|---|---|---|---|---|
| Codex TUI | 本机 `codex --help`；官方 CLI reference interactive | non-goal | NovelFork Web 工作台 `/next`，不提供 Codex 终端 TUI | parity matrix + SettingsTruthModel tests | Codex `codex` 启动交互式终端 UI；NovelFork 明确使用 Web 工作台和 narrator route，不复制完整 Codex TUI。 |
| Codex non-interactive exec | 本机 `codex exec --help`；官方 non-interactive mode | partial | `POST /api/sessions/headless-chat`、`novelfork chat/exec` stream-json | conversation-parity headless tests；Task 12 matrix guard | NovelFork 已有 headless text/stream-json 会话 envelope，但不等于 Codex `exec` 的完整 JSONL event taxonomy、JSON Schema 输出、CI API key 行为。 |
| Codex config file and profile overrides | 本机 `-c key=value`、`--profile`；官方 config reference | partial | `/api/settings/user`、session config、SettingsTruthModel facts | SettingsTruthModel tests | NovelFork 使用自身 settings schema，不兼容 `~/.codex/config.toml`、profile layer 或 `-c` TOML override precedence。 |
| Codex sandbox modes | 本机 `--sandbox read-only|workspace-write|danger-full-access`；官方 `sandbox_mode`；官方 Windows sandbox | planned | 能力矩阵 / parity 设置事实；不渲染 current sandbox 控件 | `parity-matrix.test.ts`、`SettingsTruthModel.test.ts` | Codex sandbox 明确区分 `read-only`、`workspace-write`、`danger-full-access`；NovelFork 当前只有 permissionMode/toolPolicy/dirty guard，没有真实 OS sandbox。不得显示“Codex sandbox 已接入”。 |
| Codex approval policy | 本机 `--ask-for-approval untrusted|on-failure|on-request|never`；官方 `approval_policy untrusted|on-request|never|granular` | partial | `SessionConfig.permissionMode` + `toolPolicy allow/deny/ask` | ConversationSurface/session/tool policy tests；Task 12 matrix guard | 本机 0.80.0 help 仍列 `on-failure`，官方当前标其 deprecated 并增加 `granular`。NovelFork permissionMode/toolPolicy 能表达 ask/allow/deny 和 pending confirmation，但没有 Codex sandbox escalation、execpolicy 或 granular approval_policy 完整模型。 |
| Codex MCP server/client configuration | 本机 `codex mcp --help`；官方 `mcp_servers` config | planned | SettingsTruthModel runtime MCP strategy 仅为 user setting/toolAccess 事实 | SettingsTruthModel runtime facts tests | Codex 支持 MCP server/client 管理、stdio/streamable HTTP、env、tool allow-deny、OAuth；NovelFork 当前不是 Codex MCP manager。 |
| Codex subagents | 官方 Codex subagents；NovelFork 子代理模型字段 | partial | Explore/Plan/General 子代理模型设置 + 内部 narrator subagent 流程 | SettingsTruthModel model/runtime tests | Codex custom agents 通过 `.codex/agents` / `~/.codex/agents` TOML 定义，并继承 sandbox/approval；NovelFork 无 Codex agent TOML 或 sandbox 继承语义。 |
| Codex web search | 本机 `--search`；官方 `tools.web_search` | partial | WebFetch tool/proxy setting；非 Codex native `web_search` flag | SettingsTruthModel runtime facts tests | Codex 有 native `web_search` 开关和 `--search`；NovelFork 暴露 WebFetch/proxy 与工具能力，但不是 Codex first-party web_search event/model。 |
| Codex image input | 本机 `--image/-i FILE`；官方 CLI features image inputs | planned | 能力矩阵；当前 composer 未接 Codex-style image attachment | Task 12 matrix guard | Codex CLI 支持 image input；NovelFork 当前对话输入没有等价图片附件合同。 |
| Codex code review | 本机 `codex review --help`；官方 command overview | planned | NovelFork 没有 Codex-style review subcommand/UI | Task 12 matrix guard | 后续若要做 code review UI/CLI，需要另开 spec，不得把现有普通会话宣传为 Codex review。 |
| Codex Windows native support boundary | 本机 `codex sandbox --help` 暴露 `windows`；官方 Windows docs；NovelFork 项目规则 | partial | 项目运行约束与能力矩阵；不要求 WSL | SettingsTruthModel Codex parity facts | Codex 官方提供 Windows native 与 sandbox 文档；NovelFork 同样坚持 Windows 原生，但尚未实现 Codex restricted-token sandbox，因此只能标 partial。 |

## Sandbox 映射守护

| Codex sandbox mode | Codex 含义 | NovelFork 当前状态 | 差异 |
|---|---|---|---|
| `read-only` | 只允许读取，禁止写入和多数外部副作用 | planned | NovelFork 有 `permissionMode=read`/tool deny，但不是 OS 级只读沙箱；Bash/文件系统限制仍由宿主工具权限和业务逻辑控制。 |
| `workspace-write` | 允许工作区写入，工作区外受限，可配 `writable_roots`/网络等 | planned | NovelFork 有资源 dirty guard/checkpoint 和 toolPolicy，但没有 Codex workspace write sandbox、网络域名 allowlist 或 OS 隔离。 |
| `danger-full-access` | 跳过沙箱隔离，极高风险 | non-goal/currently blocked | NovelFork 不提供“Codex danger-full-access 已接入”设置；即使 permissionMode=allow，也不能绕过正式正文 checkpoint/dirty guard 或平台权限确认。 |

## Approval policy 映射守护

| Codex approval policy | 来源 | NovelFork closest mode | 状态 | 差异 |
|---|---|---|---|---|
| `untrusted` | 本机 help + 官方 config | `ask` + trusted/read allowlist | partial | NovelFork 没有 Codex trusted command classifier，也没有 sandbox escalation 同步模型。 |
| `on-request` | 本机 help + 官方 config | 模型/工具请求 pending confirmation | partial | NovelFork 由 toolPolicy/resource risk 触发确认，不是 Codex CLI 同名 policy。 |
| `never` | 本机 help + 官方 config | `read`/deny-biased policy | partial | NovelFork `read` 不是 Codex never；仍会按工具策略返回 policy-denied 或 permission-required。 |
| `granular` | 官方 config | none | planned | 当前仅在 parity matrix 中记录，不渲染为可编辑 current 控件。 |
| `on-failure` | 本机 0.80.0 help；官方 config 标 deprecated | none | unknown/planned | 只记录版本差异，不把 deprecated 本机 help 项当成 NovelFork current。 |

## Validator 与 UI 守护

- `packages/studio/src/app-next/settings/parity-matrix.ts` 定义 `CODEX_CLI_PARITY_MATRIX`，覆盖 TUI、exec、config、sandbox、approval、MCP、subagents、web search、image input、review、Windows native boundary。
- `packages/studio/src/app-next/settings/parity-matrix.test.ts` 要求 Codex matrix 全部有日期来源，且 sandbox 为 `planned`、approval 为 `partial`，二者 `uiClaimAllowed: false`。
- `packages/studio/src/app-next/settings/SettingsTruthModel.ts` 的 `deriveCodexParitySettingsFacts()` 只从 capability matrix / official docs / user settings 派生 Codex 设置事实；sandbox 显示 `planned`，approval 显示 `partial`，Windows native boundary 显示 `partial`。
- 设置页不得出现“Codex sandbox 已接入”“Codex approval 完整接入”或把 `permissionMode/toolPolicy` 等同于 Codex OS sandbox 的文案。

## 后续任务

- Task 13 继续用浏览器 E2E 验证设置页和对话窗口是否隐藏/标注 partial/planned 能力。
- 若未来真的实现 OS sandbox，必须新增独立 spec，更新本矩阵、SettingsTruthModel tests、能力矩阵和用户可见文案。
