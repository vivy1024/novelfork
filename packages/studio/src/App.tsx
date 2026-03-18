import { useState, useEffect } from "react";
import { Dashboard } from "./pages/Dashboard";
import { BookDetail } from "./pages/BookDetail";
import { BookCreate } from "./pages/BookCreate";
import { ChapterReader } from "./pages/ChapterReader";
import { Analytics } from "./pages/Analytics";
import { ConfigView } from "./pages/ConfigView";
import { TruthFiles } from "./pages/TruthFiles";
import { DaemonControl } from "./pages/DaemonControl";
import { LogViewer } from "./pages/LogViewer";
import { useSSE } from "./hooks/use-sse";
import { useTheme } from "./hooks/use-theme";
import { useI18n } from "./hooks/use-i18n";

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

  const isDark = theme === "dark";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

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

  const navItems = [
    { label: t("nav.books"), action: nav.toDashboard, active: route.page === "dashboard" || route.page === "book" || route.page === "chapter" },
    { label: t("nav.newBook"), action: nav.toBookCreate, active: route.page === "book-create" },
    { label: "Daemon", action: nav.toDaemon, active: route.page === "daemon" },
    { label: "Logs", action: nav.toLogs, active: route.page === "logs" },
    { label: t("nav.config"), action: nav.toConfig, active: route.page === "config" },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/90 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <button
              onClick={nav.toDashboard}
              className="group flex items-baseline gap-0.5 hover:opacity-80 transition-opacity"
            >
              <span className="font-serif text-xl italic text-primary">Ink</span>
              <span className="text-lg font-medium tracking-tight">OS</span>
            </button>

            <nav className="flex gap-1 text-[13px] text-muted-foreground">
              {navItems.map((item) => (
                <button
                  key={item.label}
                  onClick={item.action}
                  className={`px-3 py-2 rounded-md transition-all duration-200 ${
                    item.active
                      ? "text-foreground bg-secondary"
                      : "hover:text-foreground hover:bg-secondary/50"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setTheme(isDark ? "light" : "dark")}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-secondary text-muted-foreground hover:text-foreground transition-colors text-xs"
            >
              {isDark ? "☀" : "☽"}
            </button>
            {sse.connected && (
              <span className="text-[11px] text-muted-foreground/60 tracking-wide uppercase">
                {t("nav.connected")}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        {route.page === "dashboard" && <Dashboard nav={nav} sse={sse} theme={theme} t={t} />}
        {route.page === "book" && <BookDetail bookId={route.bookId} nav={nav} theme={theme} t={t} />}
        {route.page === "book-create" && <BookCreate nav={nav} theme={theme} t={t} />}
        {route.page === "chapter" && <ChapterReader bookId={route.bookId} chapterNumber={route.chapterNumber} nav={nav} theme={theme} t={t} />}
        {route.page === "analytics" && <Analytics bookId={route.bookId} nav={nav} theme={theme} t={t} />}
        {route.page === "config" && <ConfigView nav={nav} theme={theme} t={t} />}
        {route.page === "truth" && <TruthFiles bookId={route.bookId} nav={nav} theme={theme} t={t} />}
        {route.page === "daemon" && <DaemonControl nav={nav} theme={theme} t={t} sse={sse} />}
        {route.page === "logs" && <LogViewer nav={nav} theme={theme} t={t} />}
      </main>
    </div>
  );
}
