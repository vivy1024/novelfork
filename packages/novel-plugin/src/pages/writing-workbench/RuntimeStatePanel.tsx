/**
 * RuntimeStatePanel — 运行时状态展示面板
 *
 * 展示 3 个 tab：知识边界、时间线、资源账本
 */
import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type TabId = "knowledge" | "timeline" | "resources";

interface KnowledgeEvent {
  characterId: string;
  fact: string;
  learnedAtChapter: number;
  source?: string;
}

interface TimelineEntry {
  chapter: number;
  storyTime?: string;
  label?: string;
  durationFromPrev?: string;
  ordinal?: number;
}

interface ResourceEntry {
  resourceId: string;
  name: string;
  balance: number;
  lastChapter: number;
}

interface RuntimeState {
  knowledge?: { events: KnowledgeEvent[] };
  timeline?: { entries: TimelineEntry[] };
  resourceLedger?: { resources: ResourceEntry[] };
}

export interface RuntimeStatePanelProps {
  bookId: string;
}

const TABS: { id: TabId; label: string }[] = [
  { id: "knowledge", label: "知识边界" },
  { id: "timeline", label: "时间线" },
  { id: "resources", label: "资源账本" },
];

export function RuntimeStatePanel({ bookId }: RuntimeStatePanelProps) {
  const [tab, setTab] = useState<TabId>("knowledge");
  const [data, setData] = useState<RuntimeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/books/${encodeURIComponent(bookId)}/state`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<RuntimeState>;
      })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "加载失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bookId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return <p className="text-xs text-destructive p-2">{error}</p>;
  }

  const hasData =
    (data?.knowledge?.events?.length ?? 0) > 0 ||
    (data?.timeline?.entries?.length ?? 0) > 0 ||
    (data?.resourceLedger?.resources?.length ?? 0) > 0;

  if (!hasData) {
    return (
      <p className="text-xs text-muted-foreground p-2">
        尚无运行时状态数据（开始写作后自动生成）
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border pb-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "px-2 py-1 text-xs rounded-t transition-colors",
              tab === t.id
                ? "bg-muted text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "knowledge" && <KnowledgeTab events={data?.knowledge?.events ?? []} />}
      {tab === "timeline" && <TimelineTab entries={data?.timeline?.entries ?? []} />}
      {tab === "resources" && <ResourcesTab resources={data?.resourceLedger?.resources ?? []} />}
    </div>
  );
}

function KnowledgeTab({ events }: { events: KnowledgeEvent[] }) {
  if (events.length === 0) return <Empty label="暂无知识边界数据" />;
  return (
    <div className="space-y-1 max-h-64 overflow-y-auto">
      {events.map((ev, i) => (
        <div key={i} className="flex items-start gap-2 text-xs p-1.5 rounded hover:bg-muted/50">
          <span className="shrink-0 font-medium text-primary">{ev.characterId}</span>
          <span className="flex-1 text-muted-foreground">{ev.fact}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">第{ev.learnedAtChapter}章</span>
        </div>
      ))}
    </div>
  );
}

function TimelineTab({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) return <Empty label="暂无时间线数据" />;
  return (
    <div className="space-y-1 max-h-64 overflow-y-auto">
      {entries.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 text-xs p-1.5 rounded hover:bg-muted/50">
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">#{entry.chapter}</span>
          <span className="flex-1">{entry.label || entry.storyTime || "—"}</span>
          {entry.ordinal != null && (
            <span className="shrink-0 text-[10px] text-muted-foreground">序:{entry.ordinal}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function ResourcesTab({ resources }: { resources: ResourceEntry[] }) {
  if (resources.length === 0) return <Empty label="暂无资源账本数据" />;
  return (
    <div className="space-y-1 max-h-64 overflow-y-auto">
      {resources.map((r) => (
        <div key={r.resourceId} className="flex items-center gap-2 text-xs p-1.5 rounded hover:bg-muted/50">
          <span className="flex-1 font-medium">{r.name || r.resourceId}</span>
          <span className={cn("font-mono", r.balance >= 0 ? "text-green-600" : "text-red-500")}>
            {r.balance >= 0 ? "+" : ""}{r.balance}
          </span>
        </div>
      ))}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="text-xs text-muted-foreground py-4 text-center">{label}</p>;
}
