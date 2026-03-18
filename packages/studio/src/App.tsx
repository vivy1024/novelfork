import { useState } from "react";
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
    <div className={`min-h-screen ${isDark ? "bg-zinc-950 text-zinc-100" : "bg-zinc-50 text-zinc-900"}`}>
      <header className={`sticky top-0 z-10 backdrop-blur-sm border-b px-6 py-3 flex items-center justify-between ${
        isDark ? "bg-zinc-950/80 border-zinc-800" : "bg-white/80 border-zinc-200"
      }`}>
        <div className="flex items-center gap-6">
          <button
            onClick={nav.toDashboard}
            className="text-lg font-bold tracking-tight hover:opacity-80 transition-opacity"
          >
            <span className={isDark ? "text-blue-400" : "text-blue-600"}>Ink</span>OS Studio
          </button>
          <nav className={`flex gap-1 text-sm ${isDark ? "text-zinc-400" : "text-zinc-500"}`}>
            {([
              { label: t("nav.books"), action: nav.toDashboard, active: route.page === "dashboard" },
              { label: t("nav.newBook"), action: nav.toBookCreate, active: route.page === "book-create" },
              { label: t("nav.config"), action: nav.toConfig, active: route.page === "config" },
            ] as const).map((item) => (
              <button
                key={item.label}
                onClick={item.action}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  item.active
                    ? isDark ? "bg-zinc-800 text-zinc-100" : "bg-zinc-100 text-zinc-900"
                    : isDark ? "hover:bg-zinc-800/50 hover:text-zinc-200" : "hover:bg-zinc-100 hover:text-zinc-700"
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
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              isDark ? "bg-zinc-800 text-zinc-400 hover:text-zinc-200" : "bg-zinc-100 text-zinc-500 hover:text-zinc-700"
            }`}
          >
            {isDark ? "☀️" : "🌙"}
          </button>
          <div className={`flex items-center gap-1.5 text-xs ${isDark ? "text-zinc-500" : "text-zinc-400"}`}>
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
