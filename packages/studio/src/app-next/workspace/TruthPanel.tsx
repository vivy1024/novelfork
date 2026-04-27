import { useState } from "react";
import { fetchJson, useApi } from "../../hooks/use-api";
import { InlineError } from "../components/feedback";

interface TruthFile {
  readonly name: string;
  readonly size: number;
  readonly preview: string;
}

export function TruthPanel({ bookId }: { readonly bookId: string }) {
  const { data, loading, error: listError, refetch } = useApi<{ files: ReadonlyArray<TruthFile> }>(`/books/${bookId}/truth`);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);

  const loadFile = async (name: string) => {
    setSelected(name);
    setLoadingContent(true);
    setContentError(null);
    try {
      const res = await fetchJson<{ content: string | null }>(`/books/${bookId}/truth/${encodeURIComponent(name)}`);
      setContent(res.content ?? "（空文件）");
    } catch (e) {
      setContentError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingContent(false);
    }
  };

  const files = data?.files ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <h2 className="text-xl font-semibold">真相文件</h2>
        <span className="text-xs text-muted-foreground">{files.length} 个文件</span>
      </div>

      {listError && <InlineError message={listError} onRetry={refetch} />}
      {loading && <p className="text-sm text-muted-foreground">加载中…</p>}

      <div className="grid gap-3 grid-cols-[12rem_1fr] lg:grid-cols-[200px_1fr]">
        <div className="space-y-1">
          {files.map((f) => (
            <button
              key={f.name}
              className={`w-full rounded-lg px-2 py-1.5 text-left text-sm transition ${selected === f.name ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              onClick={() => void loadFile(f.name)}
              type="button"
            >
              <div className="truncate">{f.name}</div>
              <div className="text-[10px] opacity-70">{f.size} 字</div>
            </button>
          ))}
          {!loading && files.length === 0 && <p className="text-xs text-muted-foreground">暂无真相文件</p>}
        </div>

        <div className="rounded-lg border border-border p-3">
          {!selected && <p className="text-sm text-muted-foreground">点击左侧文件查看内容</p>}
          {loadingContent && <p className="text-sm text-muted-foreground">加载中…</p>}
          {contentError && <InlineError message={contentError} />}
          {selected && content != null && !loadingContent && !contentError && (
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap text-sm leading-relaxed">{content}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
