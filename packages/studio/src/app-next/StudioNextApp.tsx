import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

import {
  createFetchJsonContractClient,
  createResourceClient,
  type ContractResult,
  type ResourceDomainClient,
} from "./backend-contract";
import { type StudioNextRoute } from "./entry";
const SearchPage = lazy(() =>
  import("./search/SearchPage").then((m) => ({ default: m.SearchPage })),
);
const RoutinesNextPage = lazy(() =>
  import("./routines/RoutinesNextPage").then((m) => ({
    default: m.RoutinesNextPage,
  })),
);
const SessionCenterPage = lazy(() =>
  import("./sessions/SessionCenterPage").then((m) => ({
    default: m.SessionCenterPage,
  })),
);
const LearnPageLazy = lazy(() =>
  import("./learn/LearnPage").then((m) => ({ default: m.LearnPage })),
);
const BookManagementPageLazy = lazy(() =>
  import("./books/BookManagementPage").then((m) => ({
    default: m.BookManagementPage,
  })),
);
const KnowledgeBasePageLazy = lazy(() =>
  import("./knowledge/KnowledgeBasePage").then((m) => ({
    default: m.KnowledgeBasePage,
  })),
);
const ScheduledTasksPageLazy = lazy(() =>
  import("./scheduled-tasks/ScheduledTasksPage").then((m) => ({
    default: m.ScheduledTasksPage,
  })),
);
const RuntimeNarratorConversationLoaderLazy = lazy(() =>
  import("./runtime/RuntimeNarratorConversationRoute").then((m) => ({
    default: m.RuntimeNarratorConversationLoader,
  })),
);
const RuntimeWritingWorkbenchRouteLazy = lazy(() =>
  import("./runtime/RuntimeWritingWorkbenchRoute").then((m) => ({
    default: m.RuntimeWritingWorkbenchRoute,
  })),
);
import { SettingsLayout } from "./components/layouts";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
const RuntimeProviderSettingsHost = lazy(() =>
  import("@vivy1024/narrafork-runtime-bridge/frontend/provider-settings").then((module) => ({
    default: module.EmbeddedProviderSettingsHost,
  })),
);
import { createAccountProfileClient } from "./runtime-admin";
import { SettingsSectionContent } from "./settings/SettingsSectionContent";
import {
  isSettingsSectionId,
  resolveSettingsSectionId,
  SETTINGS_SECTIONS,
} from "./settings/sections";
import {
  AgentShell,
  recentTabKey,
  recentTabNarratorId,
  toShellPath,
  parseShellRoute,
  useShellDataStore,
  type ShellBookItem,
  type ShellRecentTabItem,
  type ShellRoute,
  type ShellSessionItem,
  type ShellDataProviderSummary,
  type ShellDataProviderStatus,
} from "./shell";
import {
  createRuntimeProductClient,
  type RuntimeProductClient,
} from "./runtime/product-contract";
import { clearRuntimeAuthentication } from "./runtime/auth";
import {
  createRuntimeNarratorClient,
  type RuntimeNarratorClient,
} from "./runtime/runtime-narrator-client";
import { useRuntimeShellData } from "./runtime/useRuntimeShellData";
import { FirstRunDialog } from "../components/onboarding/FirstRunDialog";
import {
  GettingStartedChecklist,
  type GettingStartedStatus,
} from "../components/onboarding/GettingStartedChecklist";
import { GuidedTour } from "../components/onboarding/GuidedTour";
import { HOME_TOUR_STEPS } from "../components/onboarding/tour-steps";
import { useApi } from "../hooks/use-api";
import { ToastContainer } from "../components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DirectoryPickerDialog } from "./components/DirectoryPickerDialog";
import { WorkspaceCreateWizard, type WorkspaceCreateInput } from "./components/WorkspaceCreateWizard";
import type { WorkbenchCanvasContext } from "@vivy1024/novelfork-novel-plugin/pages/writing-workbench";

