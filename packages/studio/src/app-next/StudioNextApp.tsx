import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createFetchJsonContractClient,
  createProviderClient,
  createResourceClient,
  createSessionClient,
  type ContractResult,
  type ResourceDomainClient,
} from "./backend-contract";
import {
  ConversationRoute,
  useAgentConversationRuntime,
  type ConversationRouteMessage,
  type ConversationRouteStatus,
} from "./agent-conversation";
import type { ConversationConfirmation, ConversationSessionConfigPatch } from "./agent-conversation/surface";
import type { RuntimeModelPoolEntry } from "../shared/provider-catalog";
import type { CanvasContext, ToolConfirmationRequest } from "../shared/agent-native-workspace";
import type { NarratorSessionChatMessage, NarratorSessionChatSnapshot, NarratorSessionRecord, SessionCumulativeUsage, SessionPermissionMode, TokenUsage, UpdateNarratorSessionInput } from "../shared/session-types";
import { resolveStudioNextRoute, type StudioNextRoute } from "./entry";
import { SearchPage } from "./search/SearchPage";
import { RoutinesNextPage } from "./routines/RoutinesNextPage";
import { SessionCenterPage } from "./sessions/SessionCenterPage";
import { SettingsLayout, type SettingsSectionItem } from "./components/layouts";
import { Button } from "../components/ui/button";
import { ProviderSettingsPage } from "./settings/ProviderSettingsPage";
import { SettingsSectionContent } from "./settings/SettingsSectionContent";
import { AgentShell, toShellPath, useShellData, useShellDataStore, type ShellBookItem, type ShellRoute, type ShellSessionItem, type ShellDataProviderSummary, type ShellDataProviderStatus } from "./shell";
import {
  applyResourceDetailToNode,
  loadResourceDetailState,
  resourceNeedsDetailHydration,
  saveResourceAndHydrate,
  loadWorkbenchResourcesFromContract,
  WorkbenchWritingActions,
  WritingWorkbenchRoute,
  type WorkbenchCanvasContext,
  type WorkbenchResourceNode,
  type WorkbenchResourcesResult,
  type WorkbenchWritingActionsSessionClient,
} from "./writing-workbench";

interface StudioNextAppProps {
  readonly initialRoute?: StudioNextRoute;
}

const SETTINGS_SECTIONS: readonly SettingsSectionItem[] = [
  { id: "profile", label: "个人资料", group: "个人设置" },
  { id: "models", label: "模型", group: "个人设置" },
  { id: "agents", label: "AI 代理", group: "个人设置" },
  { id: "notifications", label: "通知", group: "个人设置" },
  { id: "appearance", label: "外观与界面", group: "个人设置" },
  { id: "providers", label: "AI 供应商", group: "实例管理" },
  { id: "server", label: "服务器与系统", group: "实例管理" },
  { id: "config", label: "项目配置", group: "实例管理" },
  { id: "storage", label: "存储空间", group: "运行资源与审计" },
  { id: "resources", label: "运行资源", group: "运行资源与审计" },
  { id: "history", label: "使用历史", group: "运行资源与审计" },
  { id: "about", label: "关于", group: "关于与项目" },
];

function ShellPlaceholder({ title, description }: { readonly title: string; readonly description: string }) {
  return (
    <section className="flex h-full flex-1 flex-col p-6" data-testid="agent-shell-route">
      <p className="text-xs font-medium text-muted-foreground">NovelFork Next</p>
      <h1 className="mt-2 text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </section>
  );
}

function providerSummaryRecord(providerSummary: ShellDataProviderSummary | null): Record<string, unknown> | null {
  if (!providerSummary || typeof providerSummary !== "object") return null;
  const record = providerSummary as Record<string, unknown>;
  if (record.summary && typeof record.summary === "object") return record.summary as Record<string, unknown>;
  return record;
}

function providerRuntimeStatus(providerStatus: ShellDataProviderStatus | null): { readonly hasUsableModel?: boolean; readonly defaultProvider?: string; readonly defaultModel?: string; readonly lastConnectionError?: string } | null {
  if (!providerStatus || typeof providerStatus !== "object") return null;
  const record = providerStatus as Record<string, unknown>;
  if (record.status && typeof record.status === "object") return record.status as { readonly hasUsableModel?: boolean; readonly defaultProvider?: string; readonly defaultModel?: string; readonly lastConnectionError?: string };
  return record as { readonly hasUsableModel?: boolean; readonly defaultProvider?: string; readonly defaultModel?: string; readonly lastConnectionError?: string };
}

function HomeRouteAction({ label, onClick, variant = "outline" }: { readonly label: string; readonly onClick: () => void; readonly variant?: "default" | "outline" }) {
  return <Button type="button" variant={variant} onClick={onClick}>{label}</Button>;
}

