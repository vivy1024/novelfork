import { useApi } from "../hooks/use-api";
import { useState } from "react";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";

interface TruthFile {
  readonly name: string;
  readonly size: number;
  readonly preview: string;
}

interface Nav {
  toBook: (id: string) => void;
  toDashboard: () => void;
}

export function TruthFiles({ bookId, nav, theme, t }: { bookId: string; nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data } = useApi<{ files: ReadonlyArray<TruthFile> }>(`/books/${bookId}/truth`);
  const [selected, setSelected] = useState<string | null>(null);
  const { data: fileData } = useApi<{ file: string; content: string | null }>(
    selected ? `/books/${bookId}/truth/${selected}` : "",
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>{t("bread.books")}</button>
        <span className="text-border">/</span>
        <button onClick={() => nav.toBook(bookId)} className={c.link}>{bookId}</button>
        <span className="text-border">/</span>
        <span className="text-foreground">Truth Files</span>
      </div>

      <h1 className="font-serif text-3xl">Truth Files</h1>

      <div className="grid grid-cols-[240px_1fr] gap-6">
        {/* File list */}
        <div className={`border ${c.cardStatic} rounded-lg overflow-hidden`}>
          {data?.files.map((f) => (
            <button
              key={f.name}
              onClick={() => setSelected(f.name)}
              className={`w-full text-left px-3 py-2.5 text-sm border-b border-border/40 transition-colors ${
                selected === f.name
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-muted/30 text-muted-foreground"
              }`}
            >
              <div className="font-mono text-xs truncate">{f.name}</div>
              <div className="text-[11px] text-muted-foreground/60 mt-0.5">{f.size.toLocaleString()} chars</div>
            </button>
          ))}
          {(!data?.files || data.files.length === 0) && (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center">No truth files</div>
          )}
        </div>

        {/* Content viewer */}
        <div className={`border ${c.cardStatic} rounded-lg p-5 min-h-[400px]`}>
          {selected && fileData?.content ? (
            <pre className="text-sm leading-relaxed whitespace-pre-wrap font-mono text-foreground/80">{fileData.content}</pre>
          ) : selected && fileData?.content === null ? (
            <div className="text-muted-foreground text-sm">File not found</div>
          ) : (
            <div className="text-muted-foreground/50 text-sm italic">Select a file to view</div>
          )}
        </div>
      </div>
    </div>
  );
}