interface StudioNextAppProps {
  readonly initialRoute?: StudioNextRoute; // kept for API compat; ignored when router is active
}

function ShellPlaceholder({
  title,
  description,
}: {
  readonly title: string;
  readonly description: string;
}) {
  return (
    <section
      className="flex h-full flex-1 flex-col p-6"
      data-testid="agent-shell-route"
    >
      <p className="text-xs font-medium text-muted-foreground">
        NovelFork Next
      </p>
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

class LazyErrorBoundary extends Component<
  { children: ReactNode; fallbackLabel?: string },
  LazyErrorBoundaryState
> {
  state: LazyErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 p-6">
          <p className="text-sm text-destructive">
            加载{this.props.fallbackLabel ?? "页面"}失败
          </p>
          <p className="text-xs text-muted-foreground">
            {this.state.error.message}
          </p>
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

function providerSummaryRecord(
  providerSummary: ShellDataProviderSummary | null,
): Record<string, unknown> | null {
  if (!providerSummary || typeof providerSummary !== "object") return null;
  const record = providerSummary as Record<string, unknown>;
  if (record.summary && typeof record.summary === "object")
    return record.summary as Record<string, unknown>;
  return record;
}

function providerRuntimeStatus(
  providerStatus: ShellDataProviderStatus | null,
): {
  readonly hasUsableModel?: boolean;
  readonly defaultProvider?: string;
  readonly defaultModel?: string;
  readonly lastConnectionError?: string;
} | null {
  if (!providerStatus || typeof providerStatus !== "object") return null;
  const record = providerStatus as Record<string, unknown>;
  if (record.status && typeof record.status === "object")
    return record.status as {
      readonly hasUsableModel?: boolean;
      readonly defaultProvider?: string;
      readonly defaultModel?: string;
      readonly lastConnectionError?: string;
    };
  return record as {
    readonly hasUsableModel?: boolean;
    readonly defaultProvider?: string;
    readonly defaultModel?: string;
    readonly lastConnectionError?: string;
  };
}

function HomeStatCard({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
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
  readonly runtimeProductMode?: boolean;
  readonly onCreateRuntimeBook?: (title: string, projectInit?: WorkspaceCreateInput["projectInit"]) => Promise<string>;
}

function HomeRouteLive({
  books,
  sessions,
  providerSummary,
  providerStatus,
  loading,
  error,
  onNavigate,
  runtimeProductMode = false,
  onCreateRuntimeBook,
}: HomeRouteLiveProps) {
  const shellDataStore = useShellDataStore();
  const resourceClient = useMemo(() => createDefaultResourceClient(), []);
  const [createBookOpen, setCreateBookOpen] = useState(false);
  const [newBookTitle, setNewBookTitle] = useState("");
  const [newBookRepoSource, setNewBookRepoSource] = useState<
    "none" | "new" | "existing"
  >("none");
  const [newBookRepoPath, setNewBookRepoPath] = useState("");
  const [createBookError, setCreateBookError] = useState<string | null>(null);
  const [creatingBook, setCreatingBook] = useState(false);
  const [showDirPicker, setShowDirPicker] = useState(false);
  const recentBook = books[0] ?? null;

  // Onboarding checklist state
  const { data: onboardingData, refetch: refetchOnboarding } = useApi<{
    status: GettingStartedStatus;
  }>(runtimeProductMode ? null : "/onboarding/status");
  const onboardingStatus = onboardingData?.status ?? null;
  const runtimeStatus = providerRuntimeStatus(providerStatus);

  const handleCreateBookInput = async (input: WorkspaceCreateInput) => {
    try {
      const bookId = runtimeProductMode
        ? await (() => {
            if (!onCreateRuntimeBook) throw new Error("Runtime 创建作品入口不可用");
            return onCreateRuntimeBook(input.title, input.projectInit);
          })()
        : await (async () => {
            const result = await resourceClient.createBook({ title: input.title, language: "zh", projectInit: input.projectInit });
            if (!result.ok) throw new Error(contractErrorMessage(result, "创建作品失败"));
            if (!result.data.bookId) throw new Error("创建作品失败：响应缺少 bookId");
            shellDataStore.invalidate("books");
            return result.data.bookId;
          })();
      setCreateBookOpen(false);
      onNavigate({ kind: "book", bookId });
    } catch (caught) {
      setCreateBookError(caught instanceof Error ? caught.message : String(caught));
      throw caught;
    }
  };

  return (
    <section
      className="flex h-full flex-1 flex-col gap-6 overflow-auto p-6"
      data-testid="agent-shell-route"
    >
      <header className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            NovelFork Next
          </p>
          <h1 className="text-2xl font-semibold">作者首页</h1>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {recentBook && (
            <Button
              type="button"
              size="lg"
              className="w-full sm:w-auto"
              onClick={() =>
                onNavigate({ kind: "book", bookId: recentBook.id })
              }
            >
              继续写作 → {recentBook.title}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full sm:w-auto"
            onClick={() => setCreateBookOpen(true)}
          >
            新建作品
          </Button>
        </div>
      </header>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      {!loading && !runtimeStatus?.hasUsableModel && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 px-4 py-3 flex items-center gap-3">
          <span className="text-amber-600 dark:text-amber-400 text-lg">⚠️</span>
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              尚未配置 AI 供应商
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400">
              配置后可使用 AI 写作、续写、审校、去 AI
              味等全部功能。未配置时仅支持本地编辑。
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300"
            onClick={() => onNavigate({ kind: "settings" })}
          >
            去配置
          </Button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 max-w-md">
        <HomeStatCard label="作品数" value={`${books.length} 本`} />
        <HomeStatCard label="会话数" value={`${sessions.length} 条`} />
      </div>

      {onboardingStatus && !onboardingStatus.dismissedGettingStarted && (
        <GettingStartedChecklist
          status={onboardingStatus}
          onConfigureModel={() => onNavigate({ kind: "settings" })}
          onCreateBook={() => setCreateBookOpen(true)}
          onMeetNarrator={() => {
            const firstBook = books[0];
            if (firstBook) onNavigate({ kind: "book", bookId: firstBook.id });
            else setCreateBookOpen(true);
          }}
          onOpenJingwei={() => {
            const firstBook = books[0];
            if (firstBook) onNavigate({ kind: "book", bookId: firstBook.id });
            else setCreateBookOpen(true);
          }}
          onTryAiWriting={() => {
            const firstBook = books[0];
            if (firstBook) onNavigate({ kind: "book", bookId: firstBook.id });
            else onNavigate({ kind: "settings" });
          }}
          onDismiss={() => {
            void fetch("/api/onboarding/status", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ dismissedGettingStarted: true }),
            }).then(() => refetchOnboarding());
          }}
        />
      )}

      <WorkspaceCreateWizard
        open={createBookOpen}
        onOpenChange={setCreateBookOpen}
        submitting={creatingBook}
        onSubmit={handleCreateBookInput}
      />

      {loading ? (
        <p className="text-sm text-muted-foreground">正在加载作者首页数据…</p>
      ) : null}

      {!loading && books.length === 0 && sessions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
          还没有可用内容，先新建作品或新建会话。
        </div>
      ) : null}
    </section>
  );
}

function createDefaultResourceClient(): ResourceDomainClient {
  return createResourceClient(createFetchJsonContractClient());
}

function contractErrorMessage(
  result: ContractResult<unknown>,
  fallback: string,
): string {
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

const settingsAccountClient = createAccountProfileClient();

function SettingsRouteLive({
  section,
  onNavigate,
}: {
  readonly section?: string;
  readonly onNavigate: (route: ShellRoute) => void;
}) {
  const requestedSection = resolveSettingsSectionId(section);
  const [role, setRole] = useState<"admin" | "user" | null>(null);

  useEffect(() => {
    let active = true;
    void settingsAccountClient.get().then(
      (profile) => {
        if (active) setRole(profile.role);
      },
      () => {
        if (active) setRole("user");
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const visibleSections = useMemo(
    () =>
      SETTINGS_SECTIONS.filter((item) => !item.adminOnly || role === "admin"),
    [role],
  );
  const activeSectionId = visibleSections.some(
    (item) => item.id === requestedSection,
  )
    ? requestedSection
    : "profile";
  const setActiveSectionId = (nextSection: string) => {
    const resolved =
      visibleSections.some((item) => item.id === nextSection) &&
      isSettingsSectionId(nextSection)
        ? nextSection
        : "profile";
    onNavigate({ kind: "settings", section: resolved });
  };

  useEffect(() => {
    if (role && requestedSection !== activeSectionId) {
      onNavigate({ kind: "settings", section: activeSectionId });
    }
  }, [activeSectionId, onNavigate, requestedSection, role]);

  return (
    <SettingsLayout
      title="设置"
      sections={visibleSections}
      activeSectionId={activeSectionId}
      onSectionChange={setActiveSectionId}
      mobileDetailOpen={section !== undefined}
      onMobileBack={() => onNavigate({ kind: "settings" })}
    >
      {activeSectionId === "providers" ? (
        <RuntimeProviderSettingsHost />
      ) : (
        <SettingsSectionContent
          sectionId={activeSectionId}
          onSectionChange={setActiveSectionId}
        />
      )}
    </SettingsLayout>
  );
}

function RouteMountPoint({
  route,
  onCanvasContextChange,
  onNavigateToConversation,
  onNavigate,
  books,
  sessions,
  providerSummary,
  providerStatus,
  loading,
  error,
  runtimeClient,
  narratorClient,
  onCreateRuntimeBook,
  reloadRuntimeShell,
  selectedBook,
}: {
  readonly route: ShellRoute;
  readonly onCanvasContextChange: (context: WorkbenchCanvasContext) => void;
  readonly onNavigateToConversation: (sessionId: string) => void;
  readonly onNavigate: (route: ShellRoute) => void;
  readonly books: readonly ShellBookItem[];
  readonly sessions: readonly ShellSessionItem[];
  readonly providerSummary: ShellDataProviderSummary | null;
  readonly providerStatus: ShellDataProviderStatus | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly runtimeClient: RuntimeProductClient;
  readonly narratorClient: RuntimeNarratorClient;
  readonly onCreateRuntimeBook: (title: string) => Promise<string>;
  readonly reloadRuntimeShell: () => Promise<void>;
  readonly selectedBook: ShellBookItem | null;
}) {
  switch (route.kind) {
    case "narrator":
      return (
        <LazyErrorBoundary fallbackLabel="叙述者会话">
          <Suspense fallback={<LazyFallback />}>
            <RuntimeNarratorConversationLoaderLazy
              narratorId={route.sessionId}
              client={runtimeClient}
              narratorClient={narratorClient}
              onOpened={reloadRuntimeShell}
              onInvalidNarrator={() => onNavigate({ kind: "sessions" })}
            />
          </Suspense>
        </LazyErrorBoundary>
      );
    case "book":
      return (
        <LazyErrorBoundary fallbackLabel="写作工作台">
          <Suspense fallback={<LazyFallback />}>
            <RuntimeWritingWorkbenchRouteLazy
              bookId={route.bookId}
              onCanvasContextChange={onCanvasContextChange}
              onNavigateToConversation={onNavigateToConversation}
              onChanged={reloadRuntimeShell}
              client={runtimeClient}
            />
          </Suspense>
        </LazyErrorBoundary>
      );
    case "books":
      return (
        <LazyErrorBoundary fallbackLabel="作品管理">
          <Suspense fallback={<LazyFallback />}>
            <BookManagementPageLazy
              books={books}
              loading={loading}
              error={error}
              onNavigateToBook={(bookId) =>
                onNavigate({ kind: "book", bookId })
              }
              onCreateBook={async (input) => {
                if (!input) { onNavigate({ kind: "home" }); return; }
                const operation = await runtimeClient.createBook(input, crypto.randomUUID());
                if (operation.state !== "ready") throw new Error(operation.error ?? `书籍初始化尚未完成（${operation.state}）`);
                await reloadRuntimeShell();
                onNavigate({ kind: "book", bookId: operation.bookId });
              }}
              onClaimLegacyBook={async (bookId) => {
                const operation = await runtimeClient.claimLegacyBook(bookId);
                await reloadRuntimeShell();
                return operation;
              }}
              onImportBook={async (sourcePath) => {
                const operation = await runtimeClient.importBook(
                  { sourcePath },
                  crypto.randomUUID(),
                );
                await reloadRuntimeShell();
                return operation;
              }}
              onRepairBook={async (bookId) => {
                const operation = await runtimeClient.repairBookBinding(bookId);
                await reloadRuntimeShell();
                return operation;
              }}
              onRebindBookWorkspace={async (bookId, workspaceRoot) => {
                const result = await runtimeClient.rebindBookWorkspace(
                  bookId,
                  workspaceRoot,
                );
                await reloadRuntimeShell();
                return result;
              }}
              onDeleteBook={async (bookId, deleteWorkspace) => {
                await runtimeClient.deleteBook(bookId, deleteWorkspace);
                await reloadRuntimeShell();
              }}
            />
          </Suspense>
        </LazyErrorBoundary>
      );
    case "sessions":
      return (
        <LazyErrorBoundary fallbackLabel="叙述者中心">
          <Suspense fallback={<LazyFallback />}>
            <SessionCenterPage
              client={narratorClient}
              initialCreateOpen={route.create === true}
              onOpenNarrator={onNavigateToConversation}
              onChanged={reloadRuntimeShell}
            />
          </Suspense>
        </LazyErrorBoundary>
      );
    case "search":
      return (
        <LazyErrorBoundary fallbackLabel="搜索">
          <Suspense fallback={<LazyFallback />}>
            <SearchPage />
          </Suspense>
        </LazyErrorBoundary>
      );
    case "routines":
      return (
        <LazyErrorBoundary fallbackLabel="套路页">
          <Suspense fallback={<LazyFallback />}>
            <RoutinesNextPage
              bookId={selectedBook?.id}
              bookTitle={selectedBook?.title}
            />
          </Suspense>
        </LazyErrorBoundary>
      );
    case "knowledge":
      return (
        <LazyErrorBoundary fallbackLabel="知识库">
          <Suspense fallback={<LazyFallback />}>
            <KnowledgeBasePageLazy />
          </Suspense>
        </LazyErrorBoundary>
      );
    case "scheduled-tasks":
      return (
        <LazyErrorBoundary fallbackLabel="定时任务">
          <Suspense fallback={<LazyFallback />}>
            <ScheduledTasksPageLazy />
          </Suspense>
        </LazyErrorBoundary>
      );
    case "learn":
      return (
        <LazyErrorBoundary fallbackLabel="学习中心">
          <Suspense fallback={<LazyFallback />}>
            <LearnPageLazy />
          </Suspense>
        </LazyErrorBoundary>
      );
    case "settings":
      return (
        <SettingsRouteLive section={route.section} onNavigate={onNavigate} />
      );
    case "home":
      return (
        <HomeRouteLive
          books={books}
          sessions={sessions}
          providerSummary={providerSummary}
          providerStatus={providerStatus}
          loading={loading}
          error={error}
          onNavigate={onNavigate}
          runtimeProductMode
          onCreateRuntimeBook={onCreateRuntimeBook}
        />
      );
    default:
      return (
        <ShellPlaceholder
          title="Agent Shell"
          description="选择左侧叙事线、叙述者或全局入口开始。"
        />
      );
  }
}

export function StudioNextApp(_props: StudioNextAppProps) {
  const routerState = useRouterState();
  const activeRoute: ShellRoute = parseShellRoute(
    routerState.location.pathname,
  );
  const [, setCanvasContext] = useState<WorkbenchCanvasContext | null>(null);
  const runtimeClient = useMemo(() => createRuntimeProductClient(), []);
  const narratorClient = useMemo(() => createRuntimeNarratorClient(), []);
  const activeNarratorId =
    activeRoute.kind === "narrator" ? activeRoute.sessionId : undefined;
  const {
    books,
    sessions,
    recentTabs = [],
    providerSummary,
    providerStatus,
    loading,
    error: runtimeShellError,
    reload: reloadRuntimeShell,
  } = useRuntimeShellData(runtimeClient, narratorClient, activeNarratorId);
  const error = runtimeShellError?.message ?? null;
  const routerNavigate = useNavigate();
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedBookId((current) => {
      if (activeRoute.kind === "book") return activeRoute.bookId;
      if (current && books.some((book) => book.id === current)) return current;
      return books[0]?.id ?? null;
    });
  }, [activeRoute, books]);

  const selectedBook = useMemo(
    () => books.find((book) => book.id === selectedBookId) ?? null,
    [books, selectedBookId],
  );

  // 首次运行检测：没有 localStorage 标记 且 没有已有数据时才显示
  const [showFirstRun, setShowFirstRun] = useState(() => {
    try {
      return !localStorage.getItem("novelfork:first-run-dismissed");
    } catch {
      return false;
    }
  });
  const shouldShowFirstRun =
    showFirstRun && !loading && books.length === 0 && sessions.length === 0;

  const dismissFirstRun = useCallback(() => {
    try {
      localStorage.setItem("novelfork:first-run-dismissed", "1");
    } catch {
      /* ignore */
    }
    setShowFirstRun(false);
    setTourActive(true);
  }, []);

  // Guided tour state: activates after first-run dialog is dismissed
  const [tourActive, setTourActive] = useState(() => {
    try {
      return (
        localStorage.getItem("novelfork:first-run-dismissed") === "1" &&
        !localStorage.getItem("novelfork:tour-home-completed")
      );
    } catch {
      return false;
    }
  });

  const navigate = useCallback(
    (route: ShellRoute) => {
      void routerNavigate({ to: toShellPath(route) });
    },
    [routerNavigate],
  );

  const navigateToConversation = useCallback(
    (sessionId: string) => {
      navigate({ kind: "narrator", sessionId });
    },
    [navigate],
  );

  const createRuntimeBook = useCallback(
    async (title: string, projectInit?: WorkspaceCreateInput["projectInit"]): Promise<string> => {
      const idempotencyKey =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `runtime-book-${Date.now()}`;
      const operation = await runtimeClient.createBook(
        { title, ...(projectInit ? { projectInit } : {}) },
        idempotencyKey,
      );
      if (operation.state !== "ready") {
        throw new Error(
          operation.error ?? `书籍初始化尚未完成（${operation.state}）`,
        );
      }
      await reloadRuntimeShell();
      return operation.bookId;
    },
    [reloadRuntimeShell, runtimeClient],
  );

  const removeRecentTab = useCallback(
    async (tab: ShellRecentTabItem) => {
      await narratorClient.removeRecentTab(tab);
      if (
        activeRoute.kind === "narrator" &&
        recentTabNarratorId(tab) === activeRoute.sessionId
      ) {
        navigate({ kind: "sessions" });
      }
      await reloadRuntimeShell();
    },
    [activeRoute, narratorClient, navigate, reloadRuntimeShell],
  );

  const clearInactiveRecentTabs = useCallback(async () => {
    const activeTab =
      activeRoute.kind === "narrator"
        ? recentTabs.find(
            (tab) => recentTabNarratorId(tab) === activeRoute.sessionId,
          )
        : undefined;
    await narratorClient.clearRecentTabs(
      "inactive_narrators",
      activeTab ? recentTabKey(activeTab) : undefined,
    );
    await reloadRuntimeShell();
  }, [activeRoute, narratorClient, recentTabs, reloadRuntimeShell]);

  const setRecentTabPinned = useCallback(
    async (tab: ShellRecentTabItem, pinned: boolean) => {
      await narratorClient.setRecentTabPinned(tab, pinned);
      await reloadRuntimeShell();
    },
    [narratorClient, reloadRuntimeShell],
  );

  const moveRecentTab = useCallback(
    async (tab: ShellRecentTabItem, target: ShellRecentTabItem) => {
      const sourceKey = recentTabKey(tab);
      const targetKey = recentTabKey(target);
      const sourceIndex = recentTabs.findIndex(
        (candidate) => recentTabKey(candidate) === sourceKey,
      );
      if (sourceIndex < 0 || sourceKey === targetKey) return;

      const next = [...recentTabs];
      const [moved] = next.splice(sourceIndex, 1);
      const targetIndex = next.findIndex(
        (candidate) => recentTabKey(candidate) === targetKey,
      );
      if (!moved || targetIndex < 0) return;
      next.splice(targetIndex, 0, moved);
      const toIndex = next.findIndex(
        (candidate) => recentTabKey(candidate) === sourceKey,
      );
      if (toIndex < 0) return;

      await narratorClient.moveRecentTab(tab, { toIndex });
      await reloadRuntimeShell();
    },
    [narratorClient, recentTabs, reloadRuntimeShell],
  );

  return (
    <AgentShell
      route={activeRoute}
      books={books}
      sessions={sessions}
      recentTabs={recentTabs}
      onNavigate={navigate}
      onRemoveRecentTab={(tab) => {
        void removeRecentTab(tab);
      }}
      onPinRecentTab={(tab, pinned) => {
        void setRecentTabPinned(tab, pinned);
      }}
      onMoveRecentTab={(tab, target) => {
        void moveRecentTab(tab, target);
      }}
      onClearInactiveRecentTabs={() => {
        void clearInactiveRecentTabs();
      }}
      onLogout={() => clearRuntimeAuthentication("logout")}
    >
      <RouteMountPoint
        route={activeRoute}
        onCanvasContextChange={setCanvasContext}
        onNavigateToConversation={navigateToConversation}
        onNavigate={navigate}
        books={books}
        sessions={sessions}
        providerSummary={providerSummary}
        providerStatus={providerStatus}
        loading={loading}
        error={error}
        runtimeClient={runtimeClient}
        narratorClient={narratorClient}
        onCreateRuntimeBook={createRuntimeBook}
        reloadRuntimeShell={reloadRuntimeShell}
        selectedBook={selectedBook}
      />
      <FirstRunDialog
        open={shouldShowFirstRun}
        onOpenChange={setShowFirstRun}
        onConfigureModel={() => {
          dismissFirstRun();
          navigate({ kind: "settings" });
        }}
        onCreateBook={() => {
          dismissFirstRun();
          navigate({ kind: "home" });
        }}
        onOpenLearnCenter={() => {
          dismissFirstRun();
          navigate({ kind: "learn" });
        }}
        onDismiss={dismissFirstRun}
      />
      <GuidedTour
        steps={HOME_TOUR_STEPS}
        storageKey="novelfork:tour-home-completed"
        active={tourActive && !shouldShowFirstRun}
        onComplete={() => setTourActive(false)}
      />
      <ToastContainer />
    </AgentShell>
  );
}
