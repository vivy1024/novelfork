import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

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
import { type StudioNextRoute } from "./entry";
const SearchPage = lazy(() => import("./search/SearchPage").then((m) => ({ default: m.SearchPage })));
const RoutinesNextPage = lazy(() => import("./routines/RoutinesNextPage").then((m) => ({ default: m.RoutinesNextPage })));
const SessionCenterPage = lazy(() => import("./sessions/SessionCenterPage").then((m) => ({ default: m.SessionCenterPage })));
const LearnPageLazy = lazy(() => import("./learn/LearnPage").then((m) => ({ default: m.LearnPage })));
const BookManagementPageLazy = lazy(() => import("./books/BookManagementPage").then((m) => ({ default: m.BookManagementPage })));
import { SettingsLayout, type SettingsSectionItem } from "./components/layouts";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { ProviderSettingsPage } from "./settings/ProviderSettingsPage";
import { SettingsSectionContent } from "./settings/SettingsSectionContent";
import { AgentShell, toShellPath, parseShellRoute, useShellData, useShellDataStore, type ShellBookItem, type ShellRoute, type ShellSessionItem, type ShellDataProviderSummary, type ShellDataProviderStatus } from "./shell";
import { FirstRunDialog } from "../components/onboarding/FirstRunDialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
  readonly initialRoute?: StudioNextRoute; // kept for API compat; ignored when router is active
}