function HomeStatCard({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold text-foreground">{value}</div>
    </div>
  );
}

interface HomeRouteLiveProps {
  readonly books: readonly ShellBookItem[];
  readonly sessions: readonly ShellSessionItem[];
  readonly providerSummary: ShellDataProviderSummary | null;
  readonly providerStatus: ShellDataProviderStatus | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onNavigate: (route: ShellRoute) => void;
}

function HomeRouteLive({ books, sessions, providerSummary, providerStatus, loading, error, onNavigate }: HomeRouteLiveProps) {
  const recentBooks = books.slice(0, 3);
  const recentSessions = sessions.slice(0, 3);
  const summary = providerSummaryRecord(providerSummary);
  const runtimeStatus = providerRuntimeStatus(providerStatus);
  const providerList = Array.isArray(summary?.providers) ? (summary.providers as readonly unknown[]) : null;
  const providerCount = providerList?.length;
  const activeProviderId = typeof summary?.activeProviderId === "string" ? summary.activeProviderId : runtimeStatus?.defaultProvider;
  const latestSession = sessions[0];

  return (
    <section className="flex h-full flex-1 flex-col gap-6 p-6" data-testid="agent-shell-route">
      <header className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">NovelFork Next</p>
          <h1 className="text-2xl font-semibold">作者首页</h1>
          <p className="text-sm text-muted-foreground">从最近作品、最近会话和模型健康快速进入写作。</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <HomeRouteAction label="新建会话" onClick={() => onNavigate({ kind: "sessions" })} />
          <HomeRouteAction
            label="继续最近会话"
            onClick={() => onNavigate(latestSession ? { kind: "narrator", sessionId: latestSession.id } : { kind: "sessions" })}
            variant="outline"
          />
          <HomeRouteAction label="打开设置" onClick={() => onNavigate({ kind: "settings" })} variant="outline" />
          <HomeRouteAction label="套路库" onClick={() => onNavigate({ kind: "routines" })} variant="outline" />
        </div>
      </header>

      {error ? (
        <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <HomeStatCard label="最近作品" value={`${books.length} 本`} />
        <HomeStatCard label="最近会话" value={`${sessions.length} 条`} />
        <HomeStatCard label="模型健康" value={runtimeStatus?.hasUsableModel ? "有可用模型" : "暂无可用模型"} />
        <HomeStatCard label="当前提供方" value={activeProviderId ?? "未配置"} />
      </div>

      {loading ? <p className="text-sm text-muted-foreground">正在加载作者首页数据…</p> : null}

      {!loading && books.length === 0 && sessions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
          还没有可用内容，先创建第一本书或新建会话。
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-3">
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">最近作品</h2>
            <span className="text-xs text-muted-foreground">{books.length} 本</span>
          </div>
          {recentBooks.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">暂无作品，先创建一本书开始写作。</p>
          ) : (
            <div className="mt-3 space-y-2">
              {recentBooks.map((book) => (
                <Button key={book.id} type="button" variant="outline" className="w-full justify-between" onClick={() => onNavigate({ kind: "book", bookId: book.id })}>
                  <span className="truncate text-left">{book.title}</span>
                  <span className="text-xs text-muted-foreground">打开</span>
                </Button>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">最近会话</h2>
            <span className="text-xs text-muted-foreground">{sessions.length} 条</span>
          </div>
          {recentSessions.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">暂无会话，先新建叙述者或继续最近会话。</p>
          ) : (
            <div className="mt-3 space-y-2">
              {recentSessions.map((session) => (
                <Button key={session.id} type="button" variant="outline" className="h-auto w-full justify-between py-2" onClick={() => onNavigate({ kind: "narrator", sessionId: session.id })}>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate font-medium text-foreground">{session.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {session.projectName ? `作品：${session.projectName}` : session.agentId ? `Agent：${session.agentId}` : "独立叙述者"}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">打开</span>
                </Button>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">模型健康</h2>
            <span className="text-xs text-muted-foreground">透明摘要</span>
          </div>
          <div className="mt-3 space-y-2 text-sm text-muted-foreground">
            <p>状态：{runtimeStatus?.hasUsableModel ? "有可用模型" : "暂无可用模型"}</p>
            <p>默认提供方：{runtimeStatus?.defaultProvider ?? activeProviderId ?? "未配置"}</p>
            <p>默认模型：{runtimeStatus?.defaultModel ?? "未配置"}</p>
            {providerCount !== undefined ? <p>摘要中的提供方数量：{providerCount}</p> : null}
            {runtimeStatus?.lastConnectionError ? <p role="status">最近错误：{runtimeStatus.lastConnectionError}</p> : null}
            {!summary && !runtimeStatus ? <p>暂无 provider 摘要，先到设置页完成模型配置。</p> : null}
          </div>
        </section>
      </div>
    </section>
  );
}

function createDefaultResourceClient(): ResourceDomainClient {
  return createResourceClient(createFetchJsonContractClient());
}

function createDefaultSessionClient() {
  return createSessionClient(createFetchJsonContractClient());
}

function createDefaultContractClient() {
  return createFetchJsonContractClient();
}

function contractErrorMessage(result: ContractResult<unknown>, fallback: string): string {
  if (result.ok) return fallback;
  const error = result.error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    if (record.error && typeof record.error === "object") {
      const nested = record.error as Record<string, unknown>;
      if (typeof nested.message === "string") return nested.message;
    }
  }
  if (typeof error === "string") return error;
  return result.code ? `${fallback}：${result.code}` : fallback;
}

type SessionToolStatePayload = {
  readonly pending?: readonly ToolConfirmationRequest[];
  readonly pendingConfirmations?: readonly ToolConfirmationRequest[];
};

type SessionDomainClient = ReturnType<typeof createSessionClient>;
type WorkbenchSessionClient = WorkbenchWritingActionsSessionClient;

type SessionToolConfirmationPayload = {
  readonly ok?: boolean;
  readonly snapshot?: NarratorSessionChatSnapshot;
};

function pendingConfirmationsFromPayload(payload: SessionToolStatePayload): readonly ToolConfirmationRequest[] {
  return payload.pendingConfirmations ?? payload.pending ?? [];
}

function isChatSnapshot(value: unknown): value is NarratorSessionChatSnapshot {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<NarratorSessionChatSnapshot>;
  return Boolean(record.session && Array.isArray(record.messages) && record.cursor);
}

function snapshotFromConfirmationPayload(payload: SessionToolConfirmationPayload): NarratorSessionChatSnapshot | null {
  return isChatSnapshot(payload.snapshot) ? payload.snapshot : null;
}

function toConversationConfirmation(
  confirmation: ToolConfirmationRequest,
  options: { readonly busy: boolean; readonly error: string | null },
): ConversationConfirmation {
  const details = [confirmation.summary, `目标：${confirmation.target}`, `风险：${confirmation.risk}`].filter((value): value is string => typeof value === "string" && value.length > 0);
  return {
    id: confirmation.id,
    title: confirmation.toolName,
    summary: details.join(" / "),
    target: confirmation.target,
    risk: confirmation.risk,
    permissionSource: "pending confirmation API",
    operation: confirmation.summary,
    busy: options.busy,
    ...(options.error ? { error: options.error } : {}),
  };
}

interface SessionCompactCommandPayload {
  readonly ok: true;
  readonly summary: string;
  readonly compactedMessageCount: number;
  readonly budget: { readonly estimatedTokensBefore: number; readonly estimatedTokensAfter: number };
}

function ConversationRouteLive({ sessionId, canvasContext }: { readonly sessionId: string; readonly canvasContext?: CanvasContext }) {
  const runtime = useAgentConversationRuntime({ sessionId, canvasContext });
  const contractClient = useMemo(() => createDefaultContractClient(), []);
  const providerClient = useMemo(() => createProviderClient(contractClient), [contractClient]);
  const sessionClient = useMemo(() => createSessionClient(contractClient), [contractClient]);
  const [modelOptions, setModelOptions] = useState<NonNullable<ConversationRouteStatus["modelOptions"]>>([]);
  const [modelPoolLoading, setModelPoolLoading] = useState(true);
  const [modelPoolError, setModelPoolError] = useState<string | null>(null);
  const [pendingConfirmations, setPendingConfirmations] = useState<readonly ToolConfirmationRequest[]>([]);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [workspaceFact, setWorkspaceFact] = useState<ConversationRouteStatus["workspace"] | undefined>(undefined);
  const shellDataStore = useShellDataStore();
  const status = toConversationStatus(runtime.state, sessionId, modelOptions, modelPoolError, workspaceFact);
  const ackedSeqRef = useRef<number | null>(null);
  const confirmingIdRef = useRef<string | null>(null);
  const resumeFromSeq = runtime.getResumeFromSeq();
  const missingSession = Boolean(runtime.state.error && !runtime.state.session);
  const modelPoolEmpty = runtime.state.session ? !modelPoolLoading && modelOptions.length === 0 && !modelPoolError : false;
  const pendingConfirmation = pendingConfirmations[0]
    ? toConversationConfirmation(pendingConfirmations[0], { busy: confirmingId === pendingConfirmations[0].id, error: confirmationError })
    : null;

  useEffect(() => {
    if (resumeFromSeq <= 0 || ackedSeqRef.current === resumeFromSeq) return;
    runtime.ack(resumeFromSeq);
    ackedSeqRef.current = resumeFromSeq;
  }, [resumeFromSeq, runtime]);

  useEffect(() => {
    const worktree = runtime.state.session?.worktree?.trim();
    if (!worktree) {
      setWorkspaceFact(undefined);
      return;
    }
    let active = true;
    setWorkspaceFact({ path: worktree, git: { status: "unavailable", reason: "正在读取 Git 状态" } });
    void contractClient.get<{ status: { modified?: unknown[]; added?: unknown[]; deleted?: unknown[]; untracked?: unknown[] } }>(`/api/worktree/status?path=${encodeURIComponent(worktree)}`, { capability: { id: "worktree.status", status: "current" } }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setWorkspaceFact({ path: worktree, git: { status: "unavailable", reason: contractErrorMessage(result, "Git 状态不可读") } });
        return;
      }
      const status = result.data.status;
      const modified = Array.isArray(status.modified) ? status.modified.length : 0;
      const added = Array.isArray(status.added) ? status.added.length : 0;
      const deleted = Array.isArray(status.deleted) ? status.deleted.length : 0;
      const untracked = Array.isArray(status.untracked) ? status.untracked.length : 0;
      const total = modified + added + deleted + untracked;
      setWorkspaceFact({
        path: worktree,
        git: total > 0
          ? { status: "dirty", summary: `modified ${modified} / added ${added} / deleted ${deleted} / untracked ${untracked}` }
          : { status: "clean", summary: "干净" },
      });
    });
    return () => {
      active = false;
    };
  }, [contractClient, runtime.state.session?.worktree]);

  useEffect(() => {
    let active = true;
    setModelPoolLoading(true);
    setModelPoolError(null);

    void providerClient.listModels().then((result) => {
      if (!active) return;
      if (result.ok) {
        setModelOptions(toConversationModelOptions(result.data.models));
        setModelPoolLoading(false);
        return;
      }
      setModelOptions([]);
      setModelPoolError(contractErrorMessage(result, "模型池加载失败"));
      setModelPoolLoading(false);
    });

    return () => {
      active = false;
    };
  }, [providerClient]);

  useEffect(() => {
    let active = true;
    if (!runtime.state.session) {
      setPendingConfirmations([]);
      setConfirmationError(null);
      return () => {
        active = false;
      };
    }

    void sessionClient.listPendingTools<SessionToolStatePayload>(sessionId).then((result) => {
      if (!active) return;
      if (result.ok) {
        setPendingConfirmations(pendingConfirmationsFromPayload(result.data));
        setConfirmationError(null);
        return;
      }
      setPendingConfirmations([]);
      setConfirmationError(contractErrorMessage(result, "工具确认状态加载失败"));
    });

    return () => {
      active = false;
    };
  }, [runtime.state.lastSeq, runtime.state.session, sessionClient, sessionId]);

  const applyConfirmationSnapshot = useCallback((snapshot: NarratorSessionChatSnapshot) => {
    runtime.applyEnvelope({ type: "session:snapshot", snapshot, recovery: { state: "idle", reason: "confirmation-refresh" } });
  }, [runtime]);

  const refreshSnapshot = useCallback(async (): Promise<boolean> => {
    const snapshotResult = await sessionClient.getChatState<NarratorSessionChatSnapshot>(sessionId);
    if (!snapshotResult.ok) {
      setConfirmationError(contractErrorMessage(snapshotResult, "确认后刷新会话快照失败"));
      return false;
    }
    applyConfirmationSnapshot(snapshotResult.data);
    return true;
  }, [applyConfirmationSnapshot, sessionClient, sessionId]);

  const refreshPendingConfirmations = useCallback(async () => {
    const result = await sessionClient.listPendingTools<SessionToolStatePayload>(sessionId);
    if (result.ok) {
      setPendingConfirmations(pendingConfirmationsFromPayload(result.data));
      return;
    }
    setConfirmationError(contractErrorMessage(result, "工具确认状态刷新失败"));
  }, [sessionClient, sessionId]);

  const handleConfirmationDecision = useCallback(async (confirmationId: string, decision: "approve" | "reject") => {
    if (confirmingIdRef.current) return;
    const confirmation = pendingConfirmations.find((candidate) => candidate.id === confirmationId);
    if (!confirmation) {
      setConfirmationError("待确认工具已不存在，请刷新会话快照。");
      return;
    }

    confirmingIdRef.current = confirmationId;
    setConfirmingId(confirmationId);
    setConfirmationError(null);
    try {
      const result = await sessionClient.confirmTool<SessionToolConfirmationPayload>(sessionId, confirmation.toolName, {
        decision,
        confirmationId,
        reason: null,
      });
      if (!result.ok) {
        setConfirmationError(contractErrorMessage(result, "工具确认失败"));
        return;
      }

      const returnedSnapshot = snapshotFromConfirmationPayload(result.data);
      if (returnedSnapshot) {
        applyConfirmationSnapshot(returnedSnapshot);
      } else {
        await refreshSnapshot();
      }
      await refreshPendingConfirmations();
    } finally {
      confirmingIdRef.current = null;
      setConfirmingId(null);
    }
  }, [applyConfirmationSnapshot, pendingConfirmations, refreshPendingConfirmations, refreshSnapshot, sessionClient, sessionId]);

  const updateSessionConfig = useCallback(async (patch: ConversationSessionConfigPatch) => {
    const payload: UpdateNarratorSessionInput = { sessionConfig: patch };
    const result = await sessionClient.updateSession<NarratorSessionRecord>(sessionId, payload);
    if (!result.ok) throw new Error(contractErrorMessage(result, "会话配置更新失败"));
    shellDataStore.upsertSession(result.data);
    shellDataStore.invalidate("sessions");
    const refreshed = await sessionClient.getChatState<NarratorSessionChatSnapshot>(sessionId);
    if (!refreshed.ok) throw new Error(contractErrorMessage(refreshed, "会话配置更新后刷新状态失败"));
    runtime.applyEnvelope({ type: "session:snapshot", snapshot: refreshed.data, recovery: { state: "idle", reason: "session-config-refetch" } });
  }, [runtime, sessionClient, sessionId, shellDataStore]);

  const compactSessionForCommand = useCallback(async (instructions?: string): Promise<SessionCompactCommandPayload> => {
    const result = await sessionClient.compactSession<SessionCompactCommandPayload>(sessionId, { instructions });
    if (!result.ok || !result.data?.ok) throw new Error(contractErrorMessage(result, "上下文压缩失败"));
    await refreshSnapshot();
    return result.data;
  }, [refreshSnapshot, sessionClient, sessionId]);

  return (
    <ConversationRoute
      sessionId={sessionId}
      title={runtime.state.session?.title ?? sessionId}
      sessionMode={runtime.state.session?.sessionMode}
      initialAck={runtime.getResumeFromSeq()}
      initialMessages={toConversationMessages(runtime.state.messages)}
      initialStatus={status}
      initialConfirmation={pendingConfirmation}
      initialRecoveryNotice={runtime.state.recovery}
      sendDisabledReason={missingSession ? "会话缺失或快照不可用，请返回会话列表或新建会话。" : modelPoolEmpty ? "模型池为空，请先到设置页启用模型" : undefined}
      settingsHref={missingSession ? "/next" : modelPoolEmpty ? "/next/settings" : undefined}
      footerActions={missingSession ? <MissingSessionActions /> : null}
      onSendMessage={runtime.sendMessage}
      onAbortSession={runtime.abort}
      onUpdateSessionConfig={updateSessionConfig}
      onCompactSession={compactSessionForCommand}
      onApproveConfirmation={(confirmationId) => void handleConfirmationDecision(confirmationId, "approve")}
      onRejectConfirmation={(confirmationId) => void handleConfirmationDecision(confirmationId, "reject")}
    />
  );
}

function MissingSessionActions() {
  return (
    <nav aria-label="缺失会话操作" className="conversation-route__missing-actions">
      <a href="/next">返回会话列表</a>
      <a href="/next">新建会话</a>
    </nav>
  );
}

function toConversationModelOptions(models: readonly RuntimeModelPoolEntry[]): NonNullable<ConversationRouteStatus["modelOptions"]> {
  return models
    .filter((model) => model.enabled !== false)
    .map((model) => ({
      providerId: model.providerId,
      providerLabel: model.providerName,
      modelId: model.modelId.startsWith(`${model.providerId}:`) ? model.modelId.slice(model.providerId.length + 1) : model.modelId,
      modelLabel: model.modelName,
      supportsTools: model.capabilities.functionCalling,
      supportsReasoning: (model.capabilities as { reasoning?: boolean }).reasoning,
    }));
}

function toConversationMessages(messages: readonly NarratorSessionChatMessage[]): ConversationRouteMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    toolCalls: message.toolCalls?.map((toolCall, index) => ({
      id: toolCall.id ?? `${message.id}:tool:${index}`,
      toolName: toolCall.toolName,
      status: toolCall.status,
      summary: toolCall.summary,
      input: toolCall.input,
      result: toolCall.result,
      durationMs: toolCall.duration,
    })),
  }));
}

function usageBucketFromCumulative(cumulativeUsage?: SessionCumulativeUsage) {
  if (!cumulativeUsage) return undefined;
  const promptTokens = cumulativeUsage.totalInputTokens + cumulativeUsage.totalCacheCreationInputTokens + cumulativeUsage.totalCacheReadInputTokens;
  const completionTokens = cumulativeUsage.totalOutputTokens;
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

function usageBucketFromRuntime(usage?: TokenUsage) {
  if (!usage) return undefined;
  const promptTokens = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  const completionTokens = usage.output_tokens;
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

function latestTurnUsage(messages: readonly NarratorSessionChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const usage = usageBucketFromRuntime(messages[index]?.runtime?.usage);
    if (usage) return usage;
  }
  return undefined;
}

function usageFromSessionState(session: ReturnType<typeof useAgentConversationRuntime>["state"]["session"], messages: readonly NarratorSessionChatMessage[]): ConversationRouteStatus["usage"] {
  const currentTurn = latestTurnUsage(messages);
  const cumulative = usageBucketFromCumulative(session?.cumulativeUsage);
  if (!currentTurn && !cumulative) return undefined;
  return {
    ...(currentTurn ? { currentTurn } : {}),
    ...(cumulative ? { cumulative } : {}),
    cost: { status: "unknown" },
  };
}

function bindingLabel(session: ReturnType<typeof useAgentConversationRuntime>["state"]["session"]): string | undefined {
  if (!session) return undefined;
  if (session.projectId && session.chapterId) return `${session.projectId} / 章节 ${session.chapterId}`;
  if (session.projectId) return `书籍 ${session.projectId}`;
  if (session.worktree) return `工作目录 ${session.worktree}`;
  return "standalone";
}

function permissionModeDisabledReasons(session: ReturnType<typeof useAgentConversationRuntime>["state"]["session"]): Partial<Record<SessionPermissionMode, string>> | undefined {
  if (session?.sessionMode !== "plan") return undefined;
  return {
    allow: "规划会话不允许全部允许",
    edit: "规划会话不允许直接编辑",
  };
}

function hasRunningToolCall(messages: ReturnType<typeof useAgentConversationRuntime>["state"]["messages"]): boolean {
  return messages.some((message) => message.toolCalls?.some((toolCall) => toolCall.status === "running"));
}

function toConversationStatus(
  state: ReturnType<typeof useAgentConversationRuntime>["state"],
  sessionId: string,
  modelOptions: ConversationRouteStatus["modelOptions"] = [],
  modelPoolError: string | null = null,
  workspaceFact?: ConversationRouteStatus["workspace"],
): ConversationRouteStatus {
  const sessionConfig = state.session?.sessionConfig;
  const providerId = sessionConfig?.providerId || undefined;
  const modelId = sessionConfig?.modelId || undefined;
  const selectedModel = modelOptions?.find((option) => option.providerId === providerId && option.modelId === modelId);
  const runtimeState = state.error ? "error" : state.streamingMessageId || hasRunningToolCall(state.messages) ? "running" : state.session ? "ready" : "loading";

  return {
    state: runtimeState,
    label: state.error?.message ?? (modelPoolError ?? (runtimeState === "running" ? "生成中" : state.session ? "就绪" : `加载会话 ${sessionId}`)),
    providerId,
    providerLabel: selectedModel?.providerLabel ?? providerId,
    modelId,
    modelLabel: selectedModel?.modelLabel ?? modelId,
    permissionMode: sessionConfig?.permissionMode,
    reasoningEffort: sessionConfig?.reasoningEffort,
    usage: usageFromSessionState(state.session, state.messages),
    messageCount: state.session?.messageCount,
    binding: state.session ? { label: bindingLabel(state.session) ?? "standalone", ...(state.session.worktree ? { worktree: state.session.worktree } : {}) } : undefined,
    workspace: workspaceFact,
    modelOptions,
    toolPolicySummary: sessionConfig?.toolPolicy,
    unsupportedToolsReason: selectedModel?.supportsTools === false ? "当前模型不支持工具调用" : undefined,
    reasoningUnsupportedReason: selectedModel?.supportsReasoning === false ? "当前 provider 不支持 reasoning effort 调整" : undefined,
    permissionModeDisabledReasons: permissionModeDisabledReasons(state.session),
    sessionConfigLoaded: Boolean(sessionConfig),
  };
}

function replaceResourceNode(nodes: readonly WorkbenchResourceNode[], nextNode: WorkbenchResourceNode): WorkbenchResourceNode[] {
  return nodes.map((node) => {
    if (node.id === nextNode.id) return nextNode;
    if (node.children?.length) return { ...node, children: replaceResourceNode(node.children, nextNode) };
    return node;
  });
}

function withSavedResource(resources: WorkbenchResourcesResult, nextNode: WorkbenchResourceNode): WorkbenchResourcesResult {
  const resourceMap = new Map(resources.resourceMap);
  resourceMap.set(nextNode.id, nextNode);
  return {
    ...resources,
    tree: replaceResourceNode(resources.tree, nextNode),
    openableNodes: resources.openableNodes.map((node) => (node.id === nextNode.id ? nextNode : node)),
    resourceMap,
  };
}

function WritingWorkbenchRouteLive({ bookId, onCanvasContextChange, onNavigateToConversation }: { readonly bookId: string; readonly onCanvasContextChange: (context: WorkbenchCanvasContext) => void; readonly onNavigateToConversation: (sessionId: string) => void }) {
  const resourceClient = useMemo(() => createDefaultResourceClient(), []);
  const rawSessionClient = useMemo<SessionDomainClient>(() => createDefaultSessionClient(), []);
  const shellDataStore = useShellDataStore();
  const sessionClient = useMemo<WorkbenchSessionClient>(() => ({
    listActiveSessions: rawSessionClient.listActiveSessions,
    createSession: async (payload) => {
      const result = await rawSessionClient.createSession(payload);
      if (result.ok) {
        shellDataStore.upsertSession(result.data);
        shellDataStore.invalidate("sessions");
      }
      return result;
    },
  }), [rawSessionClient, shellDataStore]);
  const [resources, setResources] = useState<WorkbenchResourcesResult>({ tree: [], resourceMap: new Map(), openableNodes: [], errors: [] });
  const [selectedNode, setSelectedNode] = useState<WorkbenchResourceNode | null>(null);
  const [pendingDetailNode, setPendingDetailNode] = useState<WorkbenchResourceNode | null>(null);
  const [detailError, setDetailError] = useState<{ readonly node: WorkbenchResourceNode; readonly message: string } | null>(null);
  const [switchGuard, setSwitchGuard] = useState<{ readonly target: WorkbenchResourceNode; readonly message: string } | null>(null);
  const [localCanvasContext, setLocalCanvasContext] = useState<WorkbenchCanvasContext | null>(null);
  const detailRequestSeq = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    void loadWorkbenchResourcesFromContract(resourceClient, bookId).then(
      (nextResources) => {
        if (!active) return;
        setResources(nextResources);
        setSelectedNode((current) => (current ? nextResources.resourceMap.get(current.id) ?? null : null));
        setLoading(false);
      },
      (cause: unknown) => {
        if (!active) return;
        setResources({ tree: [], resourceMap: new Map(), openableNodes: [], errors: [] });
        setSelectedNode(null);
        setPendingDetailNode(null);
        setDetailError(null);
        setSwitchGuard(null);
        setLocalCanvasContext(null);
        setError(cause instanceof Error ? cause.message : String(cause));
        setLoading(false);
      },
    );

    return () => {
      active = false;
    };
  }, [bookId, resourceClient]);

  const openResourceNode = useCallback(
    (node: WorkbenchResourceNode) => {
      setError(null);
      setDetailError(null);
      setSwitchGuard(null);
      const requestSeq = detailRequestSeq.current + 1;
      detailRequestSeq.current = requestSeq;

      if (!resourceNeedsDetailHydration(node)) {
        setPendingDetailNode(null);
        setSelectedNode(node);
        return;
      }

      setPendingDetailNode(node);
      void loadResourceDetailState(resourceClient, bookId, node).then((detail) => {
        if (detailRequestSeq.current !== requestSeq) return;
        setPendingDetailNode(null);
        if (detail.status === "ready") {
          setSelectedNode(applyResourceDetailToNode(node, detail));
          return;
        }
        if (detail.status === "error") {
          setDetailError({ node, message: detail.message });
        }
      });
    },
    [bookId, resourceClient],
  );

  const handleOpen = useCallback(
    (node: WorkbenchResourceNode) => {
      if (localCanvasContext?.dirty && selectedNode && selectedNode.id !== node.id) {
        setSwitchGuard({ target: node, message: "当前画布有未保存内容，请先保存或放弃后再切换资源。" });
        return;
      }
      openResourceNode(node);
    },
    [localCanvasContext?.dirty, openResourceNode, selectedNode],
  );

  const handleSave = useCallback(
    async (node: WorkbenchResourceNode, content: string) => {
      const savedNode = await saveResourceAndHydrate(resourceClient, bookId, node, content);
      setResources((current) => withSavedResource(current, savedNode));
      setSelectedNode((current) => (current?.id === savedNode.id ? savedNode : current));
    },
    [bookId, resourceClient],
  );

  const handleCanvasContextChange = useCallback((context: WorkbenchCanvasContext) => {
    setLocalCanvasContext(context);
    onCanvasContextChange(context);
  }, [onCanvasContextChange]);

  return (
    <>
      {loading ? <p role="status">资源加载中…</p> : null}
      {pendingDetailNode ? <p role="status">正在加载 {pendingDetailNode.title} 详情…</p> : null}
      {error ? <p role="alert">资源加载失败：{error}</p> : null}
      {detailError ? (
        <p role="alert">
          {detailError.node.title} 详情加载失败：{detailError.message}
          <button type="button" onClick={() => handleOpen(detailError.node)}>重试</button>
        </p>
      ) : null}
      {switchGuard ? (
        <p role="alert">
          {switchGuard.message}
          <button type="button" onClick={() => openResourceNode(switchGuard.target)}>放弃并切换</button>
        </p>
      ) : null}
      <WritingWorkbenchRoute
        bookId={bookId}
        nodes={resources.tree}
        selectedNode={selectedNode}
        onOpen={handleOpen}
        onSave={handleSave}
        onCanvasContextChange={handleCanvasContextChange}
        writingActions={<WorkbenchWritingActions bookId={bookId} sessions={sessionClient} blockedReason={localCanvasContext?.dirty ? "当前画布有未保存内容，请先保存或放弃后再启动写作动作。" : undefined} onNavigateToConversation={onNavigateToConversation} />}
      />
    </>
  );
}

function SettingsRouteLive() {
  const [activeSectionId, setActiveSectionId] = useState("models");
  return (
    <SettingsLayout title="设置" sections={SETTINGS_SECTIONS} activeSectionId={activeSectionId} onSectionChange={setActiveSectionId}>
      {activeSectionId === "providers"
        ? <ProviderSettingsPage />
        : <SettingsSectionContent sectionId={activeSectionId} onSectionChange={setActiveSectionId} />}
    </SettingsLayout>
  );
}

function RouteMountPoint({
  route,
  canvasContext,
  onCanvasContextChange,
  onNavigateToConversation,
  onNavigate,
  books,
  sessions,
  providerSummary,
  providerStatus,
  loading,
  error,
}: {
  readonly route: ShellRoute;
  readonly canvasContext?: CanvasContext;
  readonly onCanvasContextChange: (context: WorkbenchCanvasContext) => void;
  readonly onNavigateToConversation: (sessionId: string) => void;
  readonly onNavigate: (route: ShellRoute) => void;
  readonly books: readonly ShellBookItem[];
  readonly sessions: readonly ShellSessionItem[];
  readonly providerSummary: ShellDataProviderSummary | null;
  readonly providerStatus: ShellDataProviderStatus | null;
  readonly loading: boolean;
  readonly error: string | null;
}) {
  switch (route.kind) {
    case "narrator":
      return <ConversationRouteLive sessionId={route.sessionId} canvasContext={canvasContext} />;
    case "book":
      return <WritingWorkbenchRouteLive bookId={route.bookId} onCanvasContextChange={onCanvasContextChange} onNavigateToConversation={onNavigateToConversation} />;
    case "sessions":
      return <SessionCenterPage />;
    case "search":
      return <SearchPage />;
    case "routines":
      return <RoutinesNextPage />;
    case "settings":
      return <SettingsRouteLive />;
    case "home":
      return <HomeRouteLive books={books} sessions={sessions} providerSummary={providerSummary} providerStatus={providerStatus} loading={loading} error={error} onNavigate={onNavigate} />;
    default:
      return <ShellPlaceholder title="Agent Shell" description="选择左侧叙事线、叙述者或全局入口开始。" />;
  }
}

export function StudioNextApp({ initialRoute }: StudioNextAppProps) {
  const [activeRoute, setActiveRoute] = useState<StudioNextRoute>(() => initialRoute ?? resolveStudioNextRoute());
  const [canvasContext, setCanvasContext] = useState<WorkbenchCanvasContext | null>(null);
  const { books, sessions, providerSummary, providerStatus, loading, error } = useShellData();

  const navigate = useCallback((route: ShellRoute) => {
    setActiveRoute(route);
    if (typeof window !== "undefined" && window.history?.pushState) {
      window.history.pushState(null, "", toShellPath(route));
    }
  }, []);

  const navigateToConversation = useCallback((sessionId: string) => {
    navigate({ kind: "narrator", sessionId });
  }, [navigate]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => setActiveRoute(resolveStudioNextRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <AgentShell route={activeRoute} books={books} sessions={sessions} onNavigate={navigate}>
      <RouteMountPoint
        route={activeRoute}
        canvasContext={canvasContext ?? undefined}
        onCanvasContextChange={setCanvasContext}
        onNavigateToConversation={navigateToConversation}
        onNavigate={navigate}
        books={books}
        sessions={sessions}
        providerSummary={providerSummary}
        providerStatus={providerStatus}
        loading={loading}
        error={error}
      />
    </AgentShell>
  );
}
