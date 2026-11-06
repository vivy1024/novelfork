import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Loader2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export type StyleDistillationFetchJson = <T>(path: string, init?: RequestInit) => Promise<T>;

export interface StyleDistillationWorkspaceProps {
  bookId: string;
  fetchJson: StyleDistillationFetchJson;
  onAdopted?: (response: unknown) => void;
  onBusyChange?: (busy: boolean) => void;
}

export interface StyleSkillExportResponse {
  readonly slug: string;
  readonly file: string;
  readonly content: string;
  readonly ruleCount: number;
  readonly sourceTitles: readonly string[];
}

export interface StyleDistillationPreviewChapter {
  readonly chapterNumber?: number;
  readonly title?: string;
  readonly characters?: number;
  readonly totalCharacters?: number;
}

export interface StyleDistillationPreviewResponse {
  readonly previewId: string;
  readonly sourceName: string;
  readonly chapterCount: number;
  readonly totalCharacters: number;
  readonly chapters: readonly StyleDistillationPreviewChapter[];
  readonly coverage: unknown;
  readonly warnings: readonly string[];
  readonly estimate: StyleDistillationEstimateView | null;
}

export type StyleDistillationReviewStatus = "needs-review" | "confirmed";
export type StyleDistillationTransfer = "transferable" | "source-only";

export interface StyleDistillationRule {
  readonly id: string;
  readonly text: string;
  readonly evidence: string;
  readonly transfer: StyleDistillationTransfer;
  readonly status: StyleDistillationReviewStatus;
  /** 证据吻合程度（模型规则才有）：只差标点为 medium，只部分吻合为 low。 */
  readonly confidence?: "high" | "medium" | "low";
}

/** 开跑前的用量估算（后端预览返回，叙述者预览同口径）。 */
export interface StyleDistillationEstimateView {
  readonly batchCount: number;
  readonly maxOutputTokens: number;
  readonly maxOutputChars: number;
  readonly summary: string;
}

interface StopReason {
  readonly what: string;
  readonly next?: string;
}

export interface StyleDistillationSample extends StyleDistillationRule {
  readonly sceneType?: string;
}

interface Draft {
  sourceName: string;
  text: string;
  splitPattern: string;
}

export interface StyleDistillationBatchView {
  readonly id: string;
  readonly chapterNumbers: readonly number[];
  readonly status: "pending" | "running" | "done" | "failed";
  readonly ruleCount: number;
  readonly issues: readonly string[];
  readonly explanation: { readonly what: string; readonly next?: string } | null;
  /** 证据未在原文找到而未收录的模型规则。 */
  readonly rejectedRules: readonly { readonly text: string; readonly evidence: string; readonly reason: string }[];
}

/** 多来源比较（后端 GET …/distillations/compare 的派生视图）里的一条规则，带出处与证据。 */
export interface StyleComparisonMemberView {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly jobId: string | null;
  readonly ruleId: string;
  readonly text: string;
  readonly evidence: string;
  readonly category: string;
}

export interface StyleComparisonView {
  readonly sources: readonly {
    readonly sourceId: string;
    readonly sourceName: string;
    readonly jobId: string | null;
    readonly adoptedRuleIds: readonly string[];
    readonly adoptedSampleIds: readonly string[];
  }[];
  readonly common: readonly { readonly category: string; readonly text: string; readonly members: readonly StyleComparisonMemberView[] }[];
  readonly differences: readonly { readonly sourceId: string; readonly sourceName: string; readonly rules: readonly StyleComparisonMemberView[] }[];
  readonly nonTransferable: readonly StyleComparisonMemberView[];
  /** 各来源统计对比：统计指纹数值与确定性基线规则，按来源并列，不合并。 */
  readonly statistics: readonly {
    readonly sourceId: string;
    readonly sourceName: string;
    readonly jobId: string | null;
    readonly metrics: Readonly<Record<string, number>>;
    readonly baselineRules: readonly StyleComparisonMemberView[];
  }[];
}

interface Review {
  jobStatus: string | null;
  batches: StyleDistillationBatchView[];
  sourceName: string;
  expectedRevision: string | null;
  rules: StyleDistillationRule[];
  samples: StyleDistillationSample[];
  fingerprint: Record<string, unknown>;
  conflicts: string[];
  /** 可一键采纳的条目（可迁移、证据逐字吻合的模型规则），由后端按统一口径给出。 */
  recommendedRuleIds: string[];
  /** 任务停着（暂停 / 失败）的原因；后端没说明时为 null。 */
  stopReason: StopReason | null;
}

type Stage = "input" | "preview" | "processing" | "review";
type JsonRecord = Record<string, unknown>;

// 模型批次可能持续数分钟：轮询间隔放宽，总等待约 30 分钟；超时后任务仍在服务端继续，可重新打开查看。
const POLL_INTERVAL_MS = 1_500;
const MAX_POLL_ATTEMPTS = 1_200;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const result = asString(value);
    if (result !== null && result.trim()) return result;
  }
  return null;
}

function firstRecord(...values: unknown[]): JsonRecord | null {
  for (const value of values) {
    const result = asRecord(value);
    if (result) return result;
  }
  return null;
}

