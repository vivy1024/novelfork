/**
 * 叙事治理驾驶舱 — GovernanceCockpitPanel
 *
 * 把散落在各处的"全书级治理口径"收敛到一屏：
 *  - 承诺命中率：经纬 foreshadowing 条目派生（resolved / (resolved + 超期未回收)）
 *  - 伏笔回收率：GET /health 的 hookRecoveryRate（后端已算好的权威口径）
 *  - 治理健康：/health warnings 数 + 超期伏笔数
 *  - 叙事契约：book.json 的 narrativeContract（只读，见下方"写入通道"说明）
 *  - 结算与召回：narrative-memory config 的 settlement 开关（可写）
 *
 * 写入通道的事实（已核对，不是猜测）：
 *  - PUT /api/books/:bookId 的 body schema 是 `.strict()` 且不含 narrativeContract
 *    （packages/novelfork-product-runtime/src/routes/books.ts 的 bookBasicSettingsPatchSchema），
 *    因此契约字段目前没有 REST 写入通道 → 本面板只读展示 + 提示手动编辑 book.json。
 *  - narrative-memory config 有 GET/PUT，因此结算开关是真开关。
 *
 * 每个区块独立取数、独立容错：任一路 404/500 只让该区块显示不可用，不连坐其它区块。
 */

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { fetchJson } from "@/hooks/use-api";
import {
  AlertTriangle,
  Gauge,
  Loader2,
  RefreshCw,
  ScrollText,
  Settings2,
  ShieldCheck,
} from "lucide-react";

import { computeForeshadowingDebt } from "../../engine/jingwei/foreshadowing-debt";
import { classifyContractState } from "../../engine/jingwei/context/chapter-briefing";

// ─── 数据契约（对齐既有响应体，字段全部可选防御） ─────────────────────

interface NarrativeContractView {
  titlePromise?: string;
  coreQuestion?: string;
  themeAnchors?: string[];
  revealBudget?: { level?: number; description?: string };
}

interface BookResourcesResponse {
  book?: {
    title?: string;
    narrativeContract?: NarrativeContractView;
  };
  chapters?: Array<{ number?: number }>;
  nextChapter?: number;
}

interface JingweiEntryRecord {
  id?: string;
  title?: string;
  contentMd?: string;
  fields?: Record<string, unknown>;
  customFields?: Record<string, unknown>;
}

interface HealthMetric {
  status?: string;
  value?: number;
  source?: string;
}

interface BookHealthResponse {
  health?: {
    hookRecoveryRate?: HealthMetric | null;
    consistencyScore?: HealthMetric | null;
    knownConflictCount?: HealthMetric | null;
    warnings?: Array<{ type?: string; message?: string }>;
  };
}

interface SettlementConfigView {
  useLlmExtraction?: boolean;
  autoChapterSummary?: boolean;
}

interface NarrativeMemoryConfigResponse {
  config?: { settlement?: SettlementConfigView };
}

/** 三态：加载中 / 就绪 / 不可用。每个区块各持一份，互不影响。 */
type Block<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

// ─── 纯函数区（可单测，不碰 React） ──────────────────────────────────

/** 伏笔条目的 fields 兼容 fields / customFields 两种载荷。 */
export function readEntryFields(entry: JingweiEntryRecord): Record<string, unknown> {
  if (entry.fields && typeof entry.fields === "object") return entry.fields;
  if (entry.customFields && typeof entry.customFields === "object") return entry.customFields;
  return {};
}

export interface PromiseHitRateResult {
  /** 0-100 的百分比；分母为 0 时为 null（展示为「—」而不是 0%）。 */
  readonly percent: number | null;
  readonly resolved: number;
  readonly overdue: number;
  readonly total: number;
}

/**
 * 承诺命中率 = 已回收 / (已回收 + 超期未回收)。
 *
 * 口径与 chapter-briefing 的 computeNarrativeContractHitRate 同源：
 *  - 状态分类用 engine 的 classifyContractState（唯一权威，含中英文状态集）；
 *    无法识别/缺失的状态返回 other，不计入分母——不伪造数据。
 *  - 「超期」复用 engine/jingwei/foreshadowing-debt 的唯一阈值口径（20 章），
 *    不在前端另写一套字面量；拿不到当前章号时 debt 返回 unknown，不计入超期。
 */
