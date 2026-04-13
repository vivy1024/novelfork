import { useState, useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatPanel } from "./components/ChatBar";
import { TabBar } from "./components/TabBar";
import { CommandPalette } from "./components/CommandPalette";
import { UpdateChecker } from "./components/UpdateChecker";
import { InkOSProvider, useInkOS } from "./providers/inkos-context";
import { Dashboard } from "./pages/Dashboard";
import { BookDetail } from "./pages/BookDetail";
import { BookCreate } from "./pages/BookCreate";
import { ChapterReader } from "./pages/ChapterReader";
import { Analytics } from "./pages/Analytics";
import { ConfigView } from "./pages/ConfigView";
import { WorkspaceSelector } from "./pages/WorkspaceSelector";
import { TruthFiles } from "./pages/TruthFiles";
import { DaemonControl } from "./pages/DaemonControl";
import { LogViewer } from "./pages/LogViewer";
import { GenreManager } from "./pages/GenreManager";
import { StyleManager } from "./pages/StyleManager";
import { ImportManager } from "./pages/ImportManager";
import { RadarView } from "./pages/RadarView";
import { DoctorView } from "./pages/DoctorView";
import { DiffView } from "./pages/DiffView";
import { SearchView } from "./pages/SearchView";
import { BackupView } from "./pages/BackupView";
import { LanguageSelector } from "./pages/LanguageSelector";
import { DetectView } from "./pages/DetectView";
import { NotifyConfig } from "./pages/NotifyConfig";
import { IntentEditor } from "./pages/IntentEditor";
import { AgentPanel } from "./pages/AgentPanel";
import { SchedulerConfig } from "./pages/SchedulerConfig";
import { DetectionConfigView } from "./pages/DetectionConfigView";
import { HookDashboard } from "./pages/HookDashboard";
import { LLMAdvancedConfig } from "./pages/LLMAdvancedConfig";
import { StateProjectionsView } from "./pages/StateProjectionsView";
import { MCPServerManager } from "./pages/MCPServerManager";
import { RecoveryBanner } from "./components/RecoveryBanner";
import { useSSE } from "./hooks/use-sse";
import { useTheme } from "./hooks/use-theme";
import { useI18n } from "./hooks/use-i18n";
import { useTabsState } from "./hooks/use-tabs";
import { useResizable } from "./hooks/use-resizable";
import { useRecovery } from "./hooks/use-crash-recovery";
import { fetchJson, postApi, useApi } from "./hooks/use-api";

export type Route =
  | { page: "dashboard" }
  | { page: "book"; bookId: string }
  | { page: "book-create" }
  | { page: "chapter"; bookId: string; chapterNumber: number }
  | { page: "analytics"; bookId: string }
  | { page: "config" }
  | { page: "truth"; bookId: string }
  | { page: "daemon" }
  | { page: "logs" }
  | { page: "genres" }
  | { page: "style" }
  | { page: "import" }
  | { page: "radar" }
  | { page: "doctor" }
  | { page: "diff"; bookId: string; chapterNumber: number }
  | { page: "search" }
  | { page: "backup" }
  | { page: "detect"; bookId: string }
  | { page: "notify" }
  | { page: "intent"; bookId: string }
  | { page: "agents" }
  | { page: "scheduler-config" }
  | { page: "detection-config" }
  | { page: "hooks" }
  | { page: "llm-advanced" }
  | { page: "state"; bookId: string }
  | { page: "mcp" };

export function deriveActiveBookId(route: Route): string | undefined {
  return route.page === "book" || route.page === "chapter" || route.page === "truth" || route.page === "analytics" || route.page === "diff" || route.page === "detect" || route.page === "intent" || route.page === "state"
    ? route.bookId
    : undefined;
}

type AuthState = "checking" | "unauthenticated" | "authenticated";

