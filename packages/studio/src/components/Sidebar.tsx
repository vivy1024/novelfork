import { useApi } from "../hooks/use-api";
import type { TFunction } from "../hooks/use-i18n";

interface BookSummary {
  readonly id: string;
  readonly title: string;
  readonly genre: string;
  readonly status: string;
  readonly chaptersWritten: number;
}

interface Nav {
  toDashboard: () => void;
  toBook: (id: string) => void;
  toBookCreate: () => void;
  toConfig: () => void;
  toDaemon: () => void;
  toLogs: () => void;
}

export function Sidebar({ nav, activePage, t }: {
  nav: Nav;
  activePage: string;
  t: TFunction;
}) {
  const { data } = useApi<{ books: ReadonlyArray<BookSummary> }>("/books");
  const { data: daemon } = useApi<{ running: boolean }>("/daemon");

  return (
    <aside className="w-[240px] shrink-0 border-r border-border bg-card/40 flex flex-col h-full overflow-y-auto">
      {/* Logo — generous vertical breathing room */}
      <div className="px-6 pt-7 pb-6">
        <button onClick={nav.toDashboard} className="flex items-baseline gap-0.5 hover:opacity-70 transition-opacity">
          <span className="font-serif text-2xl italic text-primary">Ink</span>
          <span className="text-lg font-semibold tracking-tight">OS</span>
        </button>
      </div>

      {/* Books section */}
      <div className="flex-1 px-4">
        <div className="px-2 mb-3 flex items-center justify-between">
          <span className="text-sm uppercase tracking-wide text-muted-foreground font-medium">{t("nav.books")}</span>
          <button
            onClick={nav.toBookCreate}
            className="w-6 h-6 flex items-center justify-center rounded text-sm text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
          >
            +
          </button>
        </div>

        <div className="space-y-1">
          {data?.books.map((book) => (
            <button
              key={book.id}
              onClick={() => nav.toBook(book.id)}
              className={`w-full text-left px-3 py-2.5 rounded-md text-base truncate transition-all duration-150 ${
                activePage === `book:${book.id}`
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-foreground/80 hover:text-foreground hover:bg-muted/40"
              }`}
            >
              {book.title}
            </button>
          ))}

          {(!data?.books || data.books.length === 0) && (
            <div className="px-3 py-4 text-xs text-muted-foreground/50 italic leading-relaxed">
              {t("dash.noBooks")}
            </div>
          )}
        </div>
      </div>

      {/* System nav — generous spacing from book list */}
      <div className="border-t border-border mt-4 pt-4 pb-5 px-4 space-y-1">
        <SidebarItem
          label={t("nav.config")}
          icon="⚙"
          active={activePage === "config"}
          onClick={nav.toConfig}
        />
        <SidebarItem
          label="Daemon"
          icon="⟳"
          active={activePage === "daemon"}
          onClick={nav.toDaemon}
          badge={daemon?.running ? "●" : undefined}
          badgeColor={daemon?.running ? "text-emerald-500" : undefined}
        />
        <SidebarItem
          label="Logs"
          icon="☰"
          active={activePage === "logs"}
          onClick={nav.toLogs}
        />
      </div>
    </aside>
  );
}

function SidebarItem({ label, icon, active, onClick, badge, badgeColor }: {
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
  badge?: string;
  badgeColor?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 rounded-md text-base flex items-center gap-2.5 transition-all duration-150 ${
        active
          ? "bg-secondary text-foreground font-medium"
          : "text-foreground/70 hover:text-foreground hover:bg-muted/40"
      }`}
    >
      <span className="text-sm w-4 text-center opacity-60">{icon}</span>
      <span className="flex-1">{label}</span>
      {badge && <span className={`text-xs ${badgeColor ?? ""}`}>{badge}</span>}
    </button>
  );
}
