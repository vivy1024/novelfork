/**
 * 「待确认」聚合面板。
 *
 * 有六类「需要作者确认才生效」的产物散在各处：角色声线、文风蒸馏规则、
 * 伏笔草稿、本章提议、事实/关系草案、文风金库未采纳改稿段。本面板把它们
 * 聚成一个只读列表（数据来自 GET /api/books/:bookId/pending-review，
 * 该接口从各权威源实时派生，不新建表）。
 *
 * 每行的动作不是就地审批——不同对象的审批通道不一样。每行一个「去处理」
 * 按钮，跳到原有的确认入口；跳转回调由宿主注入（onOpenJingweiEntry、
 * onOpenDistill、onOpenEvents、onOpenVault 等），宿主给不了回调的入口
 * 只展示「去哪决定」而不伪造按钮。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, ClipboardList, Loader2, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/hooks/use-api";
import {
  PENDING_REVIEW_KINDS,
  PENDING_REVIEW_LABELS,
  type PendingReviewItem,
  type PendingReviewKind,
  type PendingReviewSummary,
  type PendingReviewTarget,
} from "../../routes/pending-review-contract.js";

export type PendingReviewFetcher = (bookId: string) => Promise<PendingReviewSummary>;
export type PendingReviewStorylineReviewer = (storylineId: string, decision: "confirmed" | "rejected") => Promise<void>;

async function fetchPendingReviewSummary(bookId: string): Promise<PendingReviewSummary> {
  return fetchJson<PendingReviewSummary>(`/api/books/${encodeURIComponent(bookId)}/pending-review`);
}

async function defaultReviewStoryline(bookId: string, storylineId: string, decision: "confirmed" | "rejected"): Promise<void> {
  await fetchJson(
    `/api/books/${encodeURIComponent(bookId)}/narrative-memory/storylines/${encodeURIComponent(storylineId)}/review`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }) },
  );
}

export interface PendingReviewPanelProps {
  bookId: string;
  /** 测试或宿主替换取数通道；默认走产品 HTTP。 */
  fetchSummary?: PendingReviewFetcher;
  /** 测试或宿主替换剧情线审核通道；默认走产品 HTTP。 */
  reviewStorylineFn?: PendingReviewStorylineReviewer;
  /** 打开经纬条目（角色卡对声线确认、伏笔草稿对条目确认都在条目上）。 */
  onOpenJingweiEntry?: (entryId: string) => void;
  /** 声线确认专用入口；缺省回落到 onOpenJingweiEntry。 */
  onOpenVoiceReview?: (entryId: string) => void;
  /** 文风自动蒸馏工作面（规则逐条审阅）；缺省回落到 onOpenStylePanel。 */
  onOpenDistill?: () => void;
  /** 「技能文风」面板的文风页签。 */
  onOpenStylePanel?: () => void;
  /** 章后事实待审队列（本章提议、事实与关系草案）。 */
  onOpenEvents?: () => void;
  /** 文风金库（采纳改稿段为范文）；缺省回落到 onOpenChapter。 */
  onOpenVault?: () => void;
  /** 打开指定章节。 */
  onOpenChapter?: (chapterNumber: number) => void;
  /** 嵌入侧栏时的关闭按钮。 */
  onClose?: () => void;
}

interface ResolveAction {
  readonly label: string;
  readonly run?: () => void;
}

/** 每行的「去处理」：宿主给哪个回调就走哪个入口；给不了的手持说明，不伪造可点。 */
function resolveAction(item: PendingReviewItem, props: PendingReviewPanelProps): ResolveAction {
  const hint = (handler?: () => void): ResolveAction => handler
    ? { label: "去处理", run: handler }
    : { label: item.resolveAt };
  const target: PendingReviewTarget = item.target;
  switch (target.kind) {
    case "jingwei-entry": {
      const open = item.kind === "voice" && props.onOpenVoiceReview
        ? () => props.onOpenVoiceReview?.(target.entryId)
        : props.onOpenJingweiEntry
          ? () => props.onOpenJingweiEntry?.(target.entryId)
          : undefined;
      return hint(open);
    }
    case "style-panel": {
      const open = props.onOpenDistill ?? props.onOpenStylePanel;
      return hint(open);
    }
    case "events":
      return hint(props.onOpenEvents);
    case "vault": {
      const open = props.onOpenVault
        ? props.onOpenVault
        : props.onOpenChapter
          ? () => props.onOpenChapter?.(target.chapterNumber)
          : undefined;
      return hint(open);
    }
    default:
      return { label: item.resolveAt };
  }
}

function PendingReviewRow({
  item,
  panelProps,
  onReviewStoryline,
  busy,
}: {
  item: PendingReviewItem;
  panelProps: PendingReviewPanelProps;
  onReviewStoryline: (storylineId: string, decision: "confirmed" | "rejected") => void;
  busy: boolean;
}) {
  if (item.target.kind === "storyline") {
    return (
      <li className="flex items-start gap-1.5 rounded-md border border-border/70 bg-card/60 px-2 py-1.5">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant="secondary" className="text-2xs">{item.typeLabel}</Badge>
            <span className="text-2xs text-muted-foreground">{item.location}</span>
          </div>
          <p className="break-words text-2xs leading-relaxed text-foreground">{item.summary}</p>
        </div>
        <div className="mt-0.5 flex shrink-0 gap-1">
          <Button
            size="xs"
            variant="outline"
            className="text-2xs"
            disabled={busy}
            onClick={() => onReviewStoryline((item.target as { storylineId: string }).storylineId, "confirmed")}
          >
            确认
          </Button>
          <Button
            size="xs"
            variant="ghost"
            className="text-2xs"
            disabled={busy}
            onClick={() => onReviewStoryline((item.target as { storylineId: string }).storylineId, "rejected")}
          >
            驳回
          </Button>
        </div>
      </li>
    );
  }
  const action = resolveAction(item, panelProps);
  return (
    <li className="flex items-start gap-1.5 rounded-md border border-border/70 bg-card/60 px-2 py-1.5">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant="secondary" className="text-2xs">{item.typeLabel}</Badge>
          <span className="text-2xs text-muted-foreground">{item.location}</span>
        </div>
        <p className="break-words text-2xs leading-relaxed text-foreground">{item.summary}</p>
        <p className="text-2xs text-muted-foreground">去哪决定：{item.resolveAt}</p>
      </div>
      {action.run ? (
        <Button size="xs" variant="outline" className="mt-0.5 shrink-0 gap-0.5 text-2xs" onClick={action.run}>
          {action.label}
          <ArrowRight className="size-3" />
        </Button>
      ) : (
        <span className="mt-0.5 shrink-0 text-2xs text-muted-foreground" title="这个入口在当前面板里打不开">
          {action.label}
        </span>
      )}
    </li>
  );
}