function useLaunchAuth() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Tauri mode handles auth via deep link / localStorage — skip server auth
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      setAuthState("authenticated");
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    if (token) {
      window.history.replaceState({}, "", window.location.pathname);
      fetchJson<{ ok: boolean }>("/auth/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      })
        .then(() => setAuthState("authenticated"))
        .catch((e) => {
          setError(e instanceof Error ? e.message : "Login failed");
          setAuthState("unauthenticated");
        });
    } else {
      fetchJson<{ session: unknown }>("/auth/me")
        .then(() => setAuthState("authenticated"))
        .catch(() => setAuthState("unauthenticated"));
    }
  }, []);

  return { authState, error };
}

function LoginGate({ error }: { error: string | null }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="max-w-sm text-center space-y-4">
        <h1 className="text-2xl font-serif text-foreground">InkOS Studio</h1>
        <p className="text-sm text-muted-foreground">
          {error ?? "请从 Sub2API 控制台登录后访问。"}
        </p>
        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}
      </div>
    </div>
  );
}

export function App() {
  return (
    <InkOSProvider>
      <AppInner />
    </InkOSProvider>
  );
}

function AppInner() {
  const { authState, error: authError } = useLaunchAuth();
  const { mode, selectWorkspace, workspace } = useInkOS();
  const { tabs, activeTabId, activeTab, openTab, closeTab, activateTab } = useTabsState();
  const [bookCreateOpen, setBookCreateOpen] = useState(false);
  const sse = useSSE();
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();

  // 同步检测 Tauri 环境，不依赖异步 mode 状态
  const isTauriEnv = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const isTauri = isTauriEnv || mode === "tauri";

  const { data: project, refetch: refetchProject } = useApi<{ language: string; languageExplicit: boolean }>(isTauri ? null : "/project");
  const [showLanguageSelector, setShowLanguageSelector] = useState(false);
  const [ready, setReady] = useState(isTauri);
  const [chatOpen, setChatOpen] = useState(false);
  const [wsReady, setWsReady] = useState(!isTauri || !!workspace);
  const [cmdOpen, setCmdOpen] = useState(false);

  const sidebarResize = useResizable({ initialWidth: 260, minWidth: 200, maxWidth: 400, side: "left" });
  const chatResize = useResizable({ initialWidth: 320, minWidth: 240, maxWidth: 500, side: "right" });
  const recovery = useRecovery();

  const isDark = theme === "dark";

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen(prev => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  useEffect(() => {
    if (project) {
      if (!project.languageExplicit) {
        setShowLanguageSelector(true);
      }
      setReady(true);
    }
  }, [project]);

  // Tauri mode: ready immediately (no server project config to wait for)
  useEffect(() => {
    if (isTauri) setReady(true);
  }, [isTauri]);

  // Tauri workspace restored from localStorage
  useEffect(() => {
    if (isTauri && workspace) setWsReady(true);
  }, [isTauri, workspace]);

  // Tauri workspace gate — must pick a folder before anything else
  if (isTauri && !wsReady) {
    return (
      <WorkspaceSelector
        onSelect={() => setWsReady(true)}
        selectWorkspace={selectWorkspace!}
        t={t}
      />
    );
  }

  // Auth gate (web only — Tauri skips server auth)
  if (!isTauri && authState === "checking") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!isTauri && authState === "unauthenticated") {
    return <LoginGate error={authError} />;
  }

  if (!ready) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (showLanguageSelector) {
    return (
      <LanguageSelector
        onSelect={async (lang) => {
          await postApi("/project/language", { language: lang });
          setShowLanguageSelector(false);
          refetchProject();
        }}
      />
    );
  }

  const nav = {
    toDashboard: () => openTab({ page: "dashboard" }),
    toBook: (bookId: string) => openTab({ page: "book", bookId }),
    toBookCreate: () => setBookCreateOpen(true),
    toChapter: (bookId: string, chapterNumber: number) =>
      openTab({ page: "chapter", bookId, chapterNumber }),
    toAnalytics: (bookId: string) => openTab({ page: "analytics", bookId }),
    toConfig: () => openTab({ page: "config" }),
    toTruth: (bookId: string) => openTab({ page: "truth", bookId }),
    toDaemon: () => openTab({ page: "daemon" }),
    toLogs: () => openTab({ page: "logs" }),
    toGenres: () => openTab({ page: "genres" }),
    toStyle: () => openTab({ page: "style" }),
    toImport: () => openTab({ page: "import" }),
    toRadar: () => openTab({ page: "radar" }),
    toDoctor: () => openTab({ page: "doctor" }),
    toSearch: () => openTab({ page: "search" }),
    toBackup: () => openTab({ page: "backup" }),
    toDiff: (bookId: string, chapterNumber: number) =>
      openTab({ page: "diff", bookId, chapterNumber }),
    toDetect: (bookId: string) => openTab({ page: "detect", bookId }),
    toNotify: () => openTab({ page: "notify" }),
    toIntent: (bookId: string) => openTab({ page: "intent", bookId }),
    toAgents: () => openTab({ page: "agents" }),
    toSchedulerConfig: () => openTab({ page: "scheduler-config" }),
    toDetectionConfig: () => openTab({ page: "detection-config" }),
    toHooks: () => openTab({ page: "hooks" }),
    toLLMAdvanced: () => openTab({ page: "llm-advanced" }),
    toState: (bookId: string) => openTab({ page: "state", bookId }),
    toMCP: () => openTab({ page: "mcp" }),
  };

  const activeBookId = activeTab ? deriveActiveBookId(activeTab.route) : undefined;
  const activePage = (() => {
    const r = activeTab?.route;
    if (!r) return "dashboard";
    if (r.page === "chapter") return `chapter:${r.bookId}:${r.chapterNumber}`;
    if (r.page === "truth") return `truth:${r.bookId}`;
    if (r.page === "analytics") return `analytics:${r.bookId}`;
    if (r.page === "book") return `book:${r.bookId}`;
    return r.page;
  })();

  return (
    <div className="h-screen bg-background text-foreground flex overflow-hidden font-sans">
      {/* Left Sidebar */}
      <div style={{ width: sidebarResize.width }} className="shrink-0">
        <Sidebar nav={nav} activePage={activePage} sse={sse} t={t} />
      </div>

      {/* Left Drag Handle */}
      <div {...sidebarResize.handleProps} />

      {/* Center Content */}
      <div className="flex-1 flex flex-col min-w-0 bg-background/30 backdrop-blur-sm">
        {/* Tab Bar */}
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onActivate={activateTab}
          onClose={closeTab}
          isDark={isDark}
          onToggleTheme={() => setTheme(isDark ? "light" : "dark")}
          chatOpen={chatOpen}
          onToggleChat={() => setChatOpen((prev) => !prev)}
        />

        {/* Main Content Area — all open tabs rendered, only active visible */}
        <main className="flex-1 overflow-y-auto scroll-smooth relative">
          {isTauri && recovery.hasRecovery && (
            <RecoveryBanner
              entries={recovery.entries}
              onRecoverAll={async () => {
                for (const entry of recovery.entries) {
                  await recovery.recover(entry);
                }
              }}
              onDismiss={() => recovery.dismissAll()}
              t={t}
            />
          )}
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={tab.id === activeTabId ? "block" : "hidden"}
            >
              <div className="max-w-4xl mx-auto px-6 py-12 md:px-12 lg:py-16 fade-in">
                <TabContent route={tab.route} nav={nav} theme={theme} t={t} sse={sse} />
              </div>
            </div>
          ))}
        </main>
      </div>

      {/* BookCreate Modal */}
      {bookCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setBookCreateOpen(false); }}
        >
          <div className="bg-background rounded-2xl shadow-2xl border border-border/40 w-full max-w-lg max-h-[90vh] overflow-y-auto p-8 relative">
            <button
              onClick={() => setBookCreateOpen(false)}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground text-lg leading-none"
              aria-label="Close"
            >
              &times;
            </button>
            <BookCreate
              nav={{
                ...nav,
                toDashboard: () => setBookCreateOpen(false),
                toBook: (id: string) => { setBookCreateOpen(false); nav.toBook(id); },
              }}
              theme={theme}
              t={t}
            />
          </div>
        </div>
      )}

      {/* Right Drag Handle */}
      {chatOpen && <div {...chatResize.handleProps} />}

      {/* Right Chat Panel */}
      <div style={{ width: chatOpen ? chatResize.width : 0 }} className="shrink-0">
        <ChatPanel
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          t={t}
          sse={sse}
          activeBookId={activeBookId}
        />
      </div>

      {/* Auto-Updater (Tauri only) */}
      {isTauri && <UpdateChecker />}

      {/* Command Palette */}
      {cmdOpen && (
        <CommandPalette
          nav={nav}
          tabs={tabs}
          activateTab={activateTab}
          onClose={() => setCmdOpen(false)}
          onNewBook={() => setBookCreateOpen(true)}
          t={t}
        />
      )}
    </div>
  );
}

