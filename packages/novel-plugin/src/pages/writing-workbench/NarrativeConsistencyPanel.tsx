/**
 * 叙事体检面板。
 *
 * 后端 P4 的纰漏检测（经纬设定 × 叙事记忆现状）此前只在写前检查里作为一行软
 * 提醒闪过，作者看不到、也没法处理。这个面板把检出项变成常驻可见、且能就地
 * 处置的东西：每条都带后端 explanation 三段式，纠正 / 作废直接走 fact 编辑
 * 通道，不要求作者跳到别的面板。
 *
 * 边界：
 * - 体检结果不落盘（诊断一次性返回），面板不缓存也不写回检测结论；
 * - 处置动作只改叙事记忆侧（fact 纠正/作废）。经纬那一边要改设定时给跳转，
 *   由作者在经纬条目里改，面板不代写 canon；
 * - 「忽略此条」持久化在后端（只记作者裁决：检测类型 + 实体 id + 章号 + 记忆事实 id），
 *   刷新与重新结算后都不再出现；被忽略的项单独列出，可随时撤销。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, BookOpen, CheckCircle2, Eye, EyeOff, Loader2, RefreshCw, Stethoscope } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";

import {
  explanationOf,
  fetchConsistencyReport,
  findingKey,
  groupFindingsByKind,
  ignoreConsistencyFinding,
  unignoreConsistencyFinding,
  type ConsistencyFinding,
  type ConsistencyReport,
  type FindingGroup,
} from "./narrative-consistency";
import { correctFact, retireFact } from "./narrative-fact-edits";

export interface NarrativeConsistencyPanelProps {
  readonly bookId: string;
  /** 只体检到这一章为止；缺省为全书当前状态。 */
  readonly currentChapter?: number;
  /** 复用工作台的章节跳转（与其他面板同一契约：按章号打开对应章节）。 */
  readonly onJumpToChapter?: (chapterNumber: number) => void;
  /**
   * 打开经纬条目。返回 false 表示条目未载入/不存在，面板会提示作者，
   * 与 WorkbenchCanvas.onOpenJingweiEntry 同一契约。
   */
  readonly onOpenJingweiEntry?: (entryId: string) => boolean;
}

type PanelState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly report: ConsistencyReport };