export function computePromiseHitRate(
  entries: readonly JingweiEntryRecord[],
  currentChapter: number | undefined,
): PromiseHitRateResult {
  let resolved = 0;
  let overdue = 0;
  for (const entry of entries) {
    const fields = readEntryFields(entry);
    const status = typeof fields.status === "string" ? fields.status : undefined;
    const stateClass = classifyContractState(status);
    if (stateClass === "resolved") {
      resolved += 1;
      continue;
    }
    if (stateClass !== "open") continue;
    const plantedChapter = typeof fields.plantedChapter === "number" ? fields.plantedChapter : 0;
    const debt = computeForeshadowingDebt({
      plantedChapter: plantedChapter > 0 ? plantedChapter : null,
      currentChapter: currentChapter ?? null,
    });
    if (debt.level === "overdue") overdue += 1;
  }
  const denominator = resolved + overdue;
  return {
    percent: denominator === 0 ? null : Math.round((resolved / denominator) * 100),
    resolved,
    overdue,
    total: entries.length,
  };
}

/** ≥70% 绿 / 40-70% 黄 / <40% 红 / null 灰。 */
export function rateToneClass(percent: number | null): string {
  if (percent === null) return "text-muted-foreground";
  if (percent >= 70) return "text-green-600";
  if (percent >= 40) return "text-yellow-600";
  return "text-red-500";
}

export function formatPercent(percent: number | null): string {
  return percent === null ? "—" : `${percent}%`;
}

/** nextChapter 是"下一章号"，当前最大已完成章号 = nextChapter - 1。 */
export function currentChapterFromBookResources(payload: BookResourcesResponse | undefined): number | undefined {
  const fromChapters = (payload?.chapters ?? [])
    .map((chapter) => (typeof chapter?.number === "number" ? chapter.number : 0))
    .reduce((max, value) => (value > max ? value : max), 0);
  if (fromChapters > 0) return fromChapters;
  const next = payload?.nextChapter;
  if (typeof next === "number" && next > 1) return next - 1;
  return undefined;
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

// ─── 展示原子 ────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  tone,
  hint,
  testId,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
  testId?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5" data-testid={testId}>
      <p className="text-[10px] font-medium tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${tone ?? ""}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function BlockError({ message }: { message: string }) {
  return (
    <p className="rounded-md border border-destructive/30 bg-destructive/[0.04] px-3 py-2 text-[11px] text-destructive">
      数据暂时不可用：{message}
    </p>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-muted-foreground">{label}</label>
      <Input value={value} readOnly disabled className="bg-muted/40 text-xs" />
    </div>
  );
}
// ─── 主组件 ──────────────────────────────────────────────────────────

export interface GovernanceCockpitPanelProps {
  bookId: string;
  className?: string;
}

