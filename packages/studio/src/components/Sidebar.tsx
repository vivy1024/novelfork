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
    <aside className="w-[200px] shrink-0 border-r border-border/40 bg-card/50 flex flex-col h-full overflow-y-auto">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-border/30">
        <button onClick={nav.toDashboard} className="flex items-baseline gap-0.5 hover:opacity-80 transition-opacity">
          <span className="font-serif text-xl italic text-primary">Ink</span>
          <span className="text-base font-semibold tracking-tight">OS</span>
        </button>
      </div>

      {/* Books section */}
      <div className="flex-1 py-3">
        <div className="px-4 mb-2 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground/50">{t("nav.books")}</span>
          <button
            onClick={nav.toBookCreate}
            className="text-[10px] text-primary/60 hover:text-primary transition-colors"
          >
            +
          </button>
        </div>

        <div className="space-y-0.5 px-2">
          {data?.books.map((book) => (
            <button
              key={book.id}
              onClick={() => nav.toBook(book.id)}
              className={`w-full text-left px-2 py-1.5 rounded text-[13px] truncate transition-colors ${
                activePage === `book:${book.id}`
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
              }`}
            >
              {book.title}
            </button>
          ))}

          {(!data?.books || data.books.length === 0) && (
            <div className="px-2 py-3 text-[11px] text-muted-foreground/40 italic">
              {t("dash.noBooks")}
            </div>
          )}
        </div>
      </div>

      {/* System nav */}
      <div className="border-t border-border/30 py-3 px-2 space-y-0.5">
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
      className={`w-full text-left px-2 py-1.5 rounded text-[13px] flex items-center gap-2 transition-colors ${
        active
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
      }`}
    >
      <span className="text-xs w-4 text-center opacity-50">{icon}</span>
      <span className="flex-1">{label}</span>
      {badge && <span className={`text-[10px] ${badgeColor ?? ""}`}>{badge}</span>}
    </button>
  );
}
