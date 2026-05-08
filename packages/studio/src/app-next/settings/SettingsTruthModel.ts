import { getCodexRuntimeCapabilityStatuses } from "../../shared/codex-runtime-status";
import { PROXY_API_PATH, USER_SETTINGS_API_PATH } from "../backend-contract";

export type SettingsFactGroup =
  | "profile"
  | "models"
  | "agent-runtime"
  | "appearance"
  | "providers"
  | "server"
  | "storage"
  | "runtime-resources"
  | "usage"
  | "about"
  | "parity";

export type SettingsFactSource =
  | "user-settings"
  | "provider-summary"
  | "model-inventory"
  | "platform-accounts"
  | "session-config"
  | "runtime-state"
  | "capability-matrix"
  | "narrafork-reference"
  | "claude-source-reference"
  | "official-docs"
  | "default";

export type SettingsFactStatus = "current" | "partial" | "reference-only" | "unconfigured" | "unsupported" | "planned" | "unknown";

export type CodexParityFactId =
  | "parity.codex.tui"
  | "parity.codex.exec"
  | "parity.codex.execEventTaxonomy"
  | "parity.codex.sandbox"
  | "parity.codex.approval"
  | "parity.codex.mcp"
  | "parity.codex.subagents"
  | "parity.codex.webSearch"
  | "parity.codex.imageInput"
  | "parity.codex.review"
  | "parity.codex.windowsNative";

export type SettingsFactVerifiedBy = "browser" | "unit" | "integration" | "manual-source";

export interface SettingsFact<T> {
  readonly id: string;
  readonly label: string;
  readonly value?: T;
  readonly group: SettingsFactGroup;
  readonly source: SettingsFactSource;
  readonly status: SettingsFactStatus;
  readonly writable: boolean;
  readonly readApi?: string;
  readonly writeApi?: string;
  readonly reason?: string;
  readonly verifiedBy?: SettingsFactVerifiedBy;
}

export interface ModelSettingsInput {
  readonly modelDefaults?: {
    readonly defaultSessionModel?: string;
    readonly summaryModel?: string;
    readonly exploreSubagentModel?: string;
    readonly planSubagentModel?: string;
    readonly generalSubagentModel?: string;
    readonly subagentModelPool?: readonly string[];
    readonly codexReasoningEffort?: string;
  };
  readonly runtimeControls?: {
    readonly defaultReasoningEffort?: string;
  };
}

export interface AgentRuntimeSettingsInput extends ModelSettingsInput {
  readonly runtimeControls?: ModelSettingsInput["runtimeControls"] & {
    readonly defaultPermissionMode?: string;
    readonly maxTurnSteps?: number;
    readonly contextCompressionThresholdPercent?: number;
    readonly contextTruncateTargetPercent?: number;
    readonly largeWindowCompressionThresholdPercent?: number;
    readonly largeWindowTruncateTargetPercent?: number;
    readonly recovery?: {
      readonly maxRetryAttempts?: number;
      readonly initialRetryDelayMs?: number;
      readonly maxRetryDelayMs?: number;
      readonly backoffMultiplier?: number;
    };
    readonly toolAccess?: {
      readonly mcpStrategy?: string;
      readonly allowlist?: readonly string[];
      readonly blocklist?: readonly string[];
    };
    readonly runtimeDebug?: {
      readonly tokenDebugEnabled?: boolean;
      readonly rateDebugEnabled?: boolean;
      readonly dumpEnabled?: boolean;
    };
    readonly sendMode?: string;
  };
  readonly proxy?: {
    readonly webFetch?: string;
  };
}

export interface ProviderFixtureFactsInput {
  readonly cleanRoot: boolean;
  readonly providers: readonly {
    readonly id: string;
    readonly name: string;
    readonly prefix?: string;
    readonly models?: readonly { readonly id: string; readonly name: string }[];
  }[];
}

const USER_SETTINGS_API = USER_SETTINGS_API_PATH;

