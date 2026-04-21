import { useState, useEffect, useCallback } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { ChatPanel } from "./components/ChatBar";
import { TabBar } from "./components/TabBar";
import { CommandPalette } from "./components/CommandPalette";
import { SearchDialog } from "./components/Search/SearchDialog";
import { UpdateChecker } from "./components/UpdateChecker";
import { NovelForkProvider, useNovelFork } from "./providers/novelfork-context";
import { Dashboard } from "./pages/Dashboard";
import { BookDetail } from "./pages/BookDetail";
import { BookCreate } from "./pages/BookCreate";
import { ChapterReader } from "./pages/ChapterReader";
import { Analytics } from "./pages/Analytics";
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
import { IntentEditor } from "./pages/IntentEditor";
import { StateProjectionsView } from "./pages/StateProjectionsView";
import { PipelineVisualization } from "./pages/PipelineVisualization";
import { SettingsView } from "./pages/SettingsView";
import { WorktreeManager } from "./pages/WorktreeManager";
import { SessionCenter } from "./pages/SessionCenter";
import { WorkflowWorkbench } from "./pages/WorkflowWorkbench";
import { Admin } from "./components/Admin/Admin";
import { ReferencePanel } from "./components/ReferencePanel";
import { RecoveryBanner } from "./components/RecoveryBanner";
import { useSSE } from "./hooks/use-sse";
import { useTheme } from "./hooks/use-theme";
import { useI18n } from "./hooks/use-i18n";
import { useTabsState } from "./hooks/use-tabs";
import { useLayoutConfig } from "./hooks/use-layout-config";
import { useRecovery } from "./hooks/use-crash-recovery";
import { persistTabSession, restoreTabSession } from "./hooks/use-persisted-tabs";
import { fetchJson, postApi, useApi } from "./hooks/use-api";
import type { SearchResult } from "./shared/search-types";
import type { AdminSection, Route, SettingsSection, WorkflowSection } from "./routes";
import { validatePersistedTabSession } from "./routes";
import { deriveActiveBookId } from "./route-utils";

/**
 * Silent token import — if URL has ?token=, establish session in background.
 * No gate: IDE is always accessible. Token just unlocks session-based LLM config.
 */
function useSilentTokenImport() {
  useEffect(() => {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) return;

    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token) {
      window.history.replaceState({}, "", window.location.pathname);
      fetchJson<{ ok: boolean }>("/auth/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      }).catch(() => {
        // Token import failed silently — user can still use IDE
      });
    }
  }, []);
}

export function App() {
  return (
    <NovelForkProvider>
      <AppInner />
    </NovelForkProvider>
  );
}