export function GovernanceCockpitPanel({ bookId, className }: GovernanceCockpitPanelProps) {
  const [bookBlock, setBookBlock] = useState<Block<BookResourcesResponse>>({ status: "loading" });
  const [hitRateBlock, setHitRateBlock] = useState<Block<PromiseHitRateResult>>({ status: "loading" });
  const [healthBlock, setHealthBlock] = useState<Block<NonNullable<BookHealthResponse["health"]>>>({ status: "loading" });
  const [settlementBlock, setSettlementBlock] = useState<Block<SettlementConfigView>>({ status: "loading" });
  const [savingKey, setSavingKey] = useState<keyof SettlementConfigView | null>(null);
  const [settlementError, setSettlementError] = useState<string | null>(null);

  const load = useCallback(() => {
    const base = `/api/books/${encodeURIComponent(bookId)}`;
    setBookBlock({ status: "loading" });
    setHitRateBlock({ status: "loading" });
    setHealthBlock({ status: "loading" });
    setSettlementBlock({ status: "loading" });

    const bookPromise = fetchJson<BookResourcesResponse>(base);
    bookPromise.then(
      (data) => setBookBlock({ status: "ready", data }),
      (cause) => setBookBlock({ status: "error", message: errorMessage(cause, "书籍配置读取失败") }),
    );

    // 命中率需要当前章号做超期判定：书籍失败时按 undefined 处理（debt=unknown，不误报超期）。
    Promise.all([
      fetchJson<{ entries?: JingweiEntryRecord[] }>(`${base}/jingwei/entries?category=foreshadowing&limit=50`),
      bookPromise.catch(() => undefined),
    ]).then(
      ([payload, book]) => {
        const entries = Array.isArray(payload.entries) ? payload.entries : [];
        setHitRateBlock({ status: "ready", data: computePromiseHitRate(entries, currentChapterFromBookResources(book)) });
      },
      (cause) => setHitRateBlock({ status: "error", message: errorMessage(cause, "伏笔条目读取失败") }),
    );

    fetchJson<BookHealthResponse>(`${base}/health`).then(
      (payload) => setHealthBlock({ status: "ready", data: payload.health ?? {} }),
      (cause) => setHealthBlock({ status: "error", message: errorMessage(cause, "健康度读取失败") }),
    );

    fetchJson<NarrativeMemoryConfigResponse>(`${base}/narrative-memory/config`).then(
      (payload) => setSettlementBlock({ status: "ready", data: payload.config?.settlement ?? {} }),
      (cause) => setSettlementBlock({ status: "error", message: errorMessage(cause, "叙事记忆配置读取失败") }),
    );
  }, [bookId]);

  useEffect(() => { load(); }, [load]);
  /** 结算开关：乐观更新 + 失败回滚，写回走既有 PUT config。 */
  const toggleSettlement = useCallback(async (key: keyof SettlementConfigView, next: boolean) => {
    if (settlementBlock.status !== "ready" || savingKey) return;
    const previous = settlementBlock.data;
    setSettlementBlock({ status: "ready", data: { ...previous, [key]: next } });
    setSavingKey(key);
    try {
      const payload = await fetchJson<NarrativeMemoryConfigResponse>(
        `/api/books/${encodeURIComponent(bookId)}/narrative-memory/config`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: { settlement: { [key]: next } } }),
        },
      );
      setSettlementBlock({ status: "ready", data: payload.config?.settlement ?? { ...previous, [key]: next } });
    } catch (cause) {
      setSettlementBlock({ status: "ready", data: previous });
      setSettlementError(errorMessage(cause, "结算配置保存失败"));
    } finally {
      setSavingKey(null);
    }
  }, [bookId, savingKey, settlementBlock]);

  const contract = bookBlock.status === "ready" ? bookBlock.data.book?.narrativeContract ?? {} : undefined;
  const health = healthBlock.status === "ready" ? healthBlock.data : undefined;
  const hitRate = hitRateBlock.status === "ready" ? hitRateBlock.data : undefined;
  const recoveryPercent = typeof health?.hookRecoveryRate?.value === "number"
    ? Math.round(health.hookRecoveryRate.value * 100)
    : null;
  const warnings = health?.warnings ?? [];
  const overdueCount = hitRate?.overdue ?? 0;
  const governanceIssues = warnings.length + overdueCount;
  return (
    <div className={`space-y-3 ${className ?? ""}`} data-testid="governance-cockpit-panel">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Gauge className="size-4 text-primary" />
          叙事治理驾驶舱
          <Badge variant="secondary" className="text-[10px] font-normal">全书口径</Badge>
        </h2>
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={load} aria-label="刷新治理驾驶舱">
          <RefreshCw className="size-3.5" />刷新
        </Button>
      </div>

      {/* ── 三张指标卡 ── */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {hitRateBlock.status === "loading" ? (
          <MetricCard label="承诺命中率" value="…" testId="metric-promise-hit-rate" />
        ) : hitRateBlock.status === "error" ? (
          <MetricCard label="承诺命中率" value="—" hint="伏笔条目不可用" testId="metric-promise-hit-rate" />
        ) : (
          <MetricCard
            label="承诺命中率"
            value={formatPercent(hitRate?.percent ?? null)}
            tone={rateToneClass(hitRate?.percent ?? null)}
            hint={`已回收 ${hitRate?.resolved ?? 0} / 超期 ${hitRate?.overdue ?? 0}`}
            testId="metric-promise-hit-rate"
          />
        )}
        <MetricCard
          label="伏笔回收率"
          value={healthBlock.status === "loading" ? "…" : formatPercent(recoveryPercent)}
          tone={rateToneClass(recoveryPercent)}
          hint={healthBlock.status === "error" ? "健康度不可用" : "来自 /health hookRecoveryRate"}
          testId="metric-hook-recovery"
        />
        <MetricCard
          label="治理健康"
          value={healthBlock.status === "loading" ? "…" : governanceIssues === 0 ? "无告警" : `${governanceIssues} 项`}
          tone={governanceIssues === 0 ? "text-green-600" : governanceIssues > 3 ? "text-red-500" : "text-yellow-600"}
          hint={overdueCount > 0 ? `含 ${overdueCount} 条超期伏笔` : "warnings + 超期伏笔合计"}
          testId="metric-governance-health"
        />
      </div>
      {/* ── /health 失败的诚实诊断（指标卡已降级为「—」，这里说明原因） ── */}
      {healthBlock.status === "error" ? <BlockError message={healthBlock.message} /> : null}

      {/* ── /health warnings ── */}
      {warnings.length > 0 ? (
        <div className="space-y-1" data-testid="governance-warnings">
          {warnings.map((warning, index) => (
            <div key={`${warning.type ?? "warning"}-${index}`} className="flex items-start gap-1.5 rounded-md border border-yellow-500/30 bg-yellow-500/[0.06] px-2.5 py-1.5 text-[11px] text-yellow-700 dark:text-yellow-400">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              <span>{warning.message ?? warning.type ?? "未命名告警"}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* ── 叙事契约（只读） ── */}
      <Card data-testid="governance-contract">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ScrollText className="size-4" />
            叙事契约
            <Badge variant="outline" className="text-[10px] font-normal">只读</Badge>
          </CardTitle>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            契约存于 book.json 的 <code>narrativeContract</code>。当前 <code>PUT /api/books/:bookId</code> 的白名单不含该字段，
            没有写入通道，因此这里只做展示；需要修改请手动编辑 book.json。
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {bookBlock.status === "loading" ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />正在读取契约……
            </div>
          ) : bookBlock.status === "error" ? (
            <BlockError message={bookBlock.message} />
          ) : (
            <>
              <ReadOnlyField label="书名承诺" value={contract?.titlePromise ?? "（未填写）"} />
              <ReadOnlyField label="核心问题" value={contract?.coreQuestion ?? "（未填写）"} />
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">主题锚点</label>
                {(contract?.themeAnchors ?? []).length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {(contract?.themeAnchors ?? []).map((anchor, index) => (
                      <Badge key={`${anchor}-${index}`} variant="secondary" className="text-[10px] font-normal">{anchor}</Badge>
                    ))}
                  </div>
                ) : <p className="text-xs text-muted-foreground">（未填写）</p>}
              </div>
              <ReadOnlyField
                label="揭示预算"
                value={contract?.revealBudget
                  ? `层级 ${contract.revealBudget.level ?? 0}${contract.revealBudget.description ? ` · ${contract.revealBudget.description}` : ""}`
                  : "（未填写）"}
              />
            </>
          )}
        </CardContent>
      </Card>
      {/* ── 结算与召回设置（可写：narrative-memory config 有 PUT） ── */}
      <Card data-testid="governance-settlement">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Settings2 className="size-4" />
            结算与召回设置
          </CardTitle>
          <p className="mt-1 text-[11px] text-muted-foreground">写回 narrative-memory config，立即影响下一章结算行为。</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {settlementBlock.status === "loading" ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />正在读取结算配置……
            </div>
          ) : settlementBlock.status === "error" ? (
            <BlockError message={settlementBlock.message} />
          ) : (
            <>
              {settlementError ? <BlockError message={settlementError} /> : null}
              <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium">LLM 事件抽取</p>
                  <p className="text-[10px] text-muted-foreground">关闭后章后结算只走规则抽取，更快但更粗。</p>
                </div>
                <Switch
                  checked={settlementBlock.data.useLlmExtraction ?? false}
                  disabled={savingKey !== null}
                  onCheckedChange={(next) => void toggleSettlement("useLlmExtraction", next)}
                  aria-label="LLM 事件抽取"
                />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium">自动章节摘要</p>
                  <p className="text-[10px] text-muted-foreground">结算完成后生成本章摘要，供下一章 recent-summary 召回。</p>
                </div>
                <Switch
                  checked={settlementBlock.data.autoChapterSummary ?? false}
                  disabled={savingKey !== null}
                  onCheckedChange={(next) => void toggleSettlement("autoChapterSummary", next)}
                  aria-label="自动章节摘要"
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <ShieldCheck className="size-3" />
        全部数据来自既有接口：<code>/api/books/:bookId</code>、<code>/jingwei/entries</code>、<code>/health</code>、<code>/narrative-memory/config</code>。
      </p>
    </div>
  );
}
