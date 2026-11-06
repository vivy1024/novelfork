/**
 * 故事时间轴（故事推进 › 时间线 › 故事时间）：
 *  - 顶部：当前故事时间与一句总述；
 *  - 可能的时间矛盾（倒流 / 同一时间两地 / 年龄对不上）：只提示，转述后端 explanation，不自动改；
 *  - 约定时间（「三日后决战」）：还有几天 / 已过几天；
 *  - 时间点列表：按章排列，每条带原文和推算过程。
 *
 * 状态一律「文字标签 + 色点」，不用彩色色块；取不到数据给空态，不补假数据。
 */

import { AlertCircle, Clock, Loader2 } from "lucide-react";

import { useStoryTimeline, type StoryTimePromiseView } from "./use-story-timeline";

export interface StoryTimeAxisPanelProps {
  readonly bookId: string;
}

function promiseWhen(promise: StoryTimePromiseView): string {
  if (promise.daysLeft > 0) return `还有 ${promise.daysLeft} 日`;
  if (promise.daysLeft === 0) return "就是今天";
  return `已过 ${-promise.daysLeft} 日`;
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return "可信";
  if (confidence >= 0.5) return "大致";
  return "存疑";
}

export function StoryTimeAxisPanel({ bookId }: StoryTimeAxisPanelProps) {
  const { state, reload } = useStoryTimeline(bookId);

  if (state.status === "loading") {
    return (
      <div className="flex h-full min-h-24 items-center justify-center gap-2 text-2xs text-muted-foreground" data-testid="story-time-panel">
        <Loader2 className="size-3.5 animate-spin" /> 正在读取故事时间…
      </div>
    );
  }

  if (state.status === "error" || (state.data.points.length === 0 && state.data.promises.length === 0)) {
    return (
      <div className="flex h-full min-h-24 flex-col items-center justify-center gap-1.5 px-4 text-center" data-testid="story-time-empty">
        <AlertCircle className="size-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          {state.status === "ready"
            ? "还没有记下故事里的时间。结算章节时会从正文读出「三天后」「天元三年春」这类说法，按章排成时间轴。"
            : `故事时间暂时没读通（${state.message}）。`}
        </p>
        {state.status === "error" ? (
          <button type="button" className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground" onClick={reload} data-testid="story-time-retry">
            重试
          </button>
        ) : null}
      </div>
    );
  }

  const data = state.data;
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto px-1" data-testid="story-time-panel">
      <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
        <Clock className="size-3.5" />
        <span className="font-medium text-foreground" data-testid="story-time-current">
          {data.currentLabel ? `现在是${data.currentLabel}` : "还没定下当前时间"}
        </span>
        {data.currentChapter !== undefined ? <span>（截至第 {data.currentChapter} 章）</span> : null}
      </div>
      {data.summary ? <p className="text-2xs text-muted-foreground">{data.summary}</p> : null}

      {data.conflicts.length > 0 ? (
        <section aria-label="时间上可能的矛盾" className="flex flex-col gap-1" data-testid="story-time-conflicts">
          <h4 className="text-2xs font-medium text-foreground">时间上可能的矛盾（{data.conflicts.length}）</h4>
          <ul className="flex flex-col gap-1">
            {data.conflicts.map((conflict, index) => (
              <li key={`${conflict.kind}-${conflict.chapterNumber}-${conflict.entity}-${index}`} className="rounded border border-border/60 px-2 py-1 text-xs" data-testid="story-time-conflict">
                <div className="flex items-center gap-1.5">
                  <span className="size-1.5 shrink-0 rounded-full bg-warning" />
                  <span className="font-medium">{conflict.title}</span>
                  <span className="text-2xs text-muted-foreground">待你确认</span>
                </div>
                <p className="mt-0.5 text-muted-foreground">{conflict.explanation.whatHappened}</p>
                <p className="text-muted-foreground">{conflict.explanation.whyItMatters}</p>
                <p className="text-foreground">{conflict.explanation.suggestedAction}</p>
                {conflict.evidenceText ? <p className="mt-0.5 text-2xs text-muted-foreground">原文：{conflict.evidenceText}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.promises.length > 0 ? (
        <section aria-label="约定的时间" className="flex flex-col gap-1" data-testid="story-time-promises">
          <h4 className="text-2xs font-medium text-foreground">约定的时间</h4>
          <ul className="flex flex-col gap-0.5">
            {data.promises.map((promise) => (
              <li key={promise.anchorId} className="flex flex-wrap items-baseline gap-x-2 text-xs" data-testid="story-time-promise">
                <span className="font-medium">{promise.event}</span>
                <span className="tabular-nums text-muted-foreground">第 {promise.chapterNumber} 章约定</span>
                <span className={promise.daysLeft < 0 ? "text-warning" : "text-muted-foreground"}>{promiseWhen(promise)}</span>
                <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground" title={promise.evidenceText}>{promise.evidenceText}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="时间轴" className="flex min-h-0 flex-col gap-1">
        <h4 className="text-2xs font-medium text-foreground">时间轴</h4>
        <ol className="flex flex-col divide-y divide-border/50" data-testid="story-time-points">
          {data.points.map((point) => (
            <li key={point.anchorId} className="py-1 text-xs" data-testid="story-time-point">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="shrink-0 font-medium tabular-nums">第 {point.chapterNumber} 章</span>
                <span className="shrink-0">「{point.expression}」</span>
                <span className="shrink-0 text-muted-foreground">→ {point.calendarLabel ?? `故事第 ${point.storyDay + 1} 日`}</span>
                <span className="shrink-0 text-2xs text-muted-foreground">{confidenceLabel(point.confidence)}</span>
              </div>
              <p className="text-2xs text-muted-foreground">{point.derivation}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