function firstArray(...values: unknown[]): unknown[] {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatValue(value: unknown): string {
  if (typeof value === "number") return Number.isInteger(value) ? formatNumber(value) : String(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const SCENE_TYPE_LABELS: Record<string, string> = {
  dialogue: "对话",
  action: "动作",
  description: "描写",
  interiority: "心理",
  transition: "过渡",
  general: "通用",
};

function sceneTypeLabel(sceneType: string): string {
  return SCENE_TYPE_LABELS[sceneType] ?? "通用";
}

const RULE_CATEGORY_LABELS: Record<string, string> = {
  voice: "声音",
  language: "语言",
  rhythm: "节奏",
  dialogue: "对话",
  scene: "场景写法",
  consistency: "一致性",
  general: "综合",
};

function ruleCategoryLabel(category: string): string {
  return RULE_CATEGORY_LABELS[category] ?? "综合";
}

function stringList(value: unknown): string[] {
  return firstArray(value).filter((item): item is string => typeof item === "string");
}

function normaliseComparisonMember(value: unknown, fallbackCategory = "general"): StyleComparisonMemberView | null {
  const record = asRecord(value);
  const ruleId = firstString(record?.ruleId);
  const text = firstString(record?.text);
  if (!record || !ruleId || !text) return null;
  return {
    sourceId: firstString(record.sourceId) ?? "",
    sourceName: firstString(record.sourceName) ?? "未命名来源",
    jobId: firstString(record.jobId),
    ruleId,
    text,
    evidence: firstString(record.evidence) ?? "未提供证据",
    category: firstString(record.category) ?? fallbackCategory,
  };
}

function normaliseComparisonMembers(value: unknown, fallbackCategory?: string): StyleComparisonMemberView[] {
  return firstArray(value).map((item) => normaliseComparisonMember(item, fallbackCategory)).filter((item): item is StyleComparisonMemberView => item !== null);
}

function normaliseComparison(value: unknown): StyleComparisonView | null {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.sources)) return null;
  return {
    sources: record.sources.flatMap((item) => {
      const source = asRecord(item);
      const sourceId = firstString(source?.sourceId);
      if (!source || !sourceId) return [];
      return [{
        sourceId,
        sourceName: firstString(source.sourceName) ?? "未命名来源",
        jobId: firstString(source.jobId),
        adoptedRuleIds: stringList(source.adoptedRuleIds),
        adoptedSampleIds: stringList(source.adoptedSampleIds),
      }];
    }),
    common: firstArray(record.common).flatMap((item) => {
      const group = asRecord(item);
      const category = firstString(group?.category) ?? "general";
      const members = normaliseComparisonMembers(group?.members, category);
      return group && members.length > 0 ? [{ category, text: firstString(group.text) ?? members[0]!.text, members }] : [];
    }),
    differences: firstArray(record.differences).flatMap((item) => {
      const entry = asRecord(item);
      const rules = normaliseComparisonMembers(entry?.rules);
      return entry && rules.length > 0 ? [{ sourceId: firstString(entry.sourceId) ?? "", sourceName: firstString(entry.sourceName) ?? "未命名来源", rules }] : [];
    }),
    nonTransferable: normaliseComparisonMembers(record.nonTransferable),
    statistics: firstArray(record.statistics).flatMap((item) => {
      const entry = asRecord(item);
      const sourceId = firstString(entry?.sourceId);
      if (!entry || !sourceId) return [];
      const metrics = Object.fromEntries(Object.entries(asRecord(entry.metrics) ?? {})
        .filter((pair): pair is [string, number] => typeof pair[1] === "number" && Number.isFinite(pair[1])));
      return [{
        sourceId,
        sourceName: firstString(entry.sourceName) ?? "未命名来源",
        jobId: firstString(entry.jobId),
        metrics,
        baselineRules: normaliseComparisonMembers(entry.baselineRules),
      }];
    }),
  };
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const a = new Set(left);
  return a.size === new Set(right).size && right.every((id) => a.has(id));
}

const METRIC_LABELS: Record<string, string> = {
  avgSentenceLength: "平均句长",
  sentenceLengthStdDev: "句长标准差",
  sentenceLengthBurstiness: "句长爆发度",
  shortSentenceRatio: "短句比例",
  longSentenceRatio: "长句比例",
  avgParagraphLength: "平均段长",
  dialogueRatio: "对白比例",
  vocabularyDiversity: "词汇多样性",
  weakAdverbPer1000: "弱副词密度",
  sampleCharCount: "样本字数",
  sampleSentenceCount: "样本句数",
};

/** 只展示有中文名的数值指标；内部分布数组等不直接给作者看。 */
function displayableMetrics(fingerprint: Record<string, unknown>): [string, unknown][] {
  return Object.entries(fingerprint).filter(([key, value]) => key in METRIC_LABELS && typeof value === "number");
}

function metricLabel(key: string): string {
  return METRIC_LABELS[key] ?? key;
}

function normaliseWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((warning) => {
    const record = asRecord(warning);
    return firstString(record?.explanation, record?.message, record?.text, warning) ?? "未说明的提醒";
  });
}

function normalisePreview(value: unknown): StyleDistillationPreviewResponse {
  const record = asRecord(value);
  if (!record) throw new Error("预览响应不是有效对象，请稍后重试。");
  const previewId = firstString(record.previewId);
  if (!previewId) throw new Error("预览没有返回结果，请重试。");
  const chapters = firstArray(record.chapters).map((chapter) => {
    const item = asRecord(chapter);
    return {
      chapterNumber: asNumber(item?.chapterNumber ?? item?.number) ?? undefined,
      title: firstString(item?.title, item?.chapterTitle) ?? undefined,
      characters: asNumber(item?.characters ?? item?.characterCount) ?? undefined,
      totalCharacters: asNumber(item?.totalCharacters) ?? undefined,
    } satisfies StyleDistillationPreviewChapter;
  });
  return {
    previewId,
    sourceName: firstString(record.sourceName) ?? "未命名来源",
    chapterCount: asNumber(record.chapterCount) ?? chapters.length,
    totalCharacters: asNumber(record.totalCharacters) ?? 0,
    chapters,
    coverage: record.coverage ?? null,
    warnings: normaliseWarnings(record.warnings),
    estimate: normaliseEstimate(record.estimate),
  };
}

function normaliseEstimate(value: unknown): StyleDistillationEstimateView | null {
  const record = asRecord(value);
  const batchCount = asNumber(record?.batchCount);
  if (!record || batchCount === null) return null;
  return {
    batchCount,
    maxOutputTokens: asNumber(record.maxOutputTokens) ?? 0,
    maxOutputChars: asNumber(record.maxOutputChars) ?? 0,
    summary: firstString(record.summary) ?? "",
  };
}

/** 任务停下的原因：接口顶层 explanation（含无模型、自动续跑、任务级失败）优先，其次是任务上记的 lastError。 */
function stopReason(value: unknown): StopReason | null {
  const job = unwrapJob(value);
  const explanation = firstRecord(asRecord(value)?.explanation, job?.lastError);
  const what = firstString(explanation?.what);
  return what ? { what, next: firstString(explanation?.next) ?? undefined } : null;
}

function normaliseTransfer(value: unknown): StyleDistillationTransfer {
  return value === "source-only" || value === "source_only" || value === "作品专属" ? "source-only" : "transferable";
}

function normaliseStatus(value: unknown): StyleDistillationReviewStatus {
  return value === "confirmed" || value === "approved" || value === "已确认" ? "confirmed" : "needs-review";
}

function normaliseEntry(value: unknown, kind: "rule" | "sample", index: number): StyleDistillationRule | StyleDistillationSample | null {
  const record = asRecord(value);
  if (!record) return null;
  const text = firstString(record.text, record.rule, record.content);
  if (!text) return null;
  const entry = {
    id: firstString(record.id, kind === "rule" ? record.ruleId : record.sampleId) ?? `${kind}-${index + 1}`,
    text,
    evidence: firstString(record.evidence, record.reason, record.source) ?? "未提供证据",
    transfer: normaliseTransfer(record.transfer ?? record.transferability ?? record.scope),
    status: normaliseStatus(record.status ?? record.reviewStatus),
    ...(record.confidence === "medium" || record.confidence === "low" || record.confidence === "high" ? { confidence: record.confidence } : {}),
  };
  return kind === "sample"
    ? { ...entry, sceneType: firstString(record.sceneType, record.scene, record.kind) ?? undefined }
    : entry;
}

function normaliseEntries(value: unknown, kind: "rule" | "sample"): (StyleDistillationRule | StyleDistillationSample)[] {
  return Array.isArray(value)
    ? value.map((entry, index) => normaliseEntry(entry, kind, index)).filter((entry): entry is StyleDistillationRule | StyleDistillationSample => entry !== null)
    : [];
}

function unwrapJob(value: unknown): JsonRecord | null {
  const record = asRecord(value);
  return firstRecord(record?.job, record) ?? null;
}

function reviewPayload(value: unknown): JsonRecord | null {
  const job = unwrapJob(value);
  if (!job) return null;
  return firstRecord(job.result, job.review, job.output, job.sourcePackage, job) ?? job;
}

function hasReviewData(value: unknown): boolean {
  const job = unwrapJob(value);
  const payload = reviewPayload(value);
  if (!job || !payload) return false;
  return firstArray(payload.rules, payload.sourcePackage && asRecord(payload.sourcePackage)?.rules).length > 0
    || firstArray(payload.samples, payload.sourcePackage && asRecord(payload.sourcePackage)?.samples).length > 0
    || Boolean(firstRecord(payload.fingerprint, payload.statistics));
}