const SETTINGS_SECTIONS: readonly SettingsSectionItem[] = [
  { id: "profile", label: "个人资料", group: "个人设置" },
  { id: "models", label: "模型", group: "个人设置" },
  { id: "agents", label: "AI 代理", group: "个人设置" },
  { id: "notifications", label: "通知", group: "个人设置" },
  { id: "appearance", label: "外观与界面", group: "个人设置" },
  { id: "providers", label: "AI 供应商", group: "实例管理" },
  { id: "terminals", label: "终端", group: "实例管理" },
  { id: "server", label: "服务器与系统", group: "实例管理" },
  { id: "storage", label: "存储空间", group: "运行资源与审计" },
  { id: "resources", label: "运行资源", group: "运行资源与审计" },
  { id: "usage", label: "用量监控", group: "运行资源与审计" },
  { id: "runtime", label: "运行时环境", group: "运行资源与审计" },
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

function LazyFallback() {
  return (
    <div className="flex h-full flex-1 items-center justify-center">
      <p className="text-sm text-muted-foreground animate-pulse">加载中…</p>
    </div>
  );
}

interface LazyErrorBoundaryState {
  error: Error | null;
}

class LazyErrorBoundary extends Component<{ children: ReactNode; fallbackLabel?: string }, LazyErrorBoundaryState> {
  state: LazyErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 p-6">
          <p className="text-sm text-destructive">加载{this.props.fallbackLabel ?? "页面"}失败</p>
          <p className="text-xs text-muted-foreground">{this.state.error.message}</p>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
            onClick={() => this.setState({ error: null })}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
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
  const shellDataStore = useShellDataStore();
  const resourceClient = useMemo(() => createDefaultResourceClient(), []);
  const [createBookOpen, setCreateBookOpen] = useState(false);
  const [newBookTitle, setNewBookTitle] = useState("");
  const [newBookRepoSource, setNewBookRepoSource] = useState<"none" | "new" | "existing">("none");
  const [newBookRepoPath, setNewBookRepoPath] = useState("");
  const [createBookError, setCreateBookError] = useState<string | null>(null);
  const [creatingBook, setCreatingBook] = useState(false);
  const recentBooks = books.slice(0, 3);
  const standaloneSessions = sessions.filter((s) => !s.projectId);
  const recentSessions = standaloneSessions.slice(0, 3);
  const summary = providerSummaryRecord(providerSummary);
  const runtimeStatus = providerRuntimeStatus(providerStatus);
  const providerList = Array.isArray(summary?.providers) ? (summary.providers as readonly unknown[]) : null;
  const providerCount = providerList?.length;
  const activeProviderId = typeof summary?.activeProviderId === "string" ? summary.activeProviderId : runtimeStatus?.defaultProvider;
  const latestSession = sessions[0];

  const handleCreateBook = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreatingBook(true);
    setCreateBookError(null);
    try {
      const projectInit = newBookRepoSource !== "none" ? {
        repositorySource: newBookRepoSource,
        ...(newBookRepoPath.trim() ? { repositoryPath: newBookRepoPath.trim() } : {}),
      } : undefined;

      const title = newBookTitle.trim() || "未命名作品";
      const result = await resourceClient.createBook({
        title,
        language: "zh",
        ...(projectInit ? { projectInit } : {}),
      });
      if (!result.ok) throw new Error(contractErrorMessage(result, "创建作品失败"));
      if (!result.data.bookId) throw new Error("创建作品失败：响应缺少 bookId");
      // Clear guide-completed flag so the new book shows the guide
      try { localStorage.removeItem(`novelfork:guide-completed:${result.data.bookId}`); } catch { /* ignore */ }
      shellDataStore.invalidate("books");
      setCreateBookOpen(false);
      setNewBookTitle("");
      setNewBookRepoSource("none");
      setNewBookRepoPath("");
      onNavigate({ kind: "book", bookId: result.data.bookId });
    } catch (caught) {
      setCreateBookError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setCreatingBook(false);
    }
  };

  return (
    <section className="flex h-full flex-1 flex-col gap-6 overflow-auto p-6" data-testid="agent-shell-route">
      <header className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">NovelFork Next</p>
          <h1 className="text-2xl font-semibold">作者首页</h1>
          <p className="text-sm text-muted-foreground">从最近作品、最近会话和模型健康快速进入写作。</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <HomeRouteAction label="新建作品" onClick={() => setCreateBookOpen(true)} variant="default" />
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
        <HomeStatCard label="最近会话" value={`${standaloneSessions.length} 条`} />
        <HomeStatCard label="模型健康" value={runtimeStatus?.hasUsableModel ? "有可用模型" : "暂无可用模型"} />
        <HomeStatCard label="当前提供方" value={activeProviderId ?? "未配置"} />
      </div>

      <Dialog open={createBookOpen} onOpenChange={setCreateBookOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>新建作品</DialogTitle>
            <DialogDescription>创建后进入作品工作台，AI 会引导你完成题材选择、故事设定和大纲生成。</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleCreateBook}>

            {/* 仓库绑定（优先） */}
            <div className="space-y-2">
              <span className="text-sm font-medium">项目仓库</span>
              <p className="text-xs text-muted-foreground">绑定 Git 仓库可以追踪写作历史和版本管理。</p>
              <div className="flex gap-2">
                {(["none", "new", "existing"] as const).map((src) => (
                  <button key={src} type="button" className={`rounded-md px-3 py-1.5 text-xs transition ${newBookRepoSource === src ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`} onClick={() => setNewBookRepoSource(src)}>
                    {src === "none" ? "不绑定" : src === "new" ? "新建 Git 仓库" : "已有仓库"}
                  </button>
                ))}
              </div>
              {(newBookRepoSource === "existing" || newBookRepoSource === "new") && (
                <div className="flex gap-1.5">
                  <Input value={newBookRepoPath} onChange={(e) => setNewBookRepoPath(e.target.value)} placeholder={newBookRepoSource === "new" ? "选择新仓库存放目录，如 D:\\novels\\my-book" : "输入绝对路径，如 D:\\novels\\my-book"} className="flex-1 text-xs" />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="选择文件夹"
                    onClick={async () => {
                      try {
                        // Try backend directory picker first (works in desktop mode)
                        const res = await fetch("/api/system/browse-directory", { method: "POST" });
                        if (res.ok) {
                          const data = await res.json() as { path?: string };
                          if (data.path) { setNewBookRepoPath(data.path); return; }
                        }
                        // Fallback: browser showDirectoryPicker (limited — only gets folder name)
                        if ("showDirectoryPicker" in window) {
                          const handle = await (window as unknown as { showDirectoryPicker: () => Promise<{ name: string }> }).showDirectoryPicker();
                          // Note: browser API only returns folder name, not full path
                          setNewBookRepoPath(handle.name);
                        }
                      } catch { /* user cancelled */ }
                    }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
                  </Button>
                </div>
              )}
            </div>

            {/* 书名（可选） */}
            <label className="block space-y-1">
              <span className="text-sm font-medium">作品名称 <span className="text-xs text-muted-foreground font-normal">（可选，AI 可帮你生成）</span></span>
              <Input value={newBookTitle} onChange={(event) => setNewBookTitle(event.currentTarget.value)} placeholder="留空则由 AI 引导生成" />
            </label>

            {createBookError ? <p role="alert" className="text-sm text-destructive">{createBookError}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateBookOpen(false)} disabled={creatingBook}>取消</Button>
              <Button type="submit" disabled={creatingBook}>{creatingBook ? "创建中…" : "开始创作"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {loading ? <p className="text-sm text-muted-foreground">正在加载作者首页数据…</p> : null}

      {!loading && books.length === 0 && sessions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
          还没有可用内容，先新建作品或新建会话。
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
            <span className="text-xs text-muted-foreground">{standaloneSessions.length} 条</span>
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
  const questions = extractQuestionsFromConfirmation(confirmation);
  return {
    id: confirmation.id,
    title: confirmation.toolName,
    toolName: confirmation.toolName,
    summary: details.join(" / "),
    target: confirmation.target,
    targetResources: confirmation.targetResources,
    risk: confirmation.risk,
    permissionSource: confirmation.source ? "runtime permission_request" : "pending confirmation API",
    source: confirmation.source,
    checkpoint: confirmation.checkpoint,
    diff: confirmation.diff,
    operations: confirmation.operations,
    operation: confirmation.summary,
    busy: options.busy,
    ...(questions.length > 0 ? { questions } : {}),
    ...(options.error ? { error: options.error } : {}),
  };
}

function extractQuestionsFromConfirmation(confirmation: ToolConfirmationRequest): ConversationConfirmation["questions"] & readonly unknown[] {
  const diff = confirmation.diff as Record<string, unknown> | undefined;
  if (!diff || !Array.isArray(diff.questions)) return [];
  return (diff.questions as readonly Record<string, unknown>[]).map((q, i) => ({
    id: String(q.id ?? `q-${i}`),
    prompt: String(q.prompt ?? q.question ?? ""),
    type: (q.type as "text" | "single" | "multi" | "ranged-number" | "ai-suggest") ?? "text",
    ...(Array.isArray(q.options) ? { options: q.options.map(String) } : {}),
    ...(typeof q.reason === "string" ? { reason: q.reason } : {}),
    ...(typeof q.required === "boolean" ? { required: q.required } : {}),
    ...(typeof q.aiSuggestion === "string" ? { aiSuggestion: q.aiSuggestion } : {}),
  }));
}

interface SessionCompactCommandPayload {
  readonly ok: true;
  readonly summary: string;
  readonly compactedMessageCount: number;
  readonly budget: { readonly estimatedTokensBefore: number; readonly estimatedTokensAfter: number };
}

function ConversationRouteLive({ sessionId, canvasContext }: { readonly sessionId: string; readonly canvasContext?: CanvasContext }) {
  const runtime = useAgentConversationRuntime({ sessionId, canvasContext });
  const routerNavigate = useNavigate();
  const contractClient = useMemo(() => createDefaultContractClient(), []);
  const providerClient = useMemo(() => createProviderClient(contractClient), [contractClient]);
  const resourceClient = useMemo(() => createResourceClient(contractClient), [contractClient]);
  const sessionClient = useMemo(() => createSessionClient(contractClient), [contractClient]);
  const [modelOptions, setModelOptions] = useState<NonNullable<ConversationRouteStatus["modelOptions"]>>([]);
  const [modelPoolLoading, setModelPoolLoading] = useState(true);
  const [modelPoolError, setModelPoolError] = useState<string | null>(null);
  const [pendingConfirmations, setPendingConfirmations] = useState<readonly ToolConfirmationRequest[]>([]);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [workspaceFact, setWorkspaceFact] = useState<ConversationRouteStatus["workspace"] | undefined>(undefined);
  const [compactThresholdPercent, setCompactThresholdPercent] = useState(80);
  const [autoCompactEnabled, setAutoCompactEnabled] = useState(true);
  const shellDataStore = useShellDataStore();
  const status = toConversationStatus(runtime.state, sessionId, modelOptions, modelPoolError, workspaceFact, compactThresholdPercent);
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
    void resourceClient.getWorktreeStatus(worktree).then((result) => {
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
  }, [resourceClient, runtime.state.session?.worktree]);

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

  // Load user runtime config for context thresholds and auto-compact
  useEffect(() => {
    let active = true;
    void fetch("/api/settings/user").then((res) => res.ok ? res.json() : null).then((data) => {
      if (!active || !data) return;
      const rc = data.runtimeControls;
      if (rc?.contextCompressionThresholdPercent) setCompactThresholdPercent(rc.contextCompressionThresholdPercent);
      // autoCompact lives in agent behavior settings (same endpoint)
      const behavior = data.agentBehavior ?? data.behavior;
      if (behavior && typeof behavior.autoCompact === "boolean") setAutoCompactEnabled(behavior.autoCompact);
    }).catch(() => { /* use defaults */ });
    return () => { active = false; };
  }, []);

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


  // Auto-compact: trigger when context usage exceeds threshold
  const autoCompactTriggeredRef = useRef(false);
  useEffect(() => {
    if (!autoCompactEnabled) return;
    const cu = status.contextUsage;
    if (!cu || !cu.maxTokens || !cu.compactThreshold) return;

    if (cu.usedTokens > cu.compactThreshold) {
      if (!autoCompactTriggeredRef.current) {
        autoCompactTriggeredRef.current = true;
        void sessionClient.compactSession(sessionId, { instructions: "自动压缩：上下文使用超过阈值" });
      }
    } else {
      // Reset when usage drops below threshold (after compact completes)
      autoCompactTriggeredRef.current = false;
    }
  }, [autoCompactEnabled, status.contextUsage, sessionClient, sessionId]);

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

  const handleConfirmationDecision = useCallback(async (confirmationId: string, decision: "approve" | "reject", answers?: Record<string, unknown>) => {
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
        ...(answers ? { answers } : {}),
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
      initialMessages={toConversationMessages(runtime.state.messages, runtime.state.streamingMessageId)}
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
      onTruncateToMessage={async (messageId) => {
        await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/truncate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId }),
        });
        // Reload chat state after truncation
        const snapshot = await sessionClient.getChatState(sessionId);
        if (snapshot.ok && snapshot.data) {
          runtime.applyEnvelope({ type: "session:snapshot", snapshot: snapshot.data, recovery: { state: "idle" } });
        }
      }}
      onDeleteMessage={async (messageId) => {
        await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}`, {
          method: "DELETE",
        });
        // Reload chat state after deletion
        const snapshot = await sessionClient.getChatState(sessionId);
        if (snapshot.ok && snapshot.data) {
          runtime.applyEnvelope({ type: "session:snapshot", snapshot: snapshot.data, recovery: { state: "idle" } });
        }
      }}
      onApproveConfirmation={(confirmationId, answers) => void handleConfirmationDecision(confirmationId, "approve", answers)}
      onRejectConfirmation={(confirmationId) => void handleConfirmationDecision(confirmationId, "reject")}
      onEditTitle={(newTitle) => { void sessionClient.updateSession(sessionId, { title: newTitle }); }}
      onGenerateTitle={() => {
        const userMessages = runtime.state.messages.filter(m => m.role === "user");
        const firstMsg = userMessages[0]?.content?.trim();
        if (!firstMsg) {
          void sessionClient.updateSession(sessionId, { title: `会话 ${new Date().toLocaleDateString("zh-CN")}` });
          return;
        }
        // 提取第一句话作为标题（句号/问号/感叹号截断，最多 40 字）
        const match = firstMsg.match(/^(.{1,40})[。？！\n]/);
        const title = match ? match[1] : firstMsg.slice(0, 40);
        void sessionClient.updateSession(sessionId, { title: title.trim() });
      }}
      onArchive={async () => {
        if (!confirm("确认归档此会话？归档后可在会话中心恢复。")) return;
        await sessionClient.updateSession(sessionId, { status: "archived" });
        routerNavigate({ to: "/next/sessions" });
      }}
      onForkSession={async (title) => {
        const result = await sessionClient.forkSession(sessionId, { title: title || `Fork of ${runtime.state.session?.title ?? sessionId}` });
        if (result.ok && result.data) {
          const data = result.data as { session?: { id?: string }; id?: string };
          const forkedId = data.session?.id ?? data.id ?? null;
          if (forkedId) routerNavigate({ to: `/next/narrators/${encodeURIComponent(forkedId)}` });
        }
      }}
      onAttach={async (files) => {
        for (const file of Array.from(files)) {
          const formData = new FormData();
          formData.append("file", file);
          await fetch("/api/upload", { method: "POST", body: formData });
        }
      }}
      hasPreviousMessages={runtime.state.messages.length > 0 && (runtime.state.messages[0]?.seq ?? 0) > 1}
      onLoadPreviousMessages={async () => {
        const earliestSeq = runtime.state.messages[0]?.seq ?? 0;
        if (earliestSeq <= 1) return [];
        const result = await sessionClient.getChatHistory(sessionId, Math.max(0, earliestSeq - 50));
        if (!result.ok || !result.data?.messages) return [];
        return toConversationMessages(result.data.messages);
      }}
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
      contextWindow: model.contextWindow,
    }));
}

function toConversationMessages(messages: readonly NarratorSessionChatMessage[], streamingMessageId?: string | null): ConversationRouteMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    isStreaming: message.id === streamingMessageId,
    metadata: message.metadata,
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
  compactThresholdPercent: number = 80,
): ConversationRouteStatus {
  const sessionConfig = state.session?.sessionConfig;
  const providerId = sessionConfig?.providerId || undefined;
  const modelId = sessionConfig?.modelId || undefined;
  const selectedModel = modelOptions?.find((option) => option.providerId === providerId && option.modelId === modelId);
  const runtimeState = state.error ? "error" : state.streamingMessageId || hasRunningToolCall(state.messages) || state.waitingForResponse ? "running" : state.session ? "ready" : "loading";
  const narratorState = (state.session as { narratorState?: string } | null)?.narratorState;
  const isWorking = runtimeState === "running" || narratorState === "working";

  // Context usage estimation — always provide contextUsage so ContextRing is always visible
  const cumulativeUsage = state.session?.cumulativeUsage;
  const maxTokens = selectedModel?.contextWindow;
  const usedTokens = cumulativeUsage ? cumulativeUsage.totalInputTokens + cumulativeUsage.totalOutputTokens : 0;
  const contextUsage = {
    usedTokens,
    maxTokens: maxTokens && maxTokens > 0 ? maxTokens : 0,
    ...(maxTokens && maxTokens > 0 ? { compactThreshold: Math.round(maxTokens * (compactThresholdPercent / 100)) } : {}),
  };

  return {
    state: runtimeState,
    narratorState: isWorking ? "working" : narratorState === "idle" ? "idle" : undefined,
    label: state.error?.message ?? (modelPoolError ?? (isWorking ? "生成中" : state.session ? "就绪" : `加载会话 ${sessionId}`)),
    providerId,
    providerLabel: selectedModel?.providerLabel ?? providerId,
    modelId,
    modelLabel: selectedModel?.modelLabel ?? modelId,
    permissionMode: sessionConfig?.permissionMode,
    reasoningEffort: sessionConfig?.reasoningEffort,
    usage: usageFromSessionState(state.session, state.messages),
    contextUsage,
    messageCount: state.session?.messageCount,
    binding: state.session ? { label: bindingLabel(state.session) ?? "standalone", ...(state.session.worktree ? { worktree: state.session.worktree } : {}), ...(state.session.projectId ? { projectId: state.session.projectId } : {}) } : undefined,
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

  const reloadResources = useCallback(() => {
    setLoading(true);
    setError(null);
    void loadWorkbenchResourcesFromContract(resourceClient, bookId).then(
      (nextResources) => {
        setResources(nextResources);
        setSelectedNode((current) => (current ? nextResources.resourceMap.get(current.id) ?? null : null));
        setLoading(false);
      },
      (cause: unknown) => {
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
  }, [bookId, resourceClient]);

  useEffect(() => { reloadResources(); }, [reloadResources]);

  // Load repository path from sessions bound to this book
  const [repositoryPath, setRepositoryPath] = useState<string | undefined>(undefined);
  useEffect(() => {
    void fetch(`/api/sessions?status=active&projectId=${encodeURIComponent(bookId)}`)
      .then(res => res.ok ? res.json() : null)
      .then((data: unknown) => {
        const sessions = Array.isArray(data) ? data : [];
        const withWorktree = sessions.find((s: { worktree?: string }) => s.worktree);
        if (withWorktree?.worktree) setRepositoryPath(withWorktree.worktree);
      })
      .catch(() => { /* non-critical */ });
  }, [bookId]);

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
          <Button type="button" variant="outline" size="sm" onClick={() => handleOpen(detailError.node)}>重试</Button>
        </p>
      ) : null}
      {switchGuard ? (
        <p role="alert">
          {switchGuard.message}
          <Button type="button" variant="outline" size="sm" onClick={() => openResourceNode(switchGuard.target)}>放弃并切换</Button>
        </p>
      ) : null}
      <WritingWorkbenchRoute
        bookId={bookId}
        repositoryPath={repositoryPath}
        nodes={resources.tree}
        selectedNode={selectedNode}
        onOpen={handleOpen}
        onDeselectNode={() => setSelectedNode(null)}
        onSave={handleSave}
        onCanvasContextChange={handleCanvasContextChange}
        onGuideComplete={reloadResources}
        writingActions={<WorkbenchWritingActions bookId={bookId} bookTitle={resources.tree.find(n => n.kind === "book")?.title} sessions={sessionClient} blockedReason={localCanvasContext?.dirty ? "当前画布有未保存内容，请先保存或放弃后再启动写作动作。" : undefined} onNavigateToConversation={(sessionId) => { onNavigateToConversation(sessionId); }} />}
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
    case "books":
      return <LazyErrorBoundary fallbackLabel="作品管理"><Suspense fallback={<LazyFallback />}><BookManagementPageLazy onNavigateToBook={(bookId) => onNavigate({ kind: "book", bookId })} onCreateBook={() => onNavigate({ kind: "home" })} /></Suspense></LazyErrorBoundary>;
    case "sessions":
      return <LazyErrorBoundary fallbackLabel="会话中心"><Suspense fallback={<LazyFallback />}><SessionCenterPage /></Suspense></LazyErrorBoundary>;
    case "search":
      return <LazyErrorBoundary fallbackLabel="搜索"><Suspense fallback={<LazyFallback />}><SearchPage onNavigateToBook={(bookId) => onNavigate({ kind: "book", bookId })} /></Suspense></LazyErrorBoundary>;
    case "routines":
      return <LazyErrorBoundary fallbackLabel="套路页"><Suspense fallback={<LazyFallback />}><RoutinesNextPage /></Suspense></LazyErrorBoundary>;
    case "learn":
      return <LazyErrorBoundary fallbackLabel="学习中心"><Suspense fallback={<LazyFallback />}><LearnPageLazy /></Suspense></LazyErrorBoundary>;
    case "settings":
      return <SettingsRouteLive />;
    case "home":
      return <HomeRouteLive books={books} sessions={sessions} providerSummary={providerSummary} providerStatus={providerStatus} loading={loading} error={error} onNavigate={onNavigate} />;
    default:
      return <ShellPlaceholder title="Agent Shell" description="选择左侧叙事线、叙述者或全局入口开始。" />;
  }
}

export function StudioNextApp(_props: StudioNextAppProps) {
  const routerState = useRouterState();
  const activeRoute: ShellRoute = parseShellRoute(routerState.location.pathname);
  const [canvasContext, setCanvasContext] = useState<WorkbenchCanvasContext | null>(null);
  const { books, sessions, providerSummary, providerStatus, loading, error } = useShellData();
  const routerNavigate = useNavigate();

  // 首次运行检测：没有 localStorage 标记 且 没有已有数据时才显示
  const [showFirstRun, setShowFirstRun] = useState(() => {
    try { return !localStorage.getItem("novelfork:first-run-dismissed"); } catch { return false; }
  });
  const shouldShowFirstRun = showFirstRun && !loading && books.length === 0 && sessions.length === 0;

  const dismissFirstRun = useCallback(() => {
    try { localStorage.setItem("novelfork:first-run-dismissed", "1"); } catch { /* ignore */ }
    setShowFirstRun(false);
  }, []);

  const navigate = useCallback((route: ShellRoute) => {
    void routerNavigate({ to: toShellPath(route) });
  }, [routerNavigate]);

  const navigateToConversation = useCallback((sessionId: string) => {
    navigate({ kind: "narrator", sessionId });
  }, [navigate]);

  return (
    <AgentShell route={activeRoute} books={books} sessions={sessions} onNavigate={navigate} onDeleteBook={async (bookId) => {
      try {
        const res = await fetch(`/api/books/${encodeURIComponent(bookId)}`, { method: "DELETE" });
        if (res.ok) { navigate({ kind: "home" }); window.location.reload(); }
      } catch { /* ignore */ }
    }}>
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
      <FirstRunDialog
        open={shouldShowFirstRun}
        onOpenChange={setShowFirstRun}
        onConfigureModel={() => { dismissFirstRun(); navigate({ kind: "settings" }); }}
        onCreateBook={() => { dismissFirstRun(); navigate({ kind: "home" }); }}
        onOpenWorkbenchIntro={() => { dismissFirstRun(); navigate({ kind: "routines" }); }}
        onDismiss={dismissFirstRun}
      />
    </AgentShell>
  );
}
