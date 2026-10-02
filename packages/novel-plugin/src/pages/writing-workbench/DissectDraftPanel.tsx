/**
 * 拆书草案（dissection_staging）确认面板——T4.2「全书综合发布」侧。
 *
 * 拆书运行时，模型/规则从原文抽出的每份角色、地点、势力、伏笔都先落在 staging 区，
 * 作者决定哪些 promote（写入正式经纬条目参与写作）或 reject（废弃，不进谁也看不见）。
 * 面板只做三件事：
 *   1. 列待审草案（kind 过滤：角色/地点/势力/伏笔/世界/其他）
 *   2. 显示抽取理由与来源章，帮助判断是否可信
 *   3. promote / reject 单条——走 jingwei/staging/:id/decision 的正式通道（不自己写表）
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Sprout, Trash2, X } from "lucide-react";

import { fetchJson } from "@/hooks/use-api";

interface DissectDraftItem {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly category: string;
  readonly reason: string;
  readonly sourceRefs: readonly { readonly chapterNumber?: number; readonly evidence?: string }[];
  readonly confidence: number;
  readonly createdAt: number;
}

interface DissectDraftListResponse {
  readonly ok: boolean;
  readonly count: number;
  readonly items: readonly DissectDraftItem[];
}

export interface DissectDraftPanelProps {
  readonly bookId: string;
  /** 关闭面板（内嵌侧栏时显示「收起」）。 */
  readonly onClose?: () => void;
  /** 决定一条后接口成 promote 的条目：宿主可以做刷新。 */
  readonly onChanged?: () => void;
}

const KIND_LABELS: Record<string, string> = {
  character: "角色",
  location: "地点",
  faction: "势力",
  foreshadow: "伏笔",
  world: "世界",
  other: "其他",
};

export function DissectDraftPanel({ bookId, onClose, onChanged }: DissectDraftPanelProps) {
  const [items, setItems] = useState<readonly DissectDraftItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await fetchJson<DissectDraftListResponse>(
        `/api/books/${encodeURIComponent(bookId)}/jingwei/staging?limit=300`,
      );
      setItems(data.items ?? []);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "读取拆书草案失败");
      setItems(null);
    } finally {
      setBusy(false);
    }
  }, [bookId]);

  useEffect(() => {
    void load();
  }, [load]);

  const kinds = useMemo(() => {
    const set = new Set((items ?? []).map((item) => item.kind));
    return [...set];
  }, [items]);

  const shown = useMemo(() => {
    const list = items ?? [];
    return kindFilter ? list.filter((item) => item.kind === kindFilter) : list;
  }, [items, kindFilter]);

  const decide = useCallback(async (item: DissectDraftItem, decision: "promote" | "reject") => {
    setBusyId(item.id);
    setNote(null);
    try {
      await fetchJson(`/api/books/${encodeURIComponent(bookId)}/jingwei/staging/${encodeURIComponent(item.id)}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stagingDecision: decision }),
      });
      setItems((current) => current ? current.filter((existing) => existing.id !== item.id) : current);
      setNote({
        tone: "ok",
        text: decision === "promote" ? `「${item.title}」已写入正式条目。` : `「${item.title}」已废弃，不进入正文。`,
      });
      onChanged?.();
    } catch (err) {
      setNote({ tone: "error", text: err instanceof Error && err.message ? err.message : "处理失败" });
    } finally {
      setBusyId(null);
    }
  }, [bookId, onChanged]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center" data-testid="dissect-draft-panel">
        <p className="text-xs text-destructive">{error}</p>
        <button
          type="button"
          className="text-2xs text-muted-foreground hover:text-foreground"
          onClick={() => void load()}
          data-testid="dissect-draft-retry"
        >
          再试一次
        </button>
      </div>
    );
  }

  if (!items) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground" data-testid="dissect-draft-panel">
        <Loader2 className="size-4 animate-spin" /> 正在读取拆书草案…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-2" data-testid="dissect-draft-panel">
      <div className="flex items-center justify-between">
        <span className="text-2xs font-semibold text-foreground">
          拆书草案（{items.length}）：确认后才进设定
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="text-2xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            onClick={() => void load()}
            disabled={busy}
            data-testid="dissect-draft-reload"
          >
            <RefreshCw className={`inline size-3 ${busy ? "animate-spin" : ""}`} />
          </button>
          {onClose ? (
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={onClose}
              data-testid="dissect-draft-close"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      <p className="text-2xs leading-relaxed text-muted-foreground">
        拆书时会从原文抽出角色、地点、势力、伏笔候选。确认（promote）后写入正式设定，参与写作注入；驳回（reject）后废弃。这本没有处理完的草案不会进入正文。
      </p>
      {note ? (
        <p
          className={`text-2xs ${note.tone === "ok" ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}`}
          role="status"
          data-testid="dissect-draft-note"
        >
          {note.text}
        </p>
      ) : null}
      {kinds.length > 1 ? (
        <div className="flex flex-wrap gap-1" data-testid="dissect-draft-kinds">
          <button
            type="button"
            className={`rounded px-1.5 py-0.5 text-2xs ${kindFilter === null ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
            onClick={() => setKindFilter(null)}
          >
            全部
          </button>
          {kinds.map((kind) => (
            <button
              key={kind}
              type="button"
              className={`rounded px-1.5 py-0.5 text-2xs ${kindFilter === kind ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
              onClick={() => setKindFilter(kind)}
            >
              {KIND_LABELS[kind] ?? kind}
            </button>
          ))}
        </div>
      ) : null}
      {shown.length === 0 ? (
        <p className="mt-4 text-center text-2xs text-muted-foreground" data-testid="dissect-draft-empty">
          没有待确认的拆书草案。导入旧稿并跑过拆书后，这里会列出抽出的角色、地点、伏笔候选。
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5" data-testid="dissect-draft-list">
          {shown.map((item) => (
            <li key={item.id} className="rounded border border-border/60 bg-card/40 px-2 py-1.5 text-2xs" data-testid={`dissect-draft-item-${item.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-foreground">
                    {item.title}
                    <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-2xs text-muted-foreground">{KIND_LABELS[item.kind] ?? item.kind}</span>
                  </div>
                  <div className="mt-0.5 text-muted-foreground">{item.reason}</div>
                  {item.sourceRefs.length > 0 && item.sourceRefs[0]?.chapterNumber ? (
                    <div className="mt-0.5 text-muted-foreground/80">来源：第 {item.sourceRefs[0].chapterNumber} 章</div>
                  ) : null}
                  <div className="mt-0.5 text-muted-foreground/70">置信度 {item.confidence}</div>
                </div>
              </div>
              <div className="mt-1.5 flex justify-end gap-1.5">
                <button
                  type="button"
                  className="rounded border border-border px-1.5 py-0.5 text-2xs hover:bg-accent disabled:opacity-50"
                  disabled={busyId === item.id}
                  onClick={() => void decide(item, "reject")}
                  data-testid={`dissect-draft-reject-${item.id}`}
                >
                  {busyId === item.id ? <Loader2 className="inline size-3 animate-spin" /> : <Trash2 className="inline size-3" />} 驳回
                </button>
                <button
                  type="button"
                  className="rounded bg-primary px-1.5 py-0.5 text-2xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  disabled={busyId === item.id}
                  onClick={() => void decide(item, "promote")}
                  data-testid={`dissect-draft-promote-${item.id}`}
                >
                  {busyId === item.id ? <Loader2 className="inline size-3 animate-spin" /> : <Sprout className="inline size-3" />} 确认
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