function normaliseBatches(value: unknown): StyleDistillationBatchView[] {
  const job = unwrapJob(value);
  return firstArray(job?.batches).flatMap((item) => {
    const batch = asRecord(item);
    const id = firstString(batch?.id);
    if (!batch || !id) return [];
    const status = batch.status === "running" || batch.status === "done" || batch.status === "failed" ? batch.status : "pending";
    const explanation = asRecord(batch.explanation);
    const what = firstString(explanation?.what);
    return [{
      id,
      chapterNumbers: firstArray(batch.chapterNumbers).filter((number): number is number => typeof number === "number"),
      status,
      ruleCount: firstArray(batch.ruleIds).length,
      issues: firstArray(batch.issues).filter((issue): issue is string => typeof issue === "string"),
      explanation: what ? { what, next: firstString(explanation?.next) ?? undefined } : null,
      rejectedRules: firstArray(batch.rejectedRules).flatMap((entry) => {
        const rule = asRecord(entry);
        const text = firstString(rule?.text);
        return text ? [{ text, evidence: firstString(rule?.evidence) ?? "", reason: firstString(rule?.reason) ?? "" }] : [];
      }),
    } satisfies StyleDistillationBatchView];
  });
}

function normaliseReview(value: unknown): Review {
  const job = unwrapJob(value);
  const result = reviewPayload(value);
  if (!job || !result) throw new Error("蒸馏任务返回了无法识别的结果，请重试。");
  const sourcePackage = firstRecord(result.sourcePackage, result.package, result.source) ?? result;
  const rules = normaliseEntries(firstArray(sourcePackage.rules, result.rules, job.rules), "rule") as StyleDistillationRule[];
  const samples = normaliseEntries(firstArray(sourcePackage.samples, result.samples, job.samples), "sample") as StyleDistillationSample[];
  const fingerprint = firstRecord(sourcePackage.fingerprint, result.fingerprint, result.statistics, job.fingerprint, job.statistics) ?? {};
  const conflictValues = firstArray(result.conflicts, job.conflicts);
  return {
    jobStatus: jobStatus(value),
    batches: normaliseBatches(value),
    sourceName: firstString(result.sourceName, sourcePackage.sourceName, job.sourceName) ?? "未命名来源",
    expectedRevision: firstString(result.expectedRevision, sourcePackage.expectedRevision, job.expectedRevision),
    rules,
    samples,
    fingerprint,
    conflicts: conflictValues.map((conflict) => {
      const item = asRecord(conflict);
      return firstString(item?.explanation, item?.message, item?.text, conflict) ?? "未说明的冲突";
    }),
    recommendedRuleIds: stringList(asRecord(value)?.recommendedRuleIds).filter((id) => rules.some((rule) => rule.id === id)),
    stopReason: stopReason(value),
  };
}

function jobStatus(value: unknown): string | null {
  const job = unwrapJob(value);
  return firstString(job?.status, job?.state, job?.phase)?.toLowerCase() ?? null;
}

function jobId(value: unknown): string | null {
  const job = unwrapJob(value);
  return firstString(job?.id, job?.jobId);
}

function jobError(value: unknown): string | null {
  const reason = stopReason(value);
  if (reason) return [reason.what, reason.next].filter(Boolean).join(" ");
  const job = unwrapJob(value);
  const error = firstRecord(job?.error, job?.failure);
  return firstString(error?.explanation, error?.message, job?.error, job?.message);
}

// paused：还有未完成的模型批次但当前没有运行者（无模型或中断），基线结果已可审阅。
const FINISHED_STATUSES = ["ready", "paused", "adopted", "succeeded", "success", "completed", "complete", "done", "finished"];

function isFinished(status: string | null, value: unknown): boolean {
  if (hasReviewData(value)) return status === null || FINISHED_STATUSES.includes(status);
  return status !== null && FINISHED_STATUSES.includes(status);
}

function isFailed(status: string | null): boolean {
  return status !== null && ["failed", "error", "cancelled", "canceled"].includes(status);
}

function errorStatus(value: unknown): number | null {
  const record = asRecord(value);
  return asNumber(record?.status) ?? asNumber(record?.statusCode);
}

function errorMessage(value: unknown, fallback: string): string {
  const record = asRecord(value);
  const explanation = asRecord(record?.explanation);
  const what = firstString(explanation?.what);
  if (what) return [what, firstString(explanation?.next)].filter(Boolean).join(" ");
  if (value instanceof Error && value.message) return value.message;
  return firstString(record?.explanation, record?.message, record?.error) ?? fallback;
}

function coverageText(coverage: unknown, chapters: readonly StyleDistillationPreviewChapter[]): string {
  if (typeof coverage === "string" && coverage.trim()) return coverage;
  const record = asRecord(coverage);
  const label = firstString(record?.label, record?.range, record?.chapterRange, record?.description);
  if (label) return label;
  const start = asNumber(record?.startChapter ?? record?.fromChapter);
  const end = asNumber(record?.endChapter ?? record?.toChapter);
  if (start !== null && end !== null) return `第 ${start}–${end} 章`;
  const numbers = chapters.map((chapter) => chapter.chapterNumber).filter((number): number is number => number !== undefined);
  if (numbers.length > 0) return `第 ${Math.min(...numbers)}–${Math.max(...numbers)} 章`;
  return "按参考文本自动拆分";
}

function estimatedOutput(preview: StyleDistillationPreviewResponse): string {
  const coverage = asRecord(preview.coverage);
  const value = firstString(coverage?.estimatedOutput, coverage?.estimatedResult, coverage?.outputEstimate);
  if (value) return value;
  const count = asNumber(coverage?.estimatedRuleCount ?? coverage?.ruleCount);
  if (count !== null) return `约 ${formatNumber(count)} 条审阅项与 1 份统计基线`;
  return "文风规则、范文与统计基线";
}

function stageLabel(stage: Stage): string {
  if (stage === "input") return "输入参考文本";
  if (stage === "preview") return "确认处理范围";
  if (stage === "processing") return "正在蒸馏";
  return "审阅并采纳";
}

function ReviewEntry({
  entry,
  disabled,
  onToggle,
}: {
  entry: StyleDistillationRule | StyleDistillationSample;
  disabled: boolean;
  onToggle: () => void;
}) {
  const confirmed = entry.status === "confirmed";
  return (
    <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant={entry.transfer === "transferable" ? "secondary" : "outline"}>
          {entry.transfer === "transferable" ? "可迁移" : "作品专属"}
        </Badge>
        <Badge variant={confirmed ? "default" : "outline"}>{confirmed ? "已确认" : "待审"}</Badge>
        {"sceneType" in entry && entry.sceneType && <Badge variant="outline">{sceneTypeLabel(entry.sceneType)}范文</Badge>}
        {entry.confidence === "medium" && <Badge variant="outline">证据只差标点</Badge>}
        {entry.confidence === "low" && <Badge variant="outline">证据部分吻合，请核对</Badge>}
      </div>
      <p className="whitespace-pre-wrap break-words text-sm leading-6">{entry.text}</p>
      <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">证据：{entry.evidence}</p>
      <Button
        type="button"
        size="xs"
        variant={confirmed ? "outline" : "ghost"}
        disabled={disabled}
        aria-label={`${confirmed ? "撤回确认" : "确认"}：${entry.text}`}
        onClick={onToggle}
      >
        {confirmed ? <Check className="size-3" /> : null}
        {confirmed ? "撤回确认" : "确认这条"}
      </Button>
    </div>
  );
}

