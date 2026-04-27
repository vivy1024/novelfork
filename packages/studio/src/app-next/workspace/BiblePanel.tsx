import { useState } from "react";

import { postApi, useApi } from "../../hooks/use-api";

/* ── types ── */

interface BibleEntry {
  readonly id: string;
  readonly name?: string;
  readonly title?: string;
  readonly content?: string;
  readonly chapterNumber?: number;
}

interface BibleListResponse {
  readonly characters?: readonly BibleEntry[];
  readonly events?: readonly BibleEntry[];
  readonly settings?: readonly BibleEntry[];
  readonly chapterSummaries?: readonly BibleEntry[];
}

type BibleTab = "characters" | "events" | "settings" | "chapter-summaries";

const TAB_META: Record<BibleTab, { label: string; dataKey: keyof BibleListResponse }> = {
  characters: { label: "人物", dataKey: "characters" },
  events: { label: "事件", dataKey: "events" },
  settings: { label: "设定", dataKey: "settings" },
  "chapter-summaries": { label: "摘要", dataKey: "chapterSummaries" },
};

const TABS = Object.keys(TAB_META) as BibleTab[];

/* ── component ── */

export interface BiblePanelProps {
  readonly bookId: string;
  readonly chapterNumber?: number;
}

export function BiblePanel({ bookId, chapterNumber }: BiblePanelProps) {
  const [activeTab, setActiveTab] = useState<BibleTab>("characters");
  const { data, loading, error, refetch } = useApi<BibleListResponse>(
    `/books/${bookId}/bible/${activeTab}`,
  );

  const meta = TAB_META[activeTab];
  const entries = data?.[meta.dataKey] ?? [];
  const filtered =
    activeTab === "chapter-summaries" && chapterNumber !== undefined
      ? entries.filter(
          (e) =>
            e.chapterNumber === undefined || e.chapterNumber === chapterNumber,
        )
      : entries;

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
      <div className="font-medium">经纬资料库</div>

      {/* tab bar */}
      <div className="mt-2 flex flex-wrap gap-1">
        {TABS.map((tab) => (
          <button
            key={tab}
            className={`rounded-lg px-2 py-1 text-xs ${activeTab === tab ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`}
            onClick={() => setActiveTab(tab)}
            type="button"
          >
            {TAB_META[tab].label}
          </button>
        ))}
      </div>

      {/* content */}
      <div className="mt-2">
        {loading && (
          <p className="text-muted-foreground">正在加载{meta.label}…</p>
        )}
        {error && <p className="text-destructive">加载失败：{error}</p>}
        {!loading && !error && filtered.length === 0 && (
          <EmptyState label={meta.label} />
        )}
        {!loading && !error && filtered.length > 0 && (
          <EntryList entries={filtered} />
        )}
      </div>

      {/* inline create form */}
      <CreateForm
        bookId={bookId}
        label={meta.label}
        tab={activeTab}
        onCreated={refetch}
      />
    </div>
  );
}

/* ── sub-components ── */

function EntryList({ entries }: { readonly entries: readonly BibleEntry[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <ul className="space-y-1">
      {entries.map((entry) => {
        const label = entry.name ?? entry.title ?? entry.id;
        const detail = entry.content;
        const isExpanded = expandedId === entry.id;

        return (
          <li key={entry.id}>
            <button
              className="w-full text-left"
              onClick={() => setExpandedId(isExpanded ? null : entry.id)}
              type="button"
            >
              <span className="font-medium">{label}</span>
              {detail && !isExpanded && (
                <span className="ml-1 text-muted-foreground">
                  {detail.length > 30 ? `${detail.slice(0, 30)}…` : detail}
                </span>
              )}
            </button>
            {isExpanded && detail && (
              <p className="mt-0.5 pl-2 text-muted-foreground">{detail}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function EmptyState({ label }: { readonly label: string }) {
  return (
    <p className="text-muted-foreground">
      暂无{label}，在下方创建
    </p>
  );
}

function CreateForm({
  bookId,
  label,
  tab,
  onCreated,
}: {
  readonly bookId: string;
  readonly label: string;
  readonly tab: BibleTab;
  readonly onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setContent("");
    setSubmitError(null);
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await postApi(`/books/${bookId}/bible/${tab}`, {
        name: name.trim(),
        content: content.trim() || undefined,
      });
      reset();
      setOpen(false);
      onCreated();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        className="mt-2 w-full rounded-lg border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
        onClick={() => setOpen(true)}
        type="button"
      >
        + 新建{label}
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-border p-2">
      <input
        aria-label={`${label}名称`}
        className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
        onChange={(e) => setName(e.target.value)}
        placeholder="名称"
        value={name}
      />
      <textarea
        aria-label={`${label}内容`}
        className="w-full resize-none rounded border border-border bg-background px-2 py-1 text-xs"
        onChange={(e) => setContent(e.target.value)}
        placeholder="内容（可选）"
        rows={2}
        value={content}
      />
      {submitError && (
        <p className="text-xs text-destructive">创建失败：{submitError}</p>
      )}
      <div className="flex gap-1">
        <button
          className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
          disabled={submitting || !name.trim()}
          onClick={() => void handleSubmit()}
          type="button"
        >
          {submitting ? "创建中…" : "创建"}
        </button>
        <button
          className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          type="button"
        >
          取消
        </button>
      </div>
    </div>
  );
}
