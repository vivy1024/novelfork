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

  useEffect(() => {
    if (project) {
      setLanguageSet(true);
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

  const activePage =
    route.page === "book" || route.page === "chapter" || route.page === "truth" || route.page === "analytics"
      ? `book:${(route as { bookId: string }).bookId}`
      : route.page;

  if (languageSet === null) {
    return <div className="min-h-screen bg-background" />;
  }

  return (
    <div className="h-screen bg-background text-foreground flex overflow-hidden">
      <Sidebar nav={nav} activePage={activePage} t={t} />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Thin utility strip — pushed inward */}
        <div className="h-12 shrink-0 border-b border-border/20 flex items-center justify-end px-8 gap-4">
          <button
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className="w-7 h-7 flex items-center justify-center rounded-full bg-secondary/40 text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-all text-xs"
          >
            {isDark ? "☀" : "☽"}
          </button>
          {sse.connected && (
            <span className="text-[10px] text-muted-foreground/30 uppercase tracking-[0.15em]">
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
          </div>
        </div>

        {/* Chat bar — inset to match content width */}
        <ChatBar t={t} sse={sse} />
      </div>
    </div>
  );
}