export function PendingReviewPanel(props: PendingReviewPanelProps) {
  const { bookId, onClose } = props;
  const fetchSummary = props.fetchSummary ?? fetchPendingReviewSummary;
  const [data, setData] = useState<PendingReviewSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const requestSeq = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestSeq.current += 1; };
  }, []);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const summary = await fetchSummary(bookId);
      if (mounted.current && seq === requestSeq.current) setData(summary);
    } catch (cause) {
      if (mounted.current && seq === requestSeq.current) {
        setError(cause instanceof Error ? cause.message : "读取待确认列表失败");
      }
    } finally {
      if (mounted.current && seq === requestSeq.current) setLoading(false);
    }
  }, [bookId, fetchSummary]);

  useEffect(() => { void load(); }, [load]);

  // 剧情线草稿没有专属宿主页：就地确认/驳回，走叙事记忆的 review 接口。
  const [reviewBusy, setReviewBusy] = useState(false);
  const reviewFn = props.reviewStorylineFn;
  const reviewStoryline = useCallback(async (storylineId: string, decision: "confirmed" | "rejected") => {
    if (reviewBusy) return;
    setReviewBusy(true);
    setError(null);
    try {
      if (reviewFn) await reviewFn(storylineId, decision);
      else await defaultReviewStoryline(bookId, storylineId, decision);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "剧情线审核失败");
    } finally {
      setReviewBusy(false);
    }
  }, [bookId, load, reviewBusy, reviewFn]);

  // 预设保存/采纳后倒计数刷新，作者刚确认完的项应立刻从列表消失。
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ bookId?: string }>).detail;
      if (!detail?.bookId || detail.bookId === bookId) void load();
    };
    window.addEventListener("novelfork:style-preset-updated", handler);
    return () => window.removeEventListener("novelfork:style-preset-updated", handler);
  }, [bookId, load]);

  const groups = useMemo(
    () => (data ? PENDING_REVIEW_KINDS
      .map((kind) => data.groups.find((group) => group.kind === kind))
      .filter((group): group is NonNullable<typeof group> => Boolean(group))
    : []),
    [data],
  );
  const total = data?.total ?? 0;

  return (
    <section className="flex h-full flex-col overflow-hidden text-xs" aria-label="待确认聚合面板">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5 font-medium">
          <ClipboardList className="size-3.5 shrink-0 text-primary" />
          <span className="truncate">待确认{data ? ` ${total} 项` : ""}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="xs" onClick={() => void load()} disabled={loading} aria-label="刷新待确认列表">
            <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
          </Button>
          {onClose && (
            <Button variant="ghost" size="xs" className="text-2xs" onClick={onClose}>收起</Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2">
        {error && (
          <p role="alert" className="rounded border border-destructive/30 bg-destructive/5 p-2 text-2xs text-destructive">{error}</p>
        )}

        {loading && !data && (
          <p className="flex items-center gap-1.5 text-2xs text-muted-foreground" role="status">
            <Loader2 className="size-3 animate-spin" />
            正在汇总六类待确认来源…
          </p>
        )}

        {data && total === 0 && (
          <div className="space-y-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2">
            <p className="flex items-center gap-1 text-2xs font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="size-3.5" />
              全部确认完
            </p>
            <p className="text-2xs leading-relaxed text-muted-foreground">{data.explanation}</p>
          </div>
        )}

        {data && data.warnings.length > 0 && (
          <div className="space-y-0.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
            {data.warnings.map((warning, index) => (
              <p key={`${warning.code}-${index}`} className="text-2xs leading-relaxed text-amber-700 dark:text-amber-400">
                {warning.message}
              </p>
            ))}
          </div>
        )}

        {groups.map((group) => group.count === 0 ? null : (
          <div key={group.kind} className="space-y-1">
            <div className="flex items-center justify-between px-0.5">
              <span className="text-2xs font-medium text-muted-foreground">{PENDING_REVIEW_LABELS[group.kind]}</span>
              <Badge variant="outline" className="text-2xs">
                {group.items.length < group.count ? `${group.items.length}/${group.count}` : group.count}
              </Badge>
            </div>
            <ul className="space-y-1">
              {group.items.map((item) => (
                <PendingReviewRow
                  key={item.id}
                  item={item}
                  panelProps={props}
                  onReviewStoryline={reviewStoryline}
                  busy={reviewBusy}
                />
              ))}
            </ul>
          </div>
        ))}

        {data && total > 0 && (
          <p className="px-0.5 text-2xs leading-relaxed text-muted-foreground">{data.explanation}</p>
        )}
      </div>
    </section>
  );
}

export type { PendingReviewItem, PendingReviewKind, PendingReviewSummary, PendingReviewTarget };