function hasOwn(object: unknown, key: string) {
  return typeof object === "object" && object !== null && Object.prototype.hasOwnProperty.call(object, key);
}

function isConfigured(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null;
}

function userSettingsFact<T>({
  id,
  label,
  value,
  reason,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: T | undefined;
  readonly reason?: string;
}): SettingsFact<T> {
  const configured = isConfigured(value);
  return {
    id,
    label,
    value,
    group: "models",
    source: "user-settings",
    status: configured ? "current" : "unconfigured",
    writable: true,
    readApi: USER_SETTINGS_API,
    writeApi: USER_SETTINGS_API,
    reason: configured ? undefined : (reason ?? "用户设置尚未配置该字段"),
    verifiedBy: "unit",
  };
}

function agentRuntimeFact<T>({
  id,
  label,
  value,
  readApi = USER_SETTINGS_API,
  writeApi = USER_SETTINGS_API,
  reason,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: T | undefined;
  readonly readApi?: string;
  readonly writeApi?: string;
  readonly reason?: string;
}): SettingsFact<T> {
  const configured = Array.isArray(value) ? true : isConfigured(value);
  return {
    id,
    label,
    value,
    group: "agent-runtime",
    source: "user-settings",
    status: configured ? "current" : "unconfigured",
    writable: true,
    readApi,
    writeApi,
    reason: configured ? undefined : (reason ?? "用户设置尚未配置该字段"),
    verifiedBy: "unit",
  };
}

