import { useState, useEffect } from "react";
import { Dashboard } from "./pages/Dashboard";
import { BookDetail } from "./pages/BookDetail";
import { BookCreate } from "./pages/BookCreate";
import { ChapterReader } from "./pages/ChapterReader";
import { Analytics } from "./pages/Analytics";
import { ConfigView } from "./pages/ConfigView";
import { useSSE } from "./hooks/use-sse";
import { useTheme } from "./hooks/use-theme";
import { useI18n } from "./hooks/use-i18n";

type Route =
  | { page: "dashboard" }
  | { page: "book"; bookId: string }
  | { page: "book-create" }
  | { page: "chapter"; bookId: string; chapterNumber: number }
  | { page: "analytics"; bookId: string }
  | { page: "config" };

export function App() {
  const [route, setRoute] = useState<Route>({ page: "dashboard" });
  const sse = useSSE();
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();

  const isDark = theme === "dark";

  // Toggle dark class on root for CSS variable switching
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
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 backdrop-blur-sm border-b border-border bg-background/80 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <button
            onClick={nav.toDashboard}
            className="text-lg font-bold tracking-tight hover:opacity-80 transition-opacity"
          >
            <span className={isDark ? "text-blue-400" : "text-blue-600"}>Ink</span>OS Studio
          </button>
          <nav className="flex gap-1 text-sm text-muted-foreground">
            {([
              { label: t("nav.books"), action: nav.toDashboard, active: route.page === "dashboard" },
              { label: t("nav.newBook"), action: nav.toBookCreate, active: route.page === "book-create" },
              { label: t("nav.config"), action: nav.toConfig, active: route.page === "config" },
            ] as const).map((item) => (
              <button
                key={item.label}
                onClick={item.action}
                className={`px-3 py-2.5 rounded-md transition-colors ${
                  item.active
                    ? "bg-secondary text-foreground"
                    : "hover:bg-secondary/50 hover:text-foreground"
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className="px-3 py-2 rounded-md text-xs font-medium bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          >
            {isDark ? "☀️" : "🌙"}
          </button>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${sse.connected ? "bg-emerald-500" : "bg-zinc-400"}`} />
            {sse.connected ? t("nav.connected") : t("nav.disconnected")}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {route.page === "dashboard" && <Dashboard nav={nav} sse={sse} theme={theme} t={t} />}
        {route.page === "book" && <BookDetail bookId={route.bookId} nav={nav} theme={theme} t={t} />}
        {route.page === "book-create" && <BookCreate nav={nav} theme={theme} t={t} />}
        {route.page === "chapter" && <ChapterReader bookId={route.bookId} chapterNumber={route.chapterNumber} nav={nav} theme={theme} t={t} />}
        {route.page === "analytics" && <Analytics bookId={route.bookId} nav={nav} theme={theme} t={t} />}
        {route.page === "config" && <ConfigView nav={nav} theme={theme} t={t} />}
      </main>
    </div>
  );
}