export function NarrativeConsistencyPanel({
  bookId,
  currentChapter,
  onJumpToChapter,
  onOpenJingweiEntry,
}: NarrativeConsistencyPanelProps) {
  const [state, setState] = useState<PanelState>({ status: "loading" });
  const [showIgnored, setShowIgnored] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const generationRef = useRef(0);

  useEffect(() => () => { generationRef.current += 1; }, []);

  const load = useCallback(async () => {
    const generation = ++generationRef.current;
    setState({ status: "loading" });
    setActionError(null);
    try {
      const report = await fetchConsistencyReport(bookId, currentChapter !== undefined ? { asOfChapter: currentChapter } : {});
      if (generation !== generationRef.current) return;
      setState({ status: "ready", report });
    } catch (cause) {
      if (generation !== generationRef.current) return;
      setState({ status: "error", message: cause instanceof Error ? cause.message : "体检请求失败" });
    }
  }, [bookId, currentChapter]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = useCallback(async (
    finding: ConsistencyFinding,
    action: "correct" | "retire",
  ) => {
    // 纠正方向固定：把叙事记忆现状拉回经纬设定值。反向（改设定）要作者在经纬
    // 条目里做，面板不代写 canon。缺 factId/jingweiValue 时按钮本就不渲染，
    // 这里在置 busy 之前一次挡掉，避免早退把按钮永久留在 disabled。
    if (!finding.factId) return;
    if (action === "correct" && !finding.jingweiValue) return;
    setBusyKey(findingKey(finding));
    setActionError(null);
    try {
      if (action === "correct") {
        await correctFact(bookId, finding.factId, {
          object: finding.jingweiValue,
          ...(finding.memoryPredicate ? { predicate: finding.memoryPredicate } : {}),
          reason: `叙事体检纠正：与经纬设定「${finding.jingweiValue}」对齐`,
        });
        toast(`已纠正为「${finding.jingweiValue}」`, "success");
      } else {
        await retireFact(bookId, finding.factId, { reason: "叙事体检作废：这条记忆抽错了" });
        toast("已作废这条记忆", "success");
      }
      await load();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "处理失败";
      setActionError(message);
      toast(message, "error");
    } finally {
      setBusyKey(null);
    }
  }, [bookId, load]);

  const toggleIgnore = useCallback(async (finding: ConsistencyFinding, ignore: boolean) => {
    if (!finding.ignoreKey) return;
    setBusyKey(findingKey(finding));
    setActionError(null);
    try {
      if (ignore) {
        await ignoreConsistencyFinding(bookId, finding.ignoreKey);
        toast("已忽略这一条；刷新和重新结算都不会再提示", "success");
      } else {
        await unignoreConsistencyFinding(bookId, finding.ignoreKey);
        toast("已撤销忽略", "success");
      }
      await load();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "处理失败";
      setActionError(message);
      toast(message, "error");
    } finally {
      setBusyKey(null);
    }
  }, [bookId, load]);

  const visible = useMemo(() => (state.status === "ready" ? state.report.findings : []), [state]);
  const ignored = useMemo(() => (state.status === "ready" ? state.report.ignored : []), [state]);
  const groups = useMemo(() => groupFindingsByKind(visible), [visible]);
  const ignoredCount = ignored.length;
  const ignoredSection = showIgnored && ignoredCount > 0 ? (
    <section className="rounded-lg border border-dashed border-border p-3 space-y-2" data-testid="consistency-ignored">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <EyeOff className="size-3.5" />
        已忽略 {ignoredCount} 条
      </h3>
      {ignored.map((finding) => (
        <FindingCard
          key={findingKey(finding)}
          finding={finding}
          busy={busyKey === findingKey(finding)}
          ignored
          onJumpToChapter={onJumpToChapter}
          onOpenJingweiEntry={onOpenJingweiEntry}
          onCorrect={(item) => void runAction(item, "correct")}
          onRetire={(item) => void runAction(item, "retire")}
          onIgnore={(item) => void toggleIgnore(item, false)}
        />
      ))}
    </section>
  ) : null;

  return (
    <div className="h-full overflow-y-auto p-3 space-y-3 text-xs" data-testid="narrative-consistency-panel">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 font-medium">
            <Stethoscope className="size-4 text-primary" />
            叙事体检
          </div>
          <p className="text-xs text-muted-foreground">
            对照设定条目、章后事实和前后章衔接，找出对不上的地方。只提示，不拦写作。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded p-1 hover:bg-muted"
          title="重新体检"
          aria-label="重新体检"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>

      {state.status === "loading" && (
        <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span>正在体检…</span>
        </div>
      )}

      {state.status === "error" && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 space-y-2 text-destructive">
          <div className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="size-3.5 shrink-0" />
            体检没跑起来
          </div>
          <p className="text-xs">{state.message}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded border border-destructive/40 px-2 py-1 text-xs hover:bg-destructive/10"
          >
            重试
          </button>
        </div>
      )}

      {state.status === "ready" && (
        <>
          {actionError && (
            <div className="rounded border border-destructive/30 bg-destructive/10 p-2 text-destructive">{actionError}</div>
          )}

          {visible.length === 0 ? (
            <>
              <EmptyState
                summary={state.report.summary}
                ignoredCount={ignoredCount}
                showIgnored={showIgnored}
                onToggleIgnored={() => setShowIgnored((prev) => !prev)}
              />
              {ignoredSection}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">{state.report.summary}</p>
                <Badge variant="secondary" className="shrink-0 text-2xs">
                  {visible.length} 处待看
                </Badge>
              </div>
              {groups.map((group) => (
                <FindingGroupSection
                  key={group.kind}
                  group={group}
                  busyKey={busyKey}
                  onJumpToChapter={onJumpToChapter}
                  onOpenJingweiEntry={onOpenJingweiEntry}
                  onCorrect={(finding) => void runAction(finding, "correct")}
                  onRetire={(finding) => void runAction(finding, "retire")}
                  onIgnore={(finding) => void toggleIgnore(finding, true)}
                />
              ))}
              {ignoredCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowIgnored((prev) => !prev)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {showIgnored ? `收起已忽略的 ${ignoredCount} 条` : `已忽略 ${ignoredCount} 条 · 查看 / 撤销`}
                </button>
              )}
              {ignoredSection}
            </>
          )}
        </>
      )}
    </div>
  );
}