function AppInner() {
  useSilentTokenImport();
  const { mode, selectWorkspace, workspace } = useNovelFork();
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
  const [searchOpen, setSearchOpen] = useState(false);

  const { config, loaded: layoutLoaded, updateConfig } = useLayoutConfig();
  const [refPanelOpen, setRefPanelOpen] = useState(false);
  const recovery = useRecovery();

  // Sidebar drag state
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const [sidebarStartX, setSidebarStartX] = useState(0);
  const [sidebarStartWidth, setSidebarStartWidth] = useState(0);

  // Bottom panel drag state
  const [bottomDragging, setBottomDragging] = useState(false);
  const [bottomStartY, setBottomStartY] = useState(0);
  const [bottomStartHeight, setBottomStartHeight] = useState(0);

  const isDark = theme === "dark";

  // Sidebar drag handlers
  const handleSidebarMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setSidebarStartX(e.clientX);
    setSidebarStartWidth(config.sidebarWidth);
    setSidebarDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [config.sidebarWidth]);

  const handleSidebarMouseMove = useCallback((e: MouseEvent) => {
    if (!sidebarDragging) return;
    const delta = e.clientX - sidebarStartX;
    const newWidth = Math.max(200, Math.min(400, sidebarStartWidth + delta));
    updateConfig({ sidebarWidth: newWidth });
  }, [sidebarDragging, sidebarStartX, sidebarStartWidth, updateConfig]);

  const handleSidebarMouseUp = useCallback(() => {
    setSidebarDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  // Bottom panel drag handlers
  const handleBottomMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setBottomStartY(e.clientY);
    setBottomStartHeight(config.bottomPanelHeight);
    setBottomDragging(true);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, [config.bottomPanelHeight]);

  const handleBottomMouseMove = useCallback((e: MouseEvent) => {
    if (!bottomDragging) return;
    const delta = bottomStartY - e.clientY;
    const newHeight = Math.max(120, Math.min(400, bottomStartHeight + delta));
    updateConfig({ bottomPanelHeight: newHeight });
  }, [bottomDragging, bottomStartY, bottomStartHeight, updateConfig]);

  const handleBottomMouseUp = useCallback(() => {
    setBottomDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  // Toggle bottom panel collapse
  const toggleBottomPanel = useCallback(() => {
    updateConfig({ bottomPanelCollapsed: !config.bottomPanelCollapsed });
  }, [config.bottomPanelCollapsed, updateConfig]);

  // Attach global mouse listeners for dragging
  useEffect(() => {
    if (sidebarDragging) {
      window.addEventListener("mousemove", handleSidebarMouseMove);
      window.addEventListener("mouseup", handleSidebarMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleSidebarMouseMove);
        window.removeEventListener("mouseup", handleSidebarMouseUp);
      };
    }
  }, [sidebarDragging, handleSidebarMouseMove, handleSidebarMouseUp]);

  useEffect(() => {
    if (bottomDragging) {
      window.addEventListener("mousemove", handleBottomMouseMove);
      window.addEventListener("mouseup", handleBottomMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleBottomMouseMove);
        window.removeEventListener("mouseup", handleBottomMouseUp);
      };
    }
  }, [bottomDragging, handleBottomMouseMove, handleBottomMouseUp]);

  // Persist tabs to IndexedDB on change
  useEffect(() => {
    persistTabSession(
      tabs.map((t) => ({ route: t.route, id: t.id })),
      activeTabId,
    ).catch(() => {});
  }, [tabs, activeTabId]);

  // Restore tabs from IndexedDB on mount
  useEffect(() => {
    restoreTabSession().then((rawSession) => {
      const session = validatePersistedTabSession(rawSession);
      if (!session?.tabs.length) return;
      for (const saved of session.tabs) {
        openTab(saved.route);
      }
      activateTab(session.activeTabId);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        // Shift+Cmd+K for search, Cmd+K for command palette
        if (e.shiftKey) {
          setSearchOpen(prev => !prev);
        } else {
          setCmdOpen(prev => !prev);
        }
      }
      // Ctrl+S — prevent browser save, dispatch custom event for editors
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("novelfork:save"));
      }
      // Ctrl+B — toggle reference panel
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        setRefPanelOpen(prev => !prev);
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

  // Auth gate removed — IDE always accessible
  // Token import is handled silently by useSilentTokenImport()

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
    toWorkflow: (section?: WorkflowSection) => openTab({ page: "workflow", section }),
    toSessions: () => openTab({ page: "sessions" }),
    toBook: (bookId: string) => openTab({ page: "book", bookId }),
    toBookCreate: () => setBookCreateOpen(true),
    toChapter: (bookId: string, chapterNumber: number) =>
      openTab({ page: "chapter", bookId, chapterNumber }),
    toAnalytics: (bookId: string) => openTab({ page: "analytics", bookId }),
    toTruth: (bookId: string) => openTab({ page: "truth", bookId }),
    toAdmin: (section?: AdminSection) => openTab({ page: "admin", section }),
    toDaemon: () => openTab({ page: "admin", section: "daemon" }),
    toLogs: () => openTab({ page: "admin", section: "logs" }),
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
    toIntent: (bookId: string) => openTab({ page: "intent", bookId }),
    toState: (bookId: string) => openTab({ page: "state", bookId }),
    toPipeline: (runId?: string) => openTab({ page: "pipeline", runId }),
    toSettings: (section?: SettingsSection) => openTab({ page: "settings", section }),
    toWorktree: () => openTab({ page: "admin", section: "worktrees" }),
  };

  const activeBookId = activeTab ? deriveActiveBookId(activeTab.route) : undefined;
  const activeChapterNumber = activeTab?.route.page === "chapter" ? activeTab.route.chapterNumber : undefined;
  const activePage = (() => {
    const route = activeTab?.route;
    if (!route) return "dashboard";
    if (route.page === "chapter") return `chapter:${route.bookId}:${route.chapterNumber}`;
    if (route.page === "truth") return `truth:${route.bookId}`;
    if (route.page === "analytics") return `analytics:${route.bookId}`;
    if (route.page === "book") return `book:${route.bookId}`;
    if (route.page === "workflow") return route.section ? `workflow:${route.section}` : "workflow";
    if (route.page === "admin") return route.section ? `admin:${route.section}` : "admin";
    if (route.page === "settings") return route.section ? `settings:${route.section}` : "settings";
    return route.page;
  })();

  // Calculate actual bottom panel height (collapsed = 32px for title bar only)
  const actualBottomHeight = config.bottomPanelCollapsed ? 32 : config.bottomPanelHeight;

  return (
    <div
      className="h-screen bg-background text-foreground overflow-hidden font-sans"
      style={{
        display: "grid",
        gridTemplateColumns: `${config.sidebarWidth}px 1fr`,
        gridTemplateRows: refPanelOpen ? `1fr ${actualBottomHeight}px` : "1fr",
      }}
    >
      {/* Left Sidebar */}
      <div className="row-span-2 flex flex-col">
        <Sidebar nav={nav} activePage={activePage} sse={sse} t={t} />
      </div>

      {/* Sidebar Drag Handle */}
      <div
        onMouseDown={handleSidebarMouseDown}
        className="absolute w-1 h-full shrink-0 hover:bg-primary/20 transition-colors cursor-col-resize z-10"
        style={{ left: config.sidebarWidth, top: 0 }}
      />

      {/* Main Content Area */}
      <div className="flex flex-col min-w-0 bg-background/30 backdrop-blur-sm overflow-hidden">
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
          repoPath={workspace || undefined}
        />

        {/* Main Content — all open tabs rendered, only active visible */}
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
              <div className="px-6 py-8 md:px-12 lg:py-12 fade-in">
                <TabContent route={tab.route} nav={nav} theme={theme} t={t} sse={sse} setTheme={setTheme} />
              </div>
            </div>
          ))}
        </main>

        {/* Status Bar */}
        <footer className="h-6 shrink-0 flex items-center px-4 text-[10px] text-muted-foreground border-t border-border/40 bg-background/80 gap-4">
          <span>NovelFork Studio</span>
          <span className="ml-auto">Ctrl+K 命令面板 · Ctrl+B 参考面板 · Ctrl+S 保存</span>
        </footer>
      </div>

      {/* Bottom Reference Panel */}
      {refPanelOpen && (
        <>
          {/* Bottom Panel Drag Handle */}
          {!config.bottomPanelCollapsed && (
            <div
              onMouseDown={handleBottomMouseDown}
              className="col-start-2 h-1 shrink-0 hover:bg-primary/20 transition-colors cursor-row-resize z-10"
            />
          )}

          {/* Bottom Panel Content */}
          <div className="col-start-2 border-t border-border bg-background/50 flex flex-col overflow-hidden">
            {/* Title Bar with Collapse Button */}
            <div className="h-8 shrink-0 flex items-center px-3 border-b border-border/40 bg-background/80">
              <span className="text-xs font-medium text-foreground">参考面板</span>
              <button
                onClick={toggleBottomPanel}
                className="ml-auto p-1 hover:bg-secondary/50 rounded transition-colors"
                aria-label={config.bottomPanelCollapsed ? "展开" : "折叠"}
              >
                {config.bottomPanelCollapsed ? (
                  <ChevronUp size={14} className="text-muted-foreground" />
                ) : (
                  <ChevronDown size={14} className="text-muted-foreground" />
                )}
              </button>
            </div>

            {/* Panel Content (hidden when collapsed) */}
            {!config.bottomPanelCollapsed && (
              <div className="flex-1 overflow-hidden">
                <ReferencePanel height={config.bottomPanelHeight - 32} bookId={activeBookId} chapterNumber={activeChapterNumber} />
              </div>
            )}
          </div>
        </>
      )}

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

      {/* Right Chat Panel (overlay, not in grid) */}
      {chatOpen && (
        <div className="fixed right-0 top-0 h-full w-80 z-20 shadow-2xl">
          <ChatPanel
            open={chatOpen}
            onClose={() => setChatOpen(false)}
            t={t}
            sse={sse}
            activeBookId={activeBookId}
          />
        </div>
      )}

      {/* Auto-Updater (Tauri only) */}
      {isTauri && <UpdateChecker />}

      {/* Command Palette */}
      {cmdOpen && (
        <CommandPalette
          nav={nav}
          tabs={tabs}
          activateTab={activateTab}
          onClose={() => setCmdOpen(false)}
          onNewBook={() => nav.toBookCreate()}
          t={t}
        />
      )}
    </div>
  );
}

