import { useEffect, useMemo, useRef, useState } from "react";
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
}

export type StyleDistillationReviewStatus = "needs-review" | "confirmed";
export type StyleDistillationTransfer = "transferable" | "source-only";

export interface StyleDistillationRule {
  readonly id: string;
  readonly text: string;
  readonly evidence: string;
  readonly transfer: StyleDistillationTransfer;
  readonly status: StyleDistillationReviewStatus;
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
  if (!previewId) throw new Error("预览响应缺少 previewId，请让宿主更新文风蒸馏接口后重试。");
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
  };
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
  if (count !== null) return `约 ${formatNumber(count)} 条审阅项与 1 份统计指纹`;
  return "文风规则、范文与统计指纹";
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
      if (!id) throw new Error("蒸馏任务没有返回任务 ID，无法继续等待。");
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
      setStage("review");
    } catch (cause) {
      if (!mounted.current) return;
      const message = errorMessage(cause, "继续模型批次失败，请稍后重试。");
      setError(errorStatus(cause) === 422
        ? `${message} 可在叙述者对话中让叙述者带上任务 ID 调用 style.distill_start 继续同一任务。`
        : message);
      setStage("review");
    } finally {
      if (mounted.current) setBusy(false);
    }
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
      setError("缺少蒸馏任务 ID，无法采纳。请重新开始蒸馏。");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetchJson<unknown>(paths.adopt(reviewJobId.current), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: id,
          confirmedRuleIds,
          confirmedSampleIds,
        }),
      });
      if (!mounted.current) return;
      setNotice("已采纳到本书文风预设。作品专属内容仍保留在来源包中，不会进入通用写法指南。");
      setAdopted(true);
      setSkillExport(null);
      setSkillError(null);
      setCopied(false);
      onAdopted?.(response);
    } catch (cause) {
      if (!mounted.current) return;
      if (errorStatus(cause) === 409) {
        setConflict(true);
        setError("采纳冲突：本书文风预设已有新版本。请重新蒸馏并确认当前选择后再采纳，避免覆盖他人的修改。");
      } else {
        setError(errorMessage(cause, "采纳失败，当前审阅选择已保留，请重试。"));
      }
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

  return (
    <section aria-label="文风自动蒸馏工作面" className="min-w-0 space-y-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">文风自动蒸馏</h1>
          <Badge variant="outline">T2.2</Badge>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          从作者指定的参考文本中提取写法规则、范文和统计指纹。所有来源内容先进入审阅区，确认后再写入本书文风预设。
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
            <CardDescription>输入只用于本次蒸馏。先预览处理范围，再决定是否生成审阅包。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-sm font-medium">来源名称</span>
                <Input aria-label="来源名称" value={draft.sourceName} onChange={(event) => updateDraft({ sourceName: event.target.value })} placeholder="例如：参考作品 A" disabled={busy} />
              </label>
              <label className="space-y-1.5">
                <span className="text-sm font-medium">章节范围提示</span>
                <Input aria-label="章节范围提示" value={draft.splitPattern} onChange={(event) => updateDraft({ splitPattern: event.target.value })} placeholder="可选，例如：第1章至第20章" disabled={busy} />
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
                <CardDescription>预览只读取参考文本，不会写入本书文风预设。</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <MetricCard label="处理范围" value={coverageText(preview.coverage, preview.chapters)} />
                <MetricCard label="章节数" value={`${formatNumber(preview.chapterCount)} 章`} />
                <MetricCard label="字符数" value={`${formatNumber(preview.totalCharacters)} 字`} />
                <MetricCard label="预计输出" value={estimatedOutput(preview)} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>来源包预览</CardTitle>
                <CardDescription>{preview.sourceName} · 将生成审阅用来源包，不会直接改写本书预设。</CardDescription>
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
              <CardDescription>蒸馏完成后会进入逐条审阅，确认项才会进入采纳请求。</CardDescription>
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
              <p className="text-xs text-muted-foreground">确认规则或范文后才会随采纳请求发送；待审项目不会被选中。</p>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setStage("preview"); setError(null); setNotice(null); }}>
              <ArrowLeft className="size-3.5" />重新处理
            </Button>
          </div>
          {review.conflicts.length > 0 && <WarningList warnings={review.conflicts} title="后端提示" />}
          {review.batches.length > 0 && (
            <Card aria-label="模型批次进度">
              <CardHeader>
                <CardTitle>模型批次</CardTitle>
                <CardDescription>
                  {review.jobStatus === "paused"
                    ? "还有未完成的批次；当前结果含已完成批次与确定性基线，可以先审阅，也可以继续。"
                    : "每批结果单独保存；失败批次不影响已完成批次与确定性基线。"}
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
          {hasReviewItems ? (
            <div className="grid gap-4 lg:grid-cols-3">
              <Card>
                <CardHeader><CardTitle>写法规则</CardTitle><CardDescription>确认后按规则 ID 发送。作品专属内容可以确认，但不会进入通用指南。</CardDescription></CardHeader>
                <CardContent className="space-y-3">
                  {review.rules.length > 0 ? review.rules.map((entry, index) => <ReviewEntry key={entry.id} entry={entry} disabled={busy} onToggle={() => toggleEntry("rules", index)} />) : <EmptyState text="暂无可审阅的写法规则。" />}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>范文</CardTitle><CardDescription>范文保留来源和场景证据，待审范文不会随采纳请求发送。</CardDescription></CardHeader>
                <CardContent className="space-y-3">
                  {review.samples.length > 0 ? review.samples.map((entry, index) => <ReviewEntry key={entry.id} entry={entry} disabled={busy} onToggle={() => toggleEntry("samples", index)} />) : <EmptyState text="暂无可审阅的范文。" />}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>统计指纹</CardTitle><CardDescription>仅作为写后对照参考，不把数字当成机械句长配额。</CardDescription></CardHeader>
                <CardContent>
                  {displayableMetrics(review.fingerprint).length > 0 ? (
                    <div className="grid grid-cols-2 gap-2">
                      {displayableMetrics(review.fingerprint).map(([key, value]) => <div key={key} className="rounded-lg bg-muted/35 p-2"><span className="block text-xs text-muted-foreground">{metricLabel(key)}</span><span className="text-sm font-medium">{formatValue(value)}</span></div>)}
                    </div>
                  ) : <EmptyState text="暂无统计指纹。" />}
                </CardContent>
              </Card>
            </div>
          ) : <EmptyState text="蒸馏任务已完成，但没有可审阅产物。可以返回预览检查文本范围。" />}
          <Card className="border-primary/30">
            <CardHeader>
              <CardTitle>采纳到本书文风预设</CardTitle>
              <CardDescription>只发送已确认项目。作品专属项目可以确认并保存在来源证据中，但不会进入本书通用写法指南；待审项目不会被选中。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">已确认：{confirmedRuleIds.length} 条规则，{confirmedSampleIds.length} 条范文</p>
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
                  把文风预设里「已确认且可迁移」的写法规则汇总成本书技能（.novelfork/skills/book-style-memory/SKILL.md），
                  叙述者写作本书时按它加载；待审与作品专属条目不进入。重新生成会覆盖同一文件。
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
                      已写入 .novelfork/skills/{skillExport.slug}/SKILL.md（{skillExport.ruleCount} 条规则{skillExport.sourceTitles.length > 0 ? `，来源：${skillExport.sourceTitles.join("、")}` : ""}）
                    </p>
                    <Button type="button" size="sm" variant="outline" disabled={!skillExport.content} onClick={() => void copySkillContent()}>
                      {copied ? "已复制" : "复制 SKILL.md 内容"}
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
  const percent = batches.length > 0 ? Math.round((finished / batches.length) * 100) : 0;
  return (
    <div className="space-y-2" aria-label="批次进度">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>已结束 {finished}/{batches.length} 批{failed > 0 ? `，其中 ${failed} 批失败` : ""}</span>
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
              {batch.status === "done" && <span className="text-xs text-muted-foreground">新增 {batch.ruleCount} 条待审规则</span>}
            </div>
            {batch.explanation && (
              <p className="mt-1 text-xs text-destructive">失败原因：{batch.explanation.what}{batch.explanation.next ? ` 建议：${batch.explanation.next}` : ""}</p>
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

function MetricCard({ label, value }: { label: string; value: string }) {
  return <Card size="sm" className="min-w-0"><CardContent className="space-y-1"><p className="text-xs text-muted-foreground">{label}</p><p className="break-words text-sm font-semibold">{value}</p></CardContent></Card>;
}

function EmptyState({ text }: { text: string }) {
  return <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">{text}</p>;
}

function WarningList({ warnings, title = "处理提醒" }: { warnings: readonly string[]; title?: string }) {
  return <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm"><p className="font-medium">{title}</p><ul className="list-disc space-y-1 pl-5 text-muted-foreground">{warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></div>;
}
