import { useState, useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatBar } from "./components/ChatBar";
import { Dashboard } from "./pages/Dashboard";
import { BookDetail } from "./pages/BookDetail";
import { BookCreate } from "./pages/BookCreate";
import { ChapterReader } from "./pages/ChapterReader";
import { Analytics } from "./pages/Analytics";
import { ConfigView } from "./pages/ConfigView";
import { TruthFiles } from "./pages/TruthFiles";
import { DaemonControl } from "./pages/DaemonControl";
import { LogViewer } from "./pages/LogViewer";
import { LanguageSelector } from "./pages/LanguageSelector";
import { useSSE } from "./hooks/use-sse";
import { useTheme } from "./hooks/use-theme";
import { useI18n } from "./hooks/use-i18n";
import { useApi } from "./hooks/use-api";

type Route =
  | { page: "dashboard" }
  | { page: "book"; bookId: string }
  | { page: "book-create" }
  | { page: "chapter"; bookId: string; chapterNumber: number }
  | { page: "analytics"; bookId: string }
  | { page: "config" }
  | { page: "truth"; bookId: string }
  | { page: "daemon" }
  | { page: "logs" };

export function App() {
  const [route, setRoute] = useState<Route>({ page: "dashboard" });
  const sse = useSSE();
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();
  const { data: project } = useApi<{ language: string }>("/project");
  const [languageSet, setLanguageSet] = useState<boolean | null>(null);

  const isDark = theme === "dark";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  // Check if language has been set
  useEffect(() => {
    if (project) {
      setLanguageSet(!!project.language && project.language !== "zh" ? true : true);
      // For now, always consider language "set" — the selector is for first-time experience
      // In a real implementation, we'd check a "hasCompletedSetup" flag
    }
  }, [project]);

  const nav = {
    toDashboard: () => setRoute({ page: "dashboard" }),
    toBook: (bookId: string) => setRoute({ page: "book", bookId }),
    toBookCreate: () => setRoute({ page: "book-create" }),
    toChapter: (bookId: string, chapterNumber: number) =>
      setRoute({ page: "chapter", bookId, chapterNumber }),
    toAnalytics: (bookId: string) => setRoute({ page: "analytics", bookId }),
    toConfig: () => setRoute({ page: "config" }),
    toTruth: (bookId: string) => setRoute({ page: "truth", bookId }),
    toDaemon: () => setRoute({ page: "daemon" }),
    toLogs: () => setRoute({ page: "logs" }),
  };

  // Derive active page for sidebar highlighting
  const activePage =
    route.page === "book" || route.page === "chapter" || route.page === "truth" || route.page === "analytics"
      ? `book:${(route as { bookId: string }).bookId}`
      : route.page;

  // Language selector for first-time setup
  if (languageSet === null) {
    return <div className="min-h-screen bg-background" />; // Loading
  }

  return (
    <div className="h-screen bg-background text-foreground flex overflow-hidden">
      {/* Sidebar */}
      <Sidebar nav={nav} activePage={activePage} t={t} />

      {/* Main area + Chat bar */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header strip */}
        <div className="h-11 shrink-0 border-b border-border/30 flex items-center justify-end px-4 gap-3">
          <button
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors text-xs"
          >
            {isDark ? "☀" : "☽"}
          </button>
          {sse.connected && (
            <span className="text-[10px] text-muted-foreground/40 uppercase tracking-wider">
              {t("nav.connected")}
            </span>
          )}
        </div>

        {/* Scrollable main content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-6 py-8">
            {route.page === "dashboard" && <Dashboard nav={nav} sse={sse} theme={theme} t={t} />}
            {route.page === "book" && <BookDetail bookId={route.bookId} nav={nav} theme={theme} t={t} />}
            {route.page === "book-create" && <BookCreate nav={nav} theme={theme} t={t} />}
            {route.page === "chapter" && <ChapterReader bookId={route.bookId} chapterNumber={route.chapterNumber} nav={nav} theme={theme} t={t} />}
            {route.page === "analytics" && <Analytics bookId={route.bookId} nav={nav} theme={theme} t={t} />}
            {route.page === "config" && <ConfigView nav={nav} theme={theme} t={t} />}
            {route.page === "truth" && <TruthFiles bookId={route.bookId} nav={nav} theme={theme} t={t} />}
            {route.page === "daemon" && <DaemonControl nav={nav} theme={theme} t={t} sse={sse} />}
            {route.page === "logs" && <LogViewer nav={nav} theme={theme} t={t} />}
          </div>
        </div>

        {/* Chat bar - always at bottom */}
        <ChatBar t={t} sse={sse} />
      </div>
    </div>
  );
}