function TabContent({ route, nav, theme, t, sse, setTheme }: {
  route: Route;
  nav: any;
  theme: any;
  t: any;
  sse: any;
  setTheme: (theme: "light" | "dark" | "auto") => void;
}) {
  switch (route.page) {
    case "dashboard": return <Dashboard nav={nav} sse={sse} theme={theme} t={t} />;
    case "workflow":
      return (
        <WorkflowWorkbench
          nav={nav}
          theme={theme}
          t={t}
          section={route.section}
          onNavigateSection={(section) => nav.toWorkflow(section)}
        />
      );
    case "sessions": return <SessionCenter theme={theme} />;
    case "book": return <BookDetail bookId={route.bookId} nav={nav} theme={theme} t={t} sse={sse} />;
    case "book-create": return <BookCreate nav={nav} theme={theme} t={t} />;
    case "chapter": return <ChapterReader bookId={route.bookId} chapterNumber={route.chapterNumber} nav={nav} theme={theme} t={t} />;
    case "analytics": return <Analytics bookId={route.bookId} nav={nav} theme={theme} t={t} />;
    case "truth": return <TruthFiles bookId={route.bookId} nav={nav} theme={theme} t={t} />;
    case "genres": return <GenreManager nav={nav} theme={theme} t={t} />;
    case "style": return <StyleManager nav={nav} theme={theme} t={t} />;
    case "import": return <ImportManager nav={nav} theme={theme} t={t} />;
    case "radar": return <RadarView nav={nav} theme={theme} t={t} />;
    case "doctor": return <DoctorView nav={nav} theme={theme} t={t} />;
    case "search": return <SearchView nav={nav} theme={theme} t={t} />;
    case "diff": return <DiffView bookId={route.bookId} chapterNumber={route.chapterNumber} nav={nav} theme={theme} t={t} />;
    case "backup": return <BackupView nav={nav} theme={theme} t={t} />;
    case "detect": return <DetectView bookId={route.bookId} nav={nav} theme={theme} t={t} />;
    case "intent": return <IntentEditor bookId={route.bookId} nav={nav} theme={theme} t={t} />;
    case "state": return <StateProjectionsView bookId={route.bookId} nav={nav} theme={theme} t={t} />;
    case "pipeline": return <PipelineVisualization runId={route.runId} nav={nav} sse={sse} theme={theme} t={t} />;
    case "settings":
      return (
        <SettingsView
          nav={nav}
          theme={theme}
          t={t}
          onThemeChange={setTheme}
          section={route.section}
          onNavigateSection={(section) => nav.toSettings(section)}
        />
      );
    case "admin": {
      if (route.section === "daemon") {
        return <DaemonControl nav={nav} theme={theme} t={t} sse={sse} />;
      }
      if (route.section === "logs") {
        return <LogViewer nav={nav} theme={theme} t={t} />;
      }
      if (route.section === "worktrees") {
        return <WorktreeManager onBack={() => nav.toAdmin()} />;
      }
      return (
        <Admin
          onBack={nav.toDashboard}
          section={route.section}
          onNavigateSection={(section) => nav.toAdmin(section)}
        />
      );
    }
    default: return null;
  }
}