export function StyleDistillationWorkspace(props: StyleDistillationWorkspaceProps) {
  return <BookStyleDistillationWorkspace key={props.bookId} {...props} />;
}

function BookStyleDistillationWorkspace({
  bookId,
  fetchJson,
  onAdopted,
  onBusyChange,
}: StyleDistillationWorkspaceProps) {
  const [draft, setDraft] = useState<Draft>({ sourceName: "", text: "", splitPattern: "" });
  const splitPatternHintId = useId();
  const [stage, setStage] = useState<Stage>("input");
  const [preview, setPreview] = useState<StyleDistillationPreviewResponse | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [progressBatches, setProgressBatches] = useState<StyleDistillationBatchView[]>([]);
  const [adopted, setAdopted] = useState(false);
  const [skillBusy, setSkillBusy] = useState(false);
  const [skillExport, setSkillExport] = useState<StyleSkillExportResponse | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [comparison, setComparison] = useState<StyleComparisonView | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  /** 比较视图里「其他来源」任务的规则选择（按任务 ID）；当前任务的选择仍记在 review.rules 上。 */
  const [otherSelections, setOtherSelections] = useState<Record<string, string[]>>({});
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      onBusyChange?.(false);
    };
  }, [onBusyChange]);

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  const paths = useMemo(() => {
    const encodedBookId = encodeURIComponent(bookId);
    return {
      preview: `/api/books/${encodedBookId}/style/distillations/preview`,
      jobs: `/api/books/${encodedBookId}/style/distillations/jobs`,
      job: (id: string) => `/api/books/${encodedBookId}/style/distillations/jobs/${encodeURIComponent(id)}`,
      resume: (id: string) => `/api/books/${encodedBookId}/style/distillations/jobs/${encodeURIComponent(id)}/resume`,
      adopt: (id: string) => `/api/books/${encodedBookId}/style/distillations/jobs/${encodeURIComponent(id)}/adopt`,
      adoptRecommended: (id: string) => `/api/books/${encodedBookId}/style/distillations/jobs/${encodeURIComponent(id)}/adopt-recommended`,
      compare: `/api/books/${encodedBookId}/style/distillations/compare`,
      skillExport: `/api/books/${encodedBookId}/style/skill-export`,
    };
  }, [bookId]);

  const confirmedRuleIds = useMemo(
    () => review?.rules.filter((entry) => entry.status === "confirmed").map((entry) => entry.id) ?? [],
    [review],
  );
  const confirmedSampleIds = useMemo(
    () => review?.samples.filter((entry) => entry.status === "confirmed").map((entry) => entry.id) ?? [],
    [review],
  );

  function updateDraft(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setNotice(null);
    setError(null);
  }

  async function previewText() {
    const sourceName = draft.sourceName.trim();
    const text = draft.text.trim();
    if (!sourceName || !text) {
      setError(!sourceName ? "请先填写来源名称。" : "请先粘贴参考文本，再预览处理范围。");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetchJson<unknown>(paths.preview, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceName,
          text,
          ...(draft.splitPattern.trim() ? { splitPattern: draft.splitPattern.trim() } : {}),
        }),
      });
      if (!mounted.current) return;
      setPreview(normalisePreview(response));
      setReview(null);
      setStage("preview");
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause, "预览失败，请检查参考文本后重试。"));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function waitForJob(initial: unknown): Promise<Review> {
    let current = initial;
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
      if (mounted.current) setProgressBatches(normaliseBatches(current));
      const status = jobStatus(current);
      if (isFinished(status, current)) return normaliseReview(current);
      if (isFailed(status)) throw new Error(jobError(current) ?? "蒸馏任务失败，请检查输入后重试。");
      const id = jobId(current);
      if (!id) throw new Error("蒸馏没有正常开始，请重试。");
      if (attempt >= MAX_POLL_ATTEMPTS - 1) break;
      await new Promise<void>((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
      current = await fetchJson<unknown>(paths.job(id));
    }
    throw new Error("蒸馏任务等待超时。任务仍保存在本书中，可以保留当前草稿，稍后重新开始。");
  }

  async function resumeJob(retryFailed: boolean) {
    const id = reviewJobId.current;
    if (!id || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setStage("processing");
    try {
      const resumed = await fetchJson<unknown>(paths.resume(id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retryFailed }),
      });
      const result = await waitForJob(resumed);
      if (!mounted.current) return;
      setReview(result);
      void loadComparison(reviewJobId.current);
      setStage("review");
    } catch (cause) {
      if (!mounted.current) return;
      const message = errorMessage(cause, "继续模型批次失败，请稍后重试。");
      setError(errorStatus(cause) === 422
        ? `${message} 可以在对话里让叙述者继续这次蒸馏。`
        : message);
      setStage("review");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  /**
   * 读取多来源比较（每个来源取最新任务）。其他来源的选择从它们上次的采纳记录初始化，
   * 这样重新采纳时不会把作者之前确认过的条目丢掉。读取失败时退回单来源审阅。
   */
  async function loadComparison(currentJobId: string | null) {
    try {
      const view = normaliseComparison(await fetchJson<unknown>(paths.compare));
      if (!mounted.current) return;
      setCompareError(null);
      setComparison(view);
      setOtherSelections(Object.fromEntries((view?.sources ?? [])
        .filter((source) => source.jobId && source.jobId !== currentJobId)
        .map((source) => [source.jobId!, [...source.adoptedRuleIds]])));
    } catch (cause) {
      if (!mounted.current) return;
      setComparison(null);
      setCompareError(errorMessage(cause, "多来源比较读取失败。"));
    }
  }

  function isMemberConfirmed(member: StyleComparisonMemberView): boolean {
    if (!member.jobId) return false;
    if (member.jobId === reviewJobId.current) return review?.rules.some((rule) => rule.id === member.ruleId && rule.status === "confirmed") ?? false;
    return otherSelections[member.jobId]?.includes(member.ruleId) ?? false;
  }

  function toggleMember(member: StyleComparisonMemberView) {
    if (busy || !review || !member.jobId) return;
    if (member.jobId === reviewJobId.current) {
      const index = review.rules.findIndex((rule) => rule.id === member.ruleId);
      if (index >= 0) toggleEntry("rules", index);
      return;
    }
    const jobKey = member.jobId;
    setOtherSelections((current) => {
      const selected = current[jobKey] ?? [];
      return {
        ...current,
        [jobKey]: selected.includes(member.ruleId) ? selected.filter((id) => id !== member.ruleId) : [...selected, member.ruleId],
      };
    });
    setNotice(null);
    setError(null);
  }

  function toggleEntry(kind: "rules" | "samples", index: number) {
    if (busy || !review) return;
    setReview((current) => {
      if (!current) return current;
      return {
        ...current,
        [kind]: current[kind].map((entry, entryIndex) => entryIndex === index
          ? { ...entry, status: entry.status === "confirmed" ? "needs-review" : "confirmed" }
          : entry),
      };
    });
    setNotice(null);
    setError(null);
  }

  const reviewJobId = useRef<string | null>(null);

  async function adopt() {
    if (!review || busy || conflict) return;
    const id = review.expectedRevision;
    if (!reviewJobId.current) {
      setError("找不到这次蒸馏，无法采纳，请重新开始。");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // 多来源时，其他来源中选择有变化的任务也各走一次同一个采纳接口（与 style.distill_adopt 共用采纳函数）。
      // 每次采纳都要带上一次返回的预设版本，按顺序串行，任何一次冲突都会停下。
      const otherAdoptions = (comparison?.sources ?? []).flatMap((source) => {
        if (!source.jobId || source.jobId === reviewJobId.current) return [];
        const selected = otherSelections[source.jobId] ?? [];
        return sameIds(selected, source.adoptedRuleIds)
          ? []
          : [{ jobId: source.jobId, ruleIds: selected, sampleIds: source.adoptedSampleIds }];
      });
      let revision: string | null = id;
      let response: unknown = null;
      for (const request of [
        { jobId: reviewJobId.current, ruleIds: confirmedRuleIds, sampleIds: confirmedSampleIds },
        ...otherAdoptions,
      ]) {
        response = await fetchJson<unknown>(paths.adopt(request.jobId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: revision,
            confirmedRuleIds: request.ruleIds,
            confirmedSampleIds: request.sampleIds,
          }),
        });
        revision = firstString(asRecord(response)?.revision) ?? revision;
      }
      if (!mounted.current) return;
      setReview((current) => current ? { ...current, expectedRevision: revision } : current);
      if (otherAdoptions.length > 0) void loadComparison(reviewJobId.current);
      finishAdoption(response, otherAdoptions.length > 0
        ? `已采纳到本书文风预设（含另外 ${otherAdoptions.length} 个来源的选择变化）。作品专属内容仍保留在来源包中，不会进入通用写法指南。`
        : "已采纳到本书文风预设。作品专属内容仍保留在来源包中，不会进入通用写法指南。");
    } catch (cause) {
      if (mounted.current) handleAdoptError(cause);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  function finishAdoption(response: unknown, message: string) {
    setNotice(message);
    setAdopted(true);
    setSkillExport(null);
    setSkillError(null);
    setCopied(false);
    onAdopted?.(response);
  }

  function handleAdoptError(cause: unknown) {
    if (errorStatus(cause) === 409) {
      setConflict(true);
      setError("采纳冲突：本书文风预设已有新版本。请重新蒸馏并确认当前选择后再采纳，避免覆盖他人的修改。");
    } else {
      setError(errorMessage(cause, "采纳失败，当前审阅选择已保留，请重试。"));
    }
  }

  /** 一键采纳后端推荐的条目（可迁移、证据逐字吻合）；之前确认过的条目一并保留。 */
  async function adoptRecommended() {
    if (!review || busy || conflict || review.recommendedRuleIds.length === 0) return;
    const id = reviewJobId.current;
    if (!id) {
      setError("找不到这次蒸馏，无法采纳，请重新开始。");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetchJson<unknown>(paths.adoptRecommended(id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: review.expectedRevision }),
      });
      if (!mounted.current) return;
      const record = asRecord(response);
      const adoptedIds = new Set([...stringList(record?.adoptedRuleIds), ...review.recommendedRuleIds]);
      setReview((current) => current ? {
        ...current,
        expectedRevision: firstString(record?.revision) ?? current.expectedRevision,
        rules: current.rules.map((rule) => adoptedIds.has(rule.id) ? { ...rule, status: "confirmed" } : rule),
      } : current);
      const guideCount = asNumber(record?.guideRuleCount) ?? review.recommendedRuleIds.length;
      finishAdoption(response, `已采纳 ${review.recommendedRuleIds.length} 条推荐规则，本书文风指南现有 ${guideCount} 条来自这次蒸馏的写法。其余条目仍可逐条确认后再采纳。`);
    } catch (cause) {
      if (mounted.current) handleAdoptError(cause);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  /** 采纳完成后一键把「已确认且可迁移」的来源规则汇总生成本书专属技能；重复生成覆盖同一文件。 */
  async function exportSkill() {
    if (skillBusy || !adopted) return;
    setSkillBusy(true);
    setSkillError(null);
    setCopied(false);
    try {
      const record = asRecord(await fetchJson<unknown>(paths.skillExport, { method: "POST" }));
      const result: StyleSkillExportResponse = {
        slug: firstString(record?.slug) ?? "book-style-memory",
        file: firstString(record?.file) ?? "",
        content: firstString(record?.content) ?? "",
        ruleCount: asNumber(record?.ruleCount) ?? 0,
        sourceTitles: firstArray(record?.sourceTitles).filter((title): title is string => typeof title === "string"),
      };
      if (!mounted.current) return;
      setSkillExport(result);
    } catch (cause) {
      if (mounted.current) setSkillError(errorMessage(cause, "生成技能失败，请稍后重试。"));
    } finally {
      if (mounted.current) setSkillBusy(false);
    }
  }

  async function copySkillContent() {
    if (!skillExport?.content || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(skillExport.content);
      if (mounted.current) setCopied(true);
    } catch {
      if (mounted.current) setSkillError("复制失败，请手动复制技能内容。");
    }
  }

  async function startAndRememberJob() {
    if (!preview || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setConflict(false);
    setAdopted(false);
    setSkillExport(null);
    setSkillError(null);
    setCopied(false);
    setProgressBatches([]);
    setComparison(null);
    setCompareError(null);
    setOtherSelections({});
    setStage("processing");
    try {
      const created = await fetchJson<unknown>(paths.jobs, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          previewId: preview.previewId,
          // 预览 ID 只作短期校验；带上本次来源输入让任务可在服务进程重启后自行重建，
          // 服务端不会把原文写入正式书籍或来源包。
          sourceName: draft.sourceName.trim(),
          text: draft.text,
          ...(draft.splitPattern.trim() ? { splitPattern: draft.splitPattern.trim() } : {}),
        }),
      });
      reviewJobId.current = jobId(created);
      const result = await waitForJob(created);
      if (!mounted.current) return;
      setReview(result);
      void loadComparison(reviewJobId.current);
      setStage("review");
    } catch (cause) {
      if (!mounted.current) return;
      setError(errorMessage(cause, "蒸馏失败，请稍后重试。"));
      setStage("preview");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const hasReviewItems = Boolean(review && (review.rules.length || review.samples.length || Object.keys(review.fingerprint).length));
  // 规则与范文默认都待审；作者还没确认的条目都不会进入写作提示。
  const pendingReviewCount = review
    ? review.rules.filter((entry) => entry.status !== "confirmed").length + review.samples.filter((entry) => entry.status !== "confirmed").length
    : 0;
  // 来源 ≥2 时并列「共同技法 / 来源差异 / 不应迁移」三列，替代单来源的写法规则列；单来源保持原样。
  // 比较只取每个来源的最新任务；当前审阅的不是本来源最新任务时，它的规则不在比较里，退回单来源审阅。
  const multiSource = comparison !== null && comparison.sources.length >= 2
    && comparison.sources.some((source) => source.jobId === reviewJobId.current);
  const otherSelectedCount = Object.values(otherSelections).reduce((sum, ids) => sum + ids.length, 0);

  return (
    <section aria-label="文风自动蒸馏工作面" className="min-w-0 space-y-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">文风自动蒸馏</h1>
          <Badge variant="outline">蒸馏</Badge>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          从参考文本中提取写法规则和范文，逐条确认后再存入本书文风预设。
        </p>
        <div className="flex flex-wrap gap-1.5" aria-label="蒸馏阶段">
          {(["input", "preview", "review"] as const).map((item, index) => (
            <Badge key={item} variant={stage === item || (stage === "processing" && item === "review") ? "default" : "outline"}>
              {index + 1}. {item === "input" ? "输入" : item === "preview" ? "预览" : "审阅"}
            </Badge>
          ))}
        </div>
      </header>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && <p role="status" className="rounded-lg border border-border bg-muted/30 p-3 text-sm">{notice}</p>}

      {stage === "input" && (
        <Card>
          <CardHeader>
            <CardTitle>准备参考文本</CardTitle>
            <CardDescription>先预览处理范围，再决定是否开始。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-sm font-medium">来源名称</span>
                <Input aria-label="来源名称" value={draft.sourceName} onChange={(event) => updateDraft({ sourceName: event.target.value })} placeholder="例如：参考作品 A" disabled={busy} />
              </label>
              {/* 这个值会作为分章正则（splitPattern）交给后端切章；旧文案「章节范围提示 / 第1章至第20章」会诱导作者填范围。 */}
              <label className="space-y-1.5">
                <span className="text-sm font-medium">章节标题规则（可选，正则）</span>
                <Input
                  aria-label="章节标题规则（可选，正则）"
                  aria-describedby={splitPatternHintId}
                  value={draft.splitPattern}
                  onChange={(event) => updateDraft({ splitPattern: event.target.value })}
                  placeholder="^【\d+】(.*)"
                  spellCheck={false}
                  autoComplete="off"
                  disabled={busy}
                />
                <span id={splitPatternHintId} className="block text-xs text-muted-foreground">留空则自动识别『第X章』『Chapter X』等标题；只支持简单规则</span>
              </label>
            </div>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">粘贴参考文本</span>
              <Textarea aria-label="粘贴参考文本" value={draft.text} onChange={(event) => updateDraft({ text: event.target.value })} placeholder="粘贴要分析的章节或片段……" className="min-h-56 resize-y" disabled={busy} />
            </label>
            <Button type="button" className="gap-1.5" disabled={busy} onClick={() => void previewText()}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {busy ? "预览中…" : "预览处理范围"}
              {!busy && <ArrowRight className="size-4" />}
            </Button>
          </CardContent>
        </Card>
      )}

      {stage === "preview" && preview && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.72fr)]">
            <Card aria-label="处理范围摘要">
              <CardHeader>
                <CardTitle>处理范围</CardTitle>
                <CardDescription>预览不会改动本书文风预设。</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <MetricCard label="处理范围" value={coverageText(preview.coverage, preview.chapters)} />
                <MetricCard label="章节数" value={`${formatNumber(preview.chapterCount)} 章`} />
                <MetricCard label="字符数" value={`${formatNumber(preview.totalCharacters)} 字`} />
                <MetricCard label="预计输出" value={estimatedOutput(preview)} />
                {preview.estimate && (
                  <>
                    <MetricCard label="模型调用" value={`${formatNumber(preview.estimate.batchCount)} 次`} />
                    <MetricCard label="输出上限" value={`约 ${formatNumber(preview.estimate.maxOutputTokens)} token`} />
                    {preview.estimate.summary && (
                      <p aria-label="用量估算" className="text-xs text-muted-foreground sm:col-span-2">{preview.estimate.summary}</p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>来源包预览</CardTitle>
                <CardDescription>{preview.sourceName}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {preview.chapters.length > 0 ? (
                  <div className="divide-y divide-border rounded-lg border border-border/70">
                    {preview.chapters.slice(0, 8).map((chapter, index) => (
                      <div key={`${chapter.chapterNumber ?? index}-${chapter.title ?? "chapter"}`} className="flex items-center justify-between gap-3 p-3 text-sm">
                        <span className="min-w-0 truncate">{chapter.title ?? (chapter.chapterNumber ? `第 ${chapter.chapterNumber} 章` : `片段 ${index + 1}`)}</span>
                        {(chapter.characters ?? chapter.totalCharacters) !== undefined && <span className="shrink-0 text-xs text-muted-foreground">{formatNumber((chapter.characters ?? chapter.totalCharacters) ?? 0)} 字</span>}
                      </div>
                    ))}
                  </div>
                ) : <EmptyState text="后端尚未返回章节拆分预览，将按处理范围继续。" />}
                {preview.chapters.length > 8 && <p className="text-xs text-muted-foreground">已显示前 8 个章节，其余章节会一并处理。</p>}
                {preview.warnings.length > 0 && <WarningList warnings={preview.warnings} />}
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>确认后开始</CardTitle>
              <CardDescription>蒸馏完成后逐条确认，只有确认的条目会被采纳。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => { setStage("input"); setError(null); }}>
                <ArrowLeft className="size-4" />返回修改
              </Button>
              <Button type="button" disabled={busy} onClick={() => void startAndRememberJob()}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                {busy ? "准备中…" : "开始蒸馏"}
                {!busy && <ArrowRight className="size-4" />}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {stage === "processing" && (
        <Card>
          <CardContent className="space-y-3">
            <div className="flex min-h-16 items-center justify-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="size-5 animate-spin text-primary" />正在按章节批次抽取文风规则，完成后会自动进入审阅……
            </div>
            {progressBatches.length > 0 && <BatchProgress batches={progressBatches} />}
          </CardContent>
        </Card>
      )}

      {stage === "review" && review && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">审阅来源：{review.sourceName}</p>
              <p className="text-xs text-muted-foreground">只有确认过的规则和范文会被采纳。</p>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setStage("preview"); setError(null); setNotice(null); }}>
              <ArrowLeft className="size-3.5" />重新处理
            </Button>
          </div>
          {!adopted && pendingReviewCount > 0 && (
            <div role="status" aria-label="待审提醒" className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
              <p className="font-medium">{pendingReviewCount} 条待审，采纳前不会影响写作</p>
              <p className="text-xs text-muted-foreground">
                {review.recommendedRuleIds.length > 0
                  ? `其中 ${review.recommendedRuleIds.length} 条是可迁移、证据与原文逐字对得上的写法，可以一键采纳；作品专属和证据只部分对得上的条目需要逐条看。`
                  : "这次没有能一键采纳的条目，请逐条确认后再采纳。"}
              </p>
              {review.recommendedRuleIds.length > 0 && (
                <Button type="button" size="sm" disabled={busy || conflict} onClick={() => void adoptRecommended()}>
                  {busy && <Loader2 className="size-3.5 animate-spin" />}
                  采纳全部可迁移的高置信条目（{review.recommendedRuleIds.length}）
                </Button>
              )}
            </div>
          )}
          {review.stopReason && (review.jobStatus === "paused" || review.jobStatus === "failed") && (
            <div role="alert" aria-label="停下的原因" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>为什么停下：{review.stopReason.what}{review.stopReason.next ? ` 建议：${review.stopReason.next}` : ""}</span>
            </div>
          )}
          {review.conflicts.length > 0 && <WarningList warnings={review.conflicts} title="后端提示" />}
          {review.batches.length > 0 && (
            <Card aria-label="模型批次进度">
              <CardHeader>
                <CardTitle>模型批次</CardTitle>
                <CardDescription>
                  {review.jobStatus === "paused"
                    ? review.stopReason
                      ? "还有批次没跑完（原因见上方），可以先审阅已完成的部分，也可以继续。"
                      : "还有批次没跑完，可以先审阅已完成的部分，也可以继续。"
                    : "失败的批次不影响已完成的结果。"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <BatchProgress batches={review.batches} />
                <div className="flex flex-wrap gap-2">
                  {review.batches.some((batch) => batch.status === "pending" || batch.status === "running") && (
                    <Button type="button" size="sm" disabled={busy} onClick={() => void resumeJob(false)}>继续未完成批次</Button>
                  )}
                  {review.batches.some((batch) => batch.status === "failed") && (
                    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void resumeJob(true)}>重试失败批次</Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
          {compareError && <p className="text-xs text-muted-foreground">多来源比较暂不可用（{compareError}），以下按单个来源审阅。</p>}
          {multiSource && comparison && (
            <SourceComparison
              comparison={comparison}
              currentJobId={reviewJobId.current}
              disabled={busy}
              isConfirmed={isMemberConfirmed}
              onToggle={toggleMember}
            />
          )}
          {hasReviewItems ? (
            <div className={`grid gap-4 ${multiSource ? "lg:grid-cols-2" : "lg:grid-cols-3"}`}>
              {!multiSource && (
                <Card>
                  <CardHeader><CardTitle>写法规则</CardTitle><CardDescription>作品专属内容可以确认，但不会进入通用写法指南。</CardDescription></CardHeader>
                  <CardContent className="space-y-3">
                    {review.rules.length > 0 ? review.rules.map((entry, index) => <ReviewEntry key={entry.id} entry={entry} disabled={busy} onToggle={() => toggleEntry("rules", index)} />) : <EmptyState text="暂无可审阅的写法规则。" />}
                  </CardContent>
                </Card>
              )}
              <Card>
                <CardHeader><CardTitle>范文</CardTitle><CardDescription>只有确认过的范文会被采纳。</CardDescription></CardHeader>
                <CardContent className="space-y-3">
                  {review.samples.length > 0 ? review.samples.map((entry, index) => <ReviewEntry key={entry.id} entry={entry} disabled={busy} onToggle={() => toggleEntry("samples", index)} />) : <EmptyState text="暂无可审阅的范文。" />}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>统计基线</CardTitle><CardDescription>只作写后对照，不是硬性指标。</CardDescription></CardHeader>
                <CardContent>
                  {displayableMetrics(review.fingerprint).length > 0 ? (
                    <div className="grid grid-cols-2 gap-2">
                      {displayableMetrics(review.fingerprint).map(([key, value]) => <div key={key} className="rounded-lg bg-muted/35 p-2"><span className="block text-xs text-muted-foreground">{metricLabel(key)}</span><span className="text-sm font-medium">{formatValue(value)}</span></div>)}
                    </div>
                  ) : <EmptyState text="暂无统计基线。" />}
                </CardContent>
              </Card>
            </div>
          ) : <EmptyState text="蒸馏任务已完成，但没有可审阅产物。可以返回预览检查文本范围。" />}
          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle>采纳到本书文风预设</CardTitle>
              <CardDescription>只采纳已确认的条目；作品专属条目不会进入通用写法指南。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                已确认：{confirmedRuleIds.length} 条规则，{confirmedSampleIds.length} 条范文
                {multiSource ? `；其他来源 ${otherSelectedCount} 条规则（选择有变化的来源会一并采纳）` : ""}
              </p>
              <Button type="button" disabled={busy || conflict || !hasReviewItems} onClick={() => void adopt()}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                {busy ? "采纳中…" : "采纳到本书文风预设"}
              </Button>
            </CardContent>
          </Card>
          {adopted && (
            <Card aria-label="生成本书专属技能">
              <CardHeader>
                <CardTitle>生成本书专属技能</CardTitle>
                <CardDescription>
                  把已确认的通用写法规则汇总成本书技能，叙述者写本书时会用上；重新生成会覆盖旧版。
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" disabled={skillBusy} onClick={() => void exportSkill()}>
                  {skillBusy && <Loader2 className="size-3.5 animate-spin" />}
                  {skillExport ? "重新生成本书专属技能" : "生成本书专属技能"}
                </Button>
                {skillExport && (
                  <>
                    <p role="status" className="text-xs text-muted-foreground">
                      已生成本书技能（{skillExport.ruleCount} 条规则{skillExport.sourceTitles.length > 0 ? `，来源：${skillExport.sourceTitles.join("、")}` : ""}）
                    </p>
                    <Button type="button" size="sm" variant="outline" disabled={!skillExport.content} onClick={() => void copySkillContent()}>
                      {copied ? "已复制" : "复制技能内容"}
                    </Button>
                  </>
                )}
                {skillError && <p role="alert" className="text-xs text-destructive">{skillError}</p>}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </section>
  );
}

const BATCH_STATUS_LABELS: Record<StyleDistillationBatchView["status"], string> = {
  pending: "待处理",
  running: "处理中",
  done: "已完成",
  failed: "失败",
};

function chapterSpan(numbers: readonly number[]): string {
  if (numbers.length === 0) return "未知章节";
  const first = numbers[0];
  const last = numbers[numbers.length - 1];
  return first === last ? `第 ${first} 章` : `第 ${first}–${last} 章`;
}

function BatchProgress({ batches }: { batches: readonly StyleDistillationBatchView[] }) {
  const finished = batches.filter((batch) => batch.status === "done" || batch.status === "failed").length;
  const failed = batches.filter((batch) => batch.status === "failed").length;
  const rejected = batches.reduce((sum, batch) => sum + batch.rejectedRules.length, 0);
  const percent = batches.length > 0 ? Math.round((finished / batches.length) * 100) : 0;
  return (
    <div className="space-y-2" aria-label="批次进度">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          已结束 {finished}/{batches.length} 批{failed > 0 ? `，其中 ${failed} 批失败` : ""}
          {rejected > 0 ? `；${rejected} 条模型规则因证据未在原文找到被丢弃` : ""}
        </span>
        <span>{percent}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
      </div>
      <ul className="space-y-1.5 text-sm">
        {batches.map((batch) => (
          <li key={batch.id} className="rounded-md border border-border/60 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{chapterSpan(batch.chapterNumbers)}</span>
              <Badge variant={batch.status === "failed" ? "destructive" : batch.status === "done" ? "secondary" : "outline"}>{BATCH_STATUS_LABELS[batch.status]}</Badge>
              {batch.status === "done" && batch.explanation && <Badge variant="outline">需关注</Badge>}
              {batch.status === "done" && <span className="text-xs text-muted-foreground">新增 {batch.ruleCount} 条待审规则</span>}
            </div>
            {batch.explanation && (
              <p className={`mt-1 text-xs ${batch.status === "failed" ? "text-destructive" : "text-foreground"}`}>
                {batch.status === "failed" ? "失败原因" : "需要关注"}：{batch.explanation.what}{batch.explanation.next ? ` 建议：${batch.explanation.next}` : ""}
              </p>
            )}
            {batch.rejectedRules.length > 0 && (
              <details className="mt-1 text-xs">
                <summary className="cursor-pointer text-muted-foreground">查看被丢弃的规则（{batch.rejectedRules.length} 条）</summary>
                <ul className="mt-1 space-y-1 pl-2">
                  {batch.rejectedRules.map((rule, index) => (
                    <li key={`${batch.id}-rejected-${index}`} className="rounded border border-border/50 p-1.5">
                      <p>{rule.text}</p>
                      <p className="text-muted-foreground">模型给的证据：{rule.evidence}</p>
                      {rule.reason && <p className="text-muted-foreground">原因：{rule.reason}</p>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {batch.issues.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {batch.issues.map((issue, index) => <li key={`${batch.id}-${index}`}>{issue}</li>)}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ComparisonMemberRow({
  member,
  current,
  confirmed,
  disabled,
  onToggle,
}: {
  member: StyleComparisonMemberView;
  current: boolean;
  confirmed: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="space-y-1 rounded-md border border-border/60 bg-background/60 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">出处：{member.sourceName}</Badge>
        {current && <Badge variant="secondary">本次</Badge>}
        <Badge variant={confirmed ? "default" : "outline"}>{confirmed ? "已确认" : "待审"}</Badge>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm leading-6">{member.text}</p>
      <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">证据：{member.evidence}</p>
      <Button
        type="button"
        size="xs"
        variant={confirmed ? "outline" : "ghost"}
        disabled={disabled || !member.jobId}
        aria-label={`${confirmed ? "撤回确认" : "确认"}（${member.sourceName}）：${member.text}`}
        onClick={onToggle}
      >
        {confirmed ? <Check className="size-3" /> : null}
        {confirmed ? "撤回确认" : "确认这条"}
      </Button>
    </div>
  );
}

function SourceComparison({
  comparison,
  currentJobId,
  disabled,
  isConfirmed,
  onToggle,
}: {
  comparison: StyleComparisonView;
  currentJobId: string | null;
  disabled: boolean;
  isConfirmed: (member: StyleComparisonMemberView) => boolean;
  onToggle: (member: StyleComparisonMemberView) => void;
}) {
  const row = (member: StyleComparisonMemberView) => (
    <ComparisonMemberRow
      key={`${member.jobId ?? member.sourceId}-${member.ruleId}`}
      member={member}
      current={member.jobId === currentJobId}
      confirmed={isConfirmed(member)}
      disabled={disabled}
      onToggle={() => onToggle(member)}
    />
  );
  return (
    <section aria-label="多来源比较" className="space-y-2">
      <div>
        <p className="text-sm font-medium">多来源比较：{comparison.sources.map((source) => source.sourceName).join("、")}</p>
        <p className="text-xs text-muted-foreground">
          每个来源取最近一次蒸馏，相似的规则会自动分到一组，是否采纳仍逐条确认。
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card aria-label="共同技法">
          <CardHeader>
            <CardTitle>共同技法（{comparison.common.length}）</CardTitle>
            <CardDescription>至少两个来源都有的可迁移写法，最值得优先确认。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {comparison.common.length > 0 ? comparison.common.map((group, index) => (
              <div key={`common-${index}`} className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary">{ruleCategoryLabel(group.category)}</Badge>
                  <Badge variant="outline">{new Set(group.members.map((member) => member.sourceId)).size} 个来源</Badge>
                </div>
                <p className="text-sm font-medium leading-6">{group.text}</p>
                <div className="space-y-2">{group.members.map(row)}</div>
              </div>
            )) : <EmptyState text="各来源之间没有足够相似的可迁移写法。" />}
          </CardContent>
        </Card>
        <Card aria-label="来源差异">
          <CardHeader>
            <CardTitle>来源差异（{comparison.differences.reduce((sum, entry) => sum + entry.rules.length, 0)}）</CardTitle>
            <CardDescription>只在一个来源出现的可迁移写法，按来源分列。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {comparison.differences.length > 0 ? comparison.differences.map((entry) => (
              <div key={`diff-${entry.sourceId}`} className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">仅见于「{entry.sourceName}」</p>
                {entry.rules.map((member) => (
                  <div key={`diff-${entry.sourceId}-${member.ruleId}`} className="space-y-1">
                    <Badge variant="outline">{ruleCategoryLabel(member.category)}</Badge>
                    {row(member)}
                  </div>
                ))}
              </div>
            )) : <EmptyState text="没有只属于单个来源的可迁移写法。" />}
          </CardContent>
        </Card>
        <Card aria-label="不应迁移">
          <CardHeader>
            <CardTitle>不应迁移（{comparison.nonTransferable.length}）</CardTitle>
            <CardDescription>作品专属条目，确认后也不会进入通用写法指南。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {comparison.nonTransferable.length > 0 ? comparison.nonTransferable.map((member) => (
              <div key={`non-${member.jobId ?? member.sourceId}-${member.ruleId}`} className="space-y-1">
                <Badge variant="outline">{ruleCategoryLabel(member.category)} · 作品专属</Badge>
                {row(member)}
              </div>
            )) : <EmptyState text="没有标为作品专属的条目。" />}
          </CardContent>
        </Card>
      </div>
      {comparison.statistics.length > 0 && <SourceStatistics statistics={comparison.statistics} row={row} />}
    </section>
  );
}

/**
 * 各来源统计对比：数值按来源并列，基线规则按来源分列。不合并、不给结论——
 * 这些规则由统计数值套模板生成，相同文案不代表相同写法。
 */
function SourceStatistics({
  statistics,
  row,
}: {
  statistics: StyleComparisonView["statistics"];
  row: (member: StyleComparisonMemberView) => ReactNode;
}) {
  const metricKeys = Object.keys(METRIC_LABELS).filter((key) => statistics.some((entry) => key in entry.metrics));
  return (
    <Card aria-label="各来源统计对比">
      <CardHeader>
        <CardTitle>各来源统计对比</CardTitle>
        <CardDescription>
          各来源的统计基线并列对照，只作写后参考，不是硬性指标。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {metricKeys.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th scope="col" className="py-1.5 pr-3 font-medium text-muted-foreground">指标</th>
                  {statistics.map((entry) => <th key={entry.sourceId} scope="col" className="py-1.5 pr-3 font-medium">{entry.sourceName}</th>)}
                </tr>
              </thead>
              <tbody>
                {metricKeys.map((key) => (
                  <tr key={key} className="border-b border-border/50">
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal text-muted-foreground">{metricLabel(key)}</th>
                    {statistics.map((entry) => (
                      <td key={entry.sourceId} className="py-1.5 pr-3 tabular-nums">{key in entry.metrics ? formatValue(entry.metrics[key]) : "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState text="各来源都没有统计基线。" />}
        <div className="grid gap-4 lg:grid-cols-3">
          {statistics.map((entry) => (
            <div key={entry.sourceId} className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">「{entry.sourceName}」的基线规则</p>
              {entry.baselineRules.length > 0 ? entry.baselineRules.map(row) : <EmptyState text="没有基线规则。" />}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return <Card size="sm" className="min-w-0"><CardContent className="space-y-1"><p className="text-xs text-muted-foreground">{label}</p><p className="break-words text-sm font-semibold">{value}</p></CardContent></Card>;
}

function EmptyState({ text }: { text: string }) {
  return <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">{text}</p>;
}

function WarningList({ warnings, title = "处理提醒" }: { warnings: readonly string[]; title?: string }) {
  return <div className="space-y-1 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm"><p className="font-medium">{title}</p><ul className="list-disc space-y-1 pl-5 text-muted-foreground">{warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></div>;
}