function EmptyState({
  summary,
  ignoredCount,
  showIgnored,
  onToggleIgnored,
}: {
  summary: string;
  ignoredCount: number;
  showIgnored: boolean;
  onToggleIgnored: () => void;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-10 text-center"
      data-testid="narrative-consistency-empty"
    >
      <CheckCircle2 className="size-7 text-success" />
      <span className="text-2xs font-medium">未检出纰漏</span>
      <p className="max-w-[36ch] text-xs text-muted-foreground">
        {summary || "设定条目与章后事实一致。"}
      </p>
      {ignoredCount > 0 && (
        <button type="button" onClick={onToggleIgnored} className="text-xs text-muted-foreground hover:text-foreground">
          {showIgnored ? `收起已忽略的 ${ignoredCount} 条` : `另有 ${ignoredCount} 条已被你忽略 · 查看 / 撤销`}
        </button>
      )}
    </div>
  );
}

function FindingGroupSection({
  group,
  busyKey,
  onJumpToChapter,
  onOpenJingweiEntry,
  onCorrect,
  onRetire,
  onIgnore,
}: {
  group: FindingGroup;
  busyKey: string | null;
  onJumpToChapter?: (chapterNumber: number) => void;
  onOpenJingweiEntry?: (entryId: string) => boolean;
  onCorrect: (finding: ConsistencyFinding) => void;
  onRetire: (finding: ConsistencyFinding) => void;
  onIgnore: (finding: ConsistencyFinding) => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-3 space-y-2" data-testid={`consistency-group-${group.kind}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold">
          <AlertTriangle className="size-3.5 text-warning" />
          {group.label}
        </h3>
        <Badge variant="secondary" className="shrink-0 text-2xs">{group.findings.length}</Badge>
      </div>
      {group.findings.map((finding) => (
        <FindingCard
          key={findingKey(finding)}
          finding={finding}
          busy={busyKey === findingKey(finding)}
          onJumpToChapter={onJumpToChapter}
          onOpenJingweiEntry={onOpenJingweiEntry}
          onCorrect={onCorrect}
          onRetire={onRetire}
          onIgnore={onIgnore}
        />
      ))}
    </section>
  );
}

