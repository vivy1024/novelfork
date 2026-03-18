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
import { GenreManager } from "./pages/GenreManager";
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
  | { page: "logs" }
  | { page: "genres" };

export function App() {
  const [route, setRoute] = useState<Route>({ page: "dashboard" });
  const sse = useSSE();
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();
  const { data: project, refetch: refetchProject } = useApi<{ language: string; languageExplicit: boolean }>("/project");
  const [showLanguageSelector, setShowLanguageSelector] = useState(false);
  const [ready, setReady] = useState(false);

  const isDark = theme === "dark";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  // Check if language needs to be set (first-time flow)
  useEffect(() => {
    if (project) {
      if (!project.languageExplicit) {
        setShowLanguageSelector(true);
      }
      setReady(true);
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
    toGenres: () => setRoute({ page: "genres" }),
  };

  const activePage =
    route.page === "book" || route.page === "chapter" || route.page === "truth" || route.page === "analytics"
      ? `book:${(route as { bookId: string }).bookId}`
      : route.page;

  if (!ready) {
    return <div className="min-h-screen bg-background" />;
  }

  if (showLanguageSelector) {
    return (
      <LanguageSelector
        onSelect={async (lang) => {
          await fetch("/api/project/language", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ language: lang }),
          });
          setShowLanguageSelector(false);
          refetchProject();
        }}
      />
    );
  }

  return (
    <div className="h-screen bg-background text-foreground flex overflow-hidden">
      <Sidebar nav={nav} activePage={activePage} t={t} />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Thin utility strip — pushed inward */}
        <div className="h-12 shrink-0 flex items-center justify-end px-8 gap-4">
          <button
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-all text-sm"
          >
            {isDark ? "☀" : "☽"}
          </button>
          {sse.connected && (
            <span className="text-xs text-muted-foreground uppercase tracking-wide">
              {t("nav.connected")}
            </span>
          )}
        </div>

        {/* Scrollable main — centered with generous inset */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-10 py-12">
            {route.page === "dashboard" && <Dashboard nav={nav} sse={sse} theme={theme} t={t} />}
            {route.page === "book" && <BookDetail bookId={route.bookId} nav={nav} theme={theme} t={t} />}
            {route.page === "book-create" && <BookCreate nav={nav} theme={theme} t={t} />}
            {route.page === "chapter" && <ChapterReader bookId={route.bookId} chapterNumber={route.chapterNumber} nav={nav} theme={theme} t={t} />}
            {route.page === "analytics" && <Analytics bookId={route.bookId} nav={nav} theme={theme} t={t} />}
            {route.page === "config" && <ConfigView nav={nav} theme={theme} t={t} />}
            {route.page === "truth" && <TruthFiles bookId={route.bookId} nav={nav} theme={theme} t={t} />}
            {route.page === "daemon" && <DaemonControl nav={nav} theme={theme} t={t} sse={sse} />}
            {route.page === "logs" && <LogViewer nav={nav} theme={theme} t={t} />}
            {route.page === "genres" && <GenreManager nav={nav} theme={theme} t={t} />}
          </div>
        </div>

        {/* Chat bar — inset to match content width */}
        <ChatBar t={t} sse={sse} />
      </div>
    </div>
  );
}