function normalizedFixtureText(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function providerLooksLikeE2EFixture(provider: ProviderFixtureFactsInput["providers"][number]): boolean {
  const providerText = [provider.id, provider.name, provider.prefix].map(normalizedFixtureText).join(" ");
  if (providerText.includes("e2e-provider") || providerText.includes("e2e provider")) return true;
  return provider.models?.some((model) => {
    const modelText = [model.id, model.name].map(normalizedFixtureText).join(" ");
    return modelText.includes("e2e-model") || modelText.includes("e2e model");
  }) ?? false;
}

export function deriveProviderFixtureFacts(input: ProviderFixtureFactsInput): Array<SettingsFact<string>> {
  return input.providers
    .filter(providerLooksLikeE2EFixture)
    .map((provider) => ({
      id: `provider-fixture.${provider.id}`,
      label: `${provider.name} 测试夹具`,
      value: provider.name,
      group: "providers" as const,
      source: "provider-summary" as const,
      status: input.cleanRoot ? "unsupported" as const : "partial" as const,
      writable: false,
      reason: input.cleanRoot
        ? "clean root 不应出现 E2E 测试夹具；请使用隔离 root 或清理 provider 后再发布验收"
        : "检测到 E2E 测试夹具开发数据；发布验收应隐藏、清理或切换 clean root",
      verifiedBy: "unit" as const,
    }));
}

export function deriveModelSettingsFacts(config: ModelSettingsInput | null | undefined): Array<SettingsFact<string>> {
  const modelDefaults = config?.modelDefaults;
  const runtimeControls = config?.runtimeControls;
  const subagentPool = modelDefaults?.subagentModelPool ?? [];
  const facts: Array<SettingsFact<string>> = [
    userSettingsFact({ id: "model.defaultSessionModel", label: "默认模型", value: modelDefaults?.defaultSessionModel }),
    userSettingsFact({ id: "model.summaryModel", label: "摘要模型", value: modelDefaults?.summaryModel }),
    userSettingsFact({ id: "model.exploreSubagentModel", label: "Explore 子代理模型", value: modelDefaults?.exploreSubagentModel }),
    userSettingsFact({ id: "model.planSubagentModel", label: "Plan 子代理模型", value: modelDefaults?.planSubagentModel }),
  ];

  if (hasOwn(modelDefaults, "generalSubagentModel")) {
    facts.push(userSettingsFact({ id: "model.generalSubagentModel", label: "General 子代理模型", value: modelDefaults?.generalSubagentModel }));
  }

  if (hasOwn(modelDefaults, "codexReasoningEffort")) {
    facts.push(userSettingsFact({ id: "model.codexReasoningEffort", label: "Codex 推理强度", value: modelDefaults?.codexReasoningEffort }));
  }

  facts.push(
    userSettingsFact({ id: "model.subagentModelPool", label: "模型池限制", value: subagentPool.length ? `${subagentPool.length} 个` : undefined }),
    userSettingsFact({ id: "runtime.defaultReasoningEffort", label: "全局推理强度", value: runtimeControls?.defaultReasoningEffort }),
  );

  return facts;
}

export function deriveAgentRuntimeSettingsFacts(config: AgentRuntimeSettingsInput | null | undefined): Array<SettingsFact<unknown>> {
  const runtimeControls = config?.runtimeControls;
  const recovery = runtimeControls?.recovery;
  const toolAccess = runtimeControls?.toolAccess;
  const debug = runtimeControls?.runtimeDebug;

  return [
    agentRuntimeFact({ id: "runtime.defaultPermissionMode", label: "默认权限模式", value: runtimeControls?.defaultPermissionMode }),
    agentRuntimeFact({ id: "runtime.defaultReasoningEffort", label: "默认推理强度", value: runtimeControls?.defaultReasoningEffort }),
    agentRuntimeFact({ id: "runtime.maxTurnSteps", label: "最大轮次", value: runtimeControls?.maxTurnSteps }),
    agentRuntimeFact({ id: "runtime.contextCompressionThresholdPercent", label: "上下文压缩阈值 %", value: runtimeControls?.contextCompressionThresholdPercent }),
    agentRuntimeFact({ id: "runtime.contextTruncateTargetPercent", label: "上下文截断目标 %", value: runtimeControls?.contextTruncateTargetPercent }),
    agentRuntimeFact({ id: "runtime.largeWindowCompressionThresholdPercent", label: "大窗口压缩阈值 %", value: runtimeControls?.largeWindowCompressionThresholdPercent }),
    agentRuntimeFact({ id: "runtime.largeWindowTruncateTargetPercent", label: "大窗口截断目标 %", value: runtimeControls?.largeWindowTruncateTargetPercent }),
    agentRuntimeFact({ id: "runtime.recovery.maxRetryAttempts", label: "最大重试次数", value: recovery?.maxRetryAttempts }),
    agentRuntimeFact({ id: "runtime.recovery.initialRetryDelayMs", label: "初始重试延迟 ms", value: recovery?.initialRetryDelayMs }),
    agentRuntimeFact({ id: "runtime.recovery.maxRetryDelayMs", label: "退避上限 ms", value: recovery?.maxRetryDelayMs }),
    agentRuntimeFact({ id: "runtime.recovery.backoffMultiplier", label: "退避倍率", value: recovery?.backoffMultiplier }),
    {
      id: "runtime.firstTokenTimeoutMs",
      label: "首 token 超时",
      group: "agent-runtime",
      source: "capability-matrix",
      status: "planned",
      writable: false,
      reason: "NovelFork settings schema 尚无 first-token timeout 字段",
      verifiedBy: "unit",
    },
    ...getCodexRuntimeCapabilityStatuses()
      .filter((status) => status.id === "codex.sandboxMode" || status.id === "codex.approvalPolicy" || status.id === "codex.review" || status.id === "codex.imageInput")
      .map((status) => ({
        id: status.id === "codex.sandboxMode"
          ? "runtime.codexSandboxMode"
          : status.id === "codex.approvalPolicy"
            ? "runtime.codexApprovalPolicy"
            : status.id === "codex.review"
              ? "runtime.codexReview"
              : "runtime.codexImageInput",
        label: status.label,
        value: status.value,
        group: "agent-runtime" as const,
        source: "capability-matrix" as const,
        status: status.status,
        writable: false,
        reason: status.status === "partial" ? status.currentBehavior : status.unsupportedReason ?? status.currentBehavior,
        verifiedBy: "unit" as const,
      })),
    agentRuntimeFact({ id: "runtime.proxy.webFetch", label: "WebFetch 代理", value: config?.proxy?.webFetch, readApi: PROXY_API_PATH, writeApi: PROXY_API_PATH }),
    agentRuntimeFact({ id: "runtime.toolAccess.mcpStrategy", label: "MCP 工具策略", value: toolAccess?.mcpStrategy }),
    agentRuntimeFact({ id: "runtime.toolAccess.allowlist", label: "全局目录/命令白名单", value: toolAccess?.allowlist }),
    agentRuntimeFact({ id: "runtime.toolAccess.blocklist", label: "全局目录/命令黑名单", value: toolAccess?.blocklist }),
    agentRuntimeFact({ id: "runtime.debug.tokenUsage", label: "显示 Token 用量", value: debug?.tokenDebugEnabled }),
    agentRuntimeFact({ id: "runtime.debug.outputRate", label: "显示实时输出速率", value: debug?.rateDebugEnabled }),
    agentRuntimeFact({ id: "runtime.debug.dumpApiRequests", label: "Dump API 请求", value: debug?.dumpEnabled }),
    agentRuntimeFact({ id: "runtime.sendMode", label: "发送方式", value: runtimeControls?.sendMode }),
    {
      id: "runtime.storage.runtimeDir",
      label: "Runtime 存储目录",
      group: "agent-runtime" as const,
      source: "runtime-state" as const,
      status: "current" as const,
      value: "$NOVELFORK_RUNTIME_DIR 或 ~/.novelfork",
      writable: false,
      reason: "由环境变量 NOVELFORK_RUNTIME_DIR 或默认 ~/.novelfork 决定",
      verifiedBy: "unit" as const,
    },
    {
      id: "runtime.storage.sessionStore",
      label: "Session 存储",
      group: "agent-runtime" as const,
      source: "runtime-state" as const,
      status: "current" as const,
      value: "$NOVELFORK_SESSION_STORE_DIR 或 runtimeDir/sessions",
      writable: false,
      reason: "由环境变量 NOVELFORK_SESSION_STORE_DIR 或 runtimeDir/sessions 决定",
      verifiedBy: "unit" as const,
    },
    {
      id: "runtime.storage.transcript",
      label: "Transcript 存储",
      group: "agent-runtime" as const,
      source: "runtime-state" as const,
      status: "current" as const,
      value: "runtimeDir/sessions/:id/history.json",
      writable: false,
      reason: "每个 session 的 transcript 存储在 session store 内",
      verifiedBy: "unit" as const,
    },
    {
      id: "runtime.storage.checkpoint",
      label: "Checkpoint 存储",
      group: "agent-runtime" as const,
      source: "capability-matrix" as const,
      status: "planned" as const,
      value: "planned",
      writable: false,
      reason: "Checkpoint 存储路径尚未实现独立配置，当前由工具执行时内联创建",
      verifiedBy: "unit" as const,
    },
  ];
}

function codexParityFact({
  id,
  label,
  value,
  status,
  source = "capability-matrix",
  reason,
}: {
  readonly id: CodexParityFactId;
  readonly label: string;
  readonly value: string;
  readonly status: SettingsFactStatus;
  readonly source?: "capability-matrix" | "official-docs" | "user-settings";
  readonly reason: string;
}): SettingsFact<string> {
  return {
    id,
    label,
    value,
    group: "parity",
    source,
    status,
    writable: false,
    reason,
    verifiedBy: "manual-source",
  };
}

export function deriveClaudeParitySettingsFacts(): Array<SettingsFact<string>> {
  const fact = (input: {
    readonly id: string;
    readonly label: string;
    readonly value: string;
    readonly status: SettingsFactStatus;
    readonly reason: string;
  }): SettingsFact<string> => ({
    id: input.id,
    label: input.label,
    value: input.value,
    group: "parity",
    source: "claude-source-reference",
    status: input.status,
    writable: false,
    reason: input.reason,
    verifiedBy: "manual-source",
  });

  return [
    fact({
      id: "parity.claude.slashRegistry",
      label: "Claude slash 命令注册",
      value: "partial",
      status: "partial",
      reason: "Claude 源码 getCommands 会合并 bundled skills、skills dir、workflow、plugin、dynamic skills 与大量 builtin/local-jsx/prompt 命令；NovelFork 当前只是静态 7 个 Composer slash command，不能宣称完整对标。",
    }),
    fact({
      id: "parity.claude.permissions",
      label: "Claude permission pipeline",
      value: "partial",
      status: "partial",
      reason: "Claude permission pipeline 包含多来源规则、ruleContent、MCP 规则、hooks、classifier/auto mode、sandbox 与 headless fallback；NovelFork ask/edit/allow/read/plan + toolPolicy 只是写作产品语义的 partial 映射。",
    }),
    fact({
      id: "parity.claude.sessionResumeFork",
      label: "Claude session resume/fork 存储",
      value: "partial",
      status: "partial",
      reason: "NovelFork 会话 lifecycle 是自身 session store 的 current 能力，但不是 Claude JSONL transcript、parentUuid chain、file history、attribution、todos、worktree/agent metadata 的完整恢复。",
    }),
    fact({
      id: "parity.claude.headlessUsage",
      label: "Claude headless/result/usage",
      value: "partial",
      status: "partial",
      reason: "NovelFork headless chat 有 NDJSON 与 usage envelope，但没有 Claude SDK/print 完整事件 taxonomy、OAuth utilization、per-model cost tracker 或 rate-limit usage UI。",
    }),
    fact({
      id: "parity.claude.terminalTui",
      label: "Claude Code 终端 TUI",
      value: "non-goal",
      status: "unsupported",
      reason: "NovelFork v0.1.0 不复制完整 Claude Code 终端 TUI，只保留 Web 工作台会话能力。",
    }),
    fact({
      id: "parity.claude.chromeBridge",
      label: "Claude Chrome bridge / remote control / plugin market",
      value: "non-goal",
      status: "unsupported",
      reason: "Claude 源码包含 chrome/bridge/remote-control/plugin/IDE 等终端生态命令；NovelFork 当前 non-goal，不在设置页显示为已接入。",
    }),
  ];
}

export function deriveCodexParitySettingsFacts(): Array<SettingsFact<string>> {
  return [
    codexParityFact({
      id: "parity.codex.tui",
      label: "Codex 终端 TUI",
      value: "non-goal",
      status: "unsupported",
      reason: "Codex CLI `codex` 提供交互式终端 TUI；NovelFork 当前采用 Web 工作台，不复制完整 Codex TUI，不能在设置页显示为已接入。",
    }),
    codexParityFact({
      id: "parity.codex.exec",
      label: "Codex non-interactive exec",
      value: "partial",
      status: "partial",
      reason: "NovelFork 已有 headless chat / stream-json envelope，但不是 Codex `codex exec` 的完整 JSONL event taxonomy、schema output 或 CI API key 语义。",
    }),
    codexParityFact({
      id: "parity.codex.execEventTaxonomy",
      label: "Codex exec JSONL event taxonomy",
      value: "reference-only",
      status: "reference-only",
      reason: "当前只有本机 help/官方文档作为参考；NovelFork NDJSON 事件不是 Codex exec 完整 JSONL event schema、structured output schema 或 resume event taxonomy，不能作为 current 能力宣传。",
    }),
    codexParityFact({
      id: "parity.codex.sandbox",
      label: "Codex sandbox 模式",
      value: "planned",
      status: "planned",
      reason: "Codex sandbox 区分 read-only / workspace-write / danger-full-access，并有 Windows 原生 restricted-token sandbox；NovelFork 当前没有真实 OS sandbox，只能以 permissionMode/toolPolicy 做运行前审批。",
    }),
    codexParityFact({
      id: "parity.codex.approval",
      label: "Codex approval policy",
      value: "partial",
      status: "partial",
      reason: "Codex approval policy 包含 untrusted / on-request / never / granular（本机 0.80.0 help 仍列 on-failure）；NovelFork permissionMode/toolPolicy 可表达 ask/allow/deny，但没有 Codex sandbox escalation 或 granular approval_policy 完整模型。",
    }),
    codexParityFact({
      id: "parity.codex.mcp",
      label: "Codex MCP 配置",
      value: "planned",
      status: "planned",
      reason: "Codex 支持 mcp server/client 配置和 `codex mcp` 管理；NovelFork 当前仅有 MCP 工具策略字段，不等价于 Codex MCP server 管理。",
    }),
    codexParityFact({
      id: "parity.codex.subagents",
      label: "Codex subagents",
      value: "partial",
      status: "partial",
      reason: "NovelFork 有 Explore/Plan/General 子代理模型设置和内部代理流程，但没有 `.codex/agents` TOML、Codex custom agent 格式或 sandbox/approval 继承语义。",
    }),
    codexParityFact({
      id: "parity.codex.webSearch",
      label: "Codex web search",
      value: "partial",
      status: "partial",
      reason: "Codex `--search` 启用 native web_search；NovelFork 暴露 WebFetch/proxy 与工具能力，但不是 Codex native web_search flag。",
    }),
    codexParityFact({
      id: "parity.codex.imageInput",
      label: "Codex image input",
      value: "planned",
      status: "planned",
      reason: "Codex CLI 支持 `--image/-i`；NovelFork 当前 composer 没有等价图片附件合同，不能宣称已接入。",
    }),
    codexParityFact({
      id: "parity.codex.review",
      label: "Codex code review",
      value: "planned",
      status: "planned",
      reason: "本机 Codex CLI 暴露 `review` 子命令；NovelFork 当前没有 Codex-style review subcommand/UI。",
    }),
    codexParityFact({
      id: "parity.codex.windowsNative",
      label: "Codex Windows 原生边界",
      value: "partial",
      status: "partial",
      reason: "NovelFork 运行纪律要求 Windows 原生且不要求 WSL；Codex 官方也有 Windows 原生 sandbox 文档，但 NovelFork 尚未实现 Codex restricted-token sandbox。",
    }),
  ];
}

export function settingsFactDisplayValue(fact: SettingsFact<unknown>) {
  if (Array.isArray(fact.value)) return fact.value.length ? fact.value.join("、") : "空列表";
  if (typeof fact.value === "string") return fact.value.trim() ? fact.value : "未配置";
  if (fact.value === undefined || fact.value === null) return "未配置";
  return String(fact.value);
}

export function settingsFactSourceLabel(source: SettingsFactSource) {
  const labels: Record<SettingsFactSource, string> = {
    "user-settings": "用户设置",
    "provider-summary": "供应商总览",
    "model-inventory": "模型清单",
    "platform-accounts": "平台账号",
    "session-config": "会话配置",
    "runtime-state": "运行状态",
    "capability-matrix": "能力矩阵",
    "narrafork-reference": "NarraFork 参考",
    "claude-source-reference": "Claude 源码参考",
    "official-docs": "官方文档",
    default: "默认值",
  };
  return labels[source];
}

export function settingsFactStatusLabel(status: SettingsFactStatus) {
  const labels: Record<SettingsFactStatus, string> = {
    current: "已配置",
    partial: "部分接入",
    "reference-only": "仅参考",
    unconfigured: "未配置",
    unsupported: "不支持",
    planned: "计划中",
    unknown: "未确认",
  };
  return labels[status];
}