function FindingCard({
  finding,
  busy,
  ignored = false,
  onJumpToChapter,
  onOpenJingweiEntry,
  onCorrect,
  onRetire,
  onIgnore,
}: {
  finding: ConsistencyFinding;
  busy: boolean;
  /** 已被作者忽略：按钮换成「撤销忽略」。 */
  ignored?: boolean;
  onJumpToChapter?: (chapterNumber: number) => void;
  onOpenJingweiEntry?: (entryId: string) => boolean;
  onCorrect: (finding: ConsistencyFinding) => void;
  onRetire: (finding: ConsistencyFinding) => void;
  /** 忽略此条；已忽略的卡片上表示撤销忽略。 */
  onIgnore: (finding: ConsistencyFinding) => void;
}) {
  const [entryError, setEntryError] = useState<string | null>(null);
  const explanation = explanationOf(finding);
  const canCorrect = Boolean(finding.factId && finding.jingweiValue);
  const canRetire = Boolean(finding.factId);
  // 场景校验里矛盾出现的章与记忆依据所在章不同，两个都给跳转。
  const findingChapter = finding.chapterNumber !== undefined && finding.chapterNumber !== finding.memoryChapter
    ? finding.chapterNumber
    : undefined;
  const headerChapter = findingChapter ?? finding.memoryChapter;

  return (
    <article className="rounded border border-border/60 p-2.5 space-y-2" data-testid="consistency-finding">
      <div className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <span className="text-2xs font-medium">{finding.title}</span>
          {headerChapter !== undefined && (
            <span className="shrink-0 text-2xs text-muted-foreground">第 {headerChapter} 章</span>
          )}
        </div>
        {finding.evidenceText && (
          <blockquote className="border-l-2 border-warning/60 pl-2 text-2xs text-muted-foreground" data-testid="consistency-evidence">
            「{finding.evidenceText}」
          </blockquote>
        )}
        {(finding.jingweiValue || finding.memoryValue) && (
          <div className="flex flex-wrap items-center gap-1.5 text-2xs">
            <span className="text-muted-foreground">{finding.entity}</span>
            {finding.jingweiValue && (
              <span className="rounded bg-muted px-1.5 py-0.5">设定：{finding.jingweiValue}</span>
            )}
            {finding.memoryValue && (
              <span className="rounded bg-warning/15 px-1.5 py-0.5 text-warning">
                现状：{finding.memoryValue}
              </span>
            )}
          </div>
        )}
      </div>

      {/* 三段式一律转述后端 explanation，不按 kind 自造文案。 */}
      <dl className="space-y-1 rounded bg-muted/40 p-2 text-2xs leading-relaxed">
        <ExplanationRow label="发生了什么" value={explanation.whatHappened} />
        <ExplanationRow label="为什么要看" value={explanation.whyItMatters} />
        <ExplanationRow label="建议怎么做" value={explanation.suggestedAction} />
      </dl>

      {entryError && <p className="text-xs text-destructive">{entryError}</p>}

      <div className="flex flex-wrap justify-end gap-1.5">
        {findingChapter !== undefined && onJumpToChapter && (
          <ActionButton onClick={() => onJumpToChapter(findingChapter)} disabled={busy}>
            <BookOpen className="size-3" />
            看第 {findingChapter} 章
          </ActionButton>
        )}
        {finding.memoryChapter !== undefined && onJumpToChapter && (
          <ActionButton onClick={() => onJumpToChapter(finding.memoryChapter!)} disabled={busy}>
            <BookOpen className="size-3" />
            看第 {finding.memoryChapter} 章
          </ActionButton>
        )}
        {finding.jingweiEntryId && onOpenJingweiEntry && (
          <ActionButton
            disabled={busy}
            onClick={() => {
              setEntryError(null);
              if (!onOpenJingweiEntry(finding.jingweiEntryId!)) {
                setEntryError(`条目不存在或尚未载入：${finding.jingweiEntryId}`);
              }
            }}
          >
            看条目
          </ActionButton>
        )}
        {canCorrect && (
          <ActionButton primary disabled={busy} onClick={() => onCorrect(finding)}>
            {busy ? "处理中…" : `纠正为「${finding.jingweiValue}」`}
          </ActionButton>
        )}
        {canRetire && (
          <ActionButton disabled={busy} onClick={() => onRetire(finding)}>
            作废这条
          </ActionButton>
        )}
        {finding.ignoreKey && (ignored ? (
          <ActionButton disabled={busy} onClick={() => onIgnore(finding)} title="撤销忽略，这一条会重新出现在体检结果里">
            <Eye className="size-3" />
            撤销忽略
          </ActionButton>
        ) : (
          <ActionButton disabled={busy} onClick={() => onIgnore(finding)} title="记下你的裁决：刷新与重新结算后都不再提示，可随时撤销">
            <EyeOff className="size-3" />
            忽略此条
          </ActionButton>
        ))}
      </div>
    </article>
  );
}

function ExplanationRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="w-14 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1">{value}</dd>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  primary,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors disabled:opacity-50 ${
        primary
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "border border-border hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}