function TabContent({ route, nav, theme, t, sse }: {
  route: Route;
  nav: any;
  theme: any;
  t: any;
  sse: any;
}) {
  switch (route.page) {
    case "dashboard": return <Dashboard nav={nav} sse={sse} theme={theme} t={t} />;
    case "book": return <BookDetail bookId={route.bookId} nav={nav} theme={theme} t={t} sse={sse} />;
    case "book-create": return <BookCreate nav={nav} theme={theme} t={t} />;
    case "chapter": return <ChapterReader bookId={route.bookId} chapterNumber={route.chapterNumber} nav={nav} theme={theme} t={t} />;
    case "analytics": return <Analytics bookId={route.bookId} nav={nav} theme={theme} t={t} />;
    case "config": return <ConfigView nav={nav} theme={theme} t={t} />;
    case "truth": return <TruthFiles bookId={route.bookId} nav={nav} theme={theme} t={t} />;
    case "daemon": return <DaemonControl nav={nav} theme={theme} t={t} sse={sse} />;
    case "logs": return <LogViewer nav={nav} theme={theme} t={t} />;
    case "genres": return <GenreManager nav={nav} theme={theme} t={t} />;
    case "style": return <StyleManager nav={nav} theme={theme} t={t} />;
    case "import": return <ImportManager nav={nav} theme={theme} t={t} />;
    case "radar": return <RadarView nav={nav} theme={theme} t={t} />;
    case "doctor": return <DoctorView nav={nav} theme={theme} t={t} />;
    case "search": return <SearchView nav={nav} theme={theme} t={t} />;
    case "diff": return <DiffView bookId={route.bookId} chapterNumber={route.chapterNumber} nav={nav} theme={theme} t={t} />;
    case "backup": return <BackupView nav={nav} theme={theme} t={t} />;
    case "detect": return <DetectView bookId={route.bookId} nav={nav} theme={theme} t={t} />;
    case "notify": return <NotifyConfig nav={nav} theme={theme} t={t} />;
    case "intent": return <IntentEditor bookId={route.bookId} nav={nav} theme={theme} t={t} />;
    case "agents": return <AgentPanel nav={nav} theme={theme} t={t} />;
    case "scheduler-config": return <SchedulerConfig nav={nav} theme={theme} t={t} />;
    case "detection-config": return <DetectionConfigView nav={nav} theme={theme} t={t} />;
    case "hooks": return <HookDashboard nav={nav} theme={theme} t={t} />;
    case "llm-advanced": return <LLMAdvancedConfig nav={nav} theme={theme} t={t} />;
    case "state": return <StateProjectionsView bookId={route.bookId} nav={nav} theme={theme} t={t} />;
    case "mcp": return <MCPServerManager nav={nav} theme={theme} t={t} />;
    default: return null;
  }
}
