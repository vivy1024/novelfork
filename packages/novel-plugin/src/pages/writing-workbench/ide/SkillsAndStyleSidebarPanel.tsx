/**
 * 技能与文风侧栏面板。
 *
 * 核心能力：
 * 1. 【写作技能】：管理本作品启用的 Writing Skills，支持一键导入酒馆（SillyTavern）Chat Completion 预设；
 * 2. 【文风】：编辑本书预设，提供参考样文统计提取与直方图。
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Sparkles,
  Palette,
  Wand2,
  RefreshCw,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  FileCode2,
  ClipboardList,
  BookMarked,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { WritingSkillsPanel } from "../WritingSkillsPanel";
import { StylePresetEditor } from "./StylePresetEditor";
import { PendingReviewPanel } from "../PendingReviewPanel";
import { ApiRequestError, fetchJson, putApi } from "@/hooks/use-api";
import { toast } from "@/components/ui/toast";
import {
  importTavernPreset,
  TavernPresetImportError,
  type TavernPresetImportResult,
} from "../../../engine/writing-skills/sillytavern-preset";

export interface SkillsAndStyleSidebarPanelProps {
  bookId?: string;
  /** 「待确认」跳转回调（聚合面板用）；宿主未注入的入口只显示去哪决定的文案。 */
  onOpenJingweiEntry?: (entryId: string) => void;
  onOpenVoiceReview?: (entryId: string) => void;
  onOpenDistill?: () => void;
  onOpenEvents?: () => void;
  onOpenVault?: () => void;
  onOpenChapter?: (chapterNumber: number) => void;
}

type TabKey = "skills" | "style";

interface StyleProfile {
  readonly avgSentenceLength?: number;
  readonly sentenceLengthStdDev?: number;
  readonly sentenceLengthBurstiness?: number;
  readonly shortSentenceRatio?: number;
  readonly longSentenceRatio?: number;
  readonly avgParagraphLength?: number;
  readonly dialogueRatio?: number;
  readonly vocabularyDiversity?: number;
  readonly weakAdverbPer1000?: number;
  readonly sampleCharCount?: number;
  readonly sampleSentenceCount?: number;
  readonly sentenceLengthBuckets?: readonly number[];
}

const BUCKET_LABELS = ["≤5", "6-10", "11-15", "16-20", "21-30", "31+"] as const;

function percent(value: number | undefined): string {
  return value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded bg-muted/40 p-1.5" title={hint}>
      <span className="block text-2xs text-muted-foreground">{label}</span>
      <span className="text-xs font-semibold">{value}</span>
    </div>
  );
}

function SentenceLengthHistogram({ buckets }: { buckets: readonly number[] }) {
  const total = buckets.reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;

  const max = Math.max(...buckets, 1);
  const barWidth = 26;
  const gap = 6;
  const chartHeight = 44;
  const svgWidth = buckets.length * (barWidth + gap) - gap;

  return (
    <div className="space-y-1">
      <p className="text-2xs text-muted-foreground">句长分布（共 {total} 句）</p>
      <svg width={svgWidth} height={chartHeight + 14} className="block" role="img" aria-label="句长分布直方图">
        {buckets.map((count, index) => {
          const barHeight = (count / max) * chartHeight;
          const x = index * (barWidth + gap);
          return (
            <g key={BUCKET_LABELS[index] ?? index}>
              <rect x={x} y={chartHeight - barHeight} width={barWidth} height={barHeight} rx={2} className="fill-primary/60" />
              <text
                x={x + barWidth / 2}
                y={chartHeight + 11}
                textAnchor="middle"
                fontSize={8}
                className="fill-muted-foreground"
              >
                {BUCKET_LABELS[index] ?? ""}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function SkillsAndStyleSidebarPanel({ bookId, onOpenJingweiEntry, onOpenVoiceReview, onOpenDistill, onOpenEvents, onOpenVault, onOpenChapter }: SkillsAndStyleSidebarPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("skills");
  if (!bookId) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
        先打开一本书，再查看技能与文风。
      </div>
    );
  }
  return (
    <BookSkillsAndStyleSidebarPanel
      key={bookId}
      bookId={bookId}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      onOpenJingweiEntry={onOpenJingweiEntry}
      onOpenVoiceReview={onOpenVoiceReview}
      onOpenDistill={onOpenDistill}
      onOpenEvents={onOpenEvents}
      onOpenVault={onOpenVault}
      onOpenChapter={onOpenChapter}
    />
  );
}

function BookSkillsAndStyleSidebarPanel({ bookId, activeTab, setActiveTab, onOpenJingweiEntry, onOpenVoiceReview, onOpenDistill, onOpenEvents, onOpenVault, onOpenChapter }: {
  bookId: string;
  activeTab: TabKey;
  setActiveTab: (tab: TabKey) => void;
  onOpenJingweiEntry?: (entryId: string) => void;
  onOpenVoiceReview?: (entryId: string) => void;
  onOpenDistill?: () => void;
  onOpenEvents?: () => void;
  onOpenVault?: () => void;
  onOpenChapter?: (chapterNumber: number) => void;
}) {
  const [profile, setProfile] = useState<StyleProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [sampleText, setSampleText] = useState("");
  const [distilling, setDistilling] = useState(false);
  const [distillNotice, setDistillNotice] = useState<string | null>(null);
  const [distillError, setDistillError] = useState<string | null>(null);
  const [showTavernImport, setShowTavernImport] = useState(false);
  const [presetRefreshKey, setPresetRefreshKey] = useState(0);
  const [presetBusy, setPresetBusy] = useState(false);
  const [pendingReviewTotal, setPendingReviewTotal] = useState<number | null>(null);
  const [showPendingReview, setShowPendingReview] = useState(false);
  const mounted = useRef(false);
  const profileRequest = useRef(0);
  const pendingReviewRequest = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; profileRequest.current += 1; pendingReviewRequest.current += 1; };
  }, []);

  // 「待确认」横幅：聚合六类待处理来源的合计（声线/文风规则/伏笔/待审事件/事实/金库改稿）。
  // 只读计数；点开看清单。接口或书籍环境给不出合计时静默不显示，不伪装成功。
  const loadPendingReviewTotal = useCallback(async () => {
    const request = ++pendingReviewRequest.current;
    try {
      const data = await fetchJson<{ total?: unknown }>(
        `/api/books/${encodeURIComponent(bookId)}/pending-review?limit=1`,
      );
      if (mounted.current && request === pendingReviewRequest.current) {
        setPendingReviewTotal(typeof data.total === "number" ? data.total : null);
      }
    } catch {
      if (mounted.current && request === pendingReviewRequest.current) setPendingReviewTotal(null);
    }
  }, [bookId]);

  useEffect(() => { void loadPendingReviewTotal(); }, [loadPendingReviewTotal]);

  // 文风预设或金库采纳保存后刷新合计；面板自身也监听同一事件做逐项刷新。
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ bookId?: string }>).detail;
      if (!detail?.bookId || detail.bookId === bookId) void loadPendingReviewTotal();
    };
    window.addEventListener("novelfork:style-preset-updated", handler);
    return () => window.removeEventListener("novelfork:style-preset-updated", handler);
  }, [bookId, loadPendingReviewTotal]);

  const loadProfile = useCallback(async () => {
    const request = ++profileRequest.current;
    setProfileLoading(true);
    setProfileError(null);
    try {
      const data = await fetchJson<{ profile?: StyleProfile | null }>(
        `/api/books/${encodeURIComponent(bookId)}/style/profile`,
      );
      if (mounted.current && request === profileRequest.current) setProfile(data.profile ?? null);
    } catch (cause) {
      if (mounted.current && request === profileRequest.current) {
        setProfileError(cause instanceof Error ? cause.message : "读取文风基线失败");
      }
    } finally {
      if (mounted.current && request === profileRequest.current) setProfileLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    if (activeTab === "style") void loadProfile();
  }, [activeTab, loadProfile]);

  const handleDistill = useCallback(async () => {
    if (distilling || presetBusy || !sampleText.trim()) return;
    profileRequest.current += 1;
    setProfileLoading(false);
    setDistilling(true);
    setDistillError(null);
    setDistillNotice(null);
    try {
      const data = await fetchJson<{ profile?: StyleProfile; persisted?: boolean }>(
        `/api/books/${encodeURIComponent(bookId)}/style/distill`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ samples: [sampleText] }),
        },
      );
      if (data.persisted) {
        window.dispatchEvent(new CustomEvent("novelfork:style-preset-updated", { detail: { bookId } }));
      }
      if (!mounted.current) return;
      profileRequest.current += 1;
      setProfileLoading(false);
      setProfileError(null);
      if (data.profile) setProfile(data.profile);
      if (data.persisted) setPresetRefreshKey((value) => value + 1);
      setDistillNotice(
        data.persisted
          ? "已更新统计基线，节奏分析与漂移检测已使用新基线。"
          : "已提取，但未保存统计基线。",
      );
      setSampleText("");
    } catch (cause) {
      if (mounted.current) setDistillError(cause instanceof Error ? cause.message : "提取失败");
    } finally {
      if (mounted.current) setDistilling(false);
    }
  }, [bookId, sampleText, distilling, presetBusy]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-card text-xs">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-2 py-1.5 bg-muted/20">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTab("skills")}
            className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              activeTab === "skills" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Sparkles className="size-3" />
            写作技能
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("style")}
            className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              activeTab === "style" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Palette className="size-3" />
            文风
          </button>
        </div>

        {activeTab === "skills" && (
          <Button
            size="xs"
            variant="outline"
            onClick={() => setShowTavernImport((v) => !v)}
            className="h-6 text-2xs gap-1"
          >
            <FileCode2 className="size-3 text-primary" />
            导入酒馆预设
          </Button>
        )}
      </div>

      {showTavernImport && (
        <TavernPresetImportSection
          bookId={bookId}
          onClose={() => setShowTavernImport(false)}
          onSuccess={() => {
            setShowTavernImport(false);
            toast("酒馆预设已转换为写作技能并导入。", "success");
          }}
        />
      )}

      {/* 待确认入口：六类「不确认就没生效」的产物的唯一汇总口。只在确有需要处理时提示。 */}
      {pendingReviewTotal !== null && pendingReviewTotal > 0 && !showPendingReview && (
        <button
          type="button"
          onClick={() => setShowPendingReview(true)}
          className="mx-2 mt-2 flex shrink-0 items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-left text-2xs text-amber-800 transition-colors hover:bg-amber-500/15 dark:text-amber-300"
        >
          <ClipboardList className="size-3.5 shrink-0" />
          <span className="flex-1">待确认 {pendingReviewTotal} 项：声线、文风规则、伏笔、事件与改稿等待你决定，不确认不生效。</span>
        </button>
      )}

      {showPendingReview && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <PendingReviewPanel
            bookId={bookId}
            onClose={() => setShowPendingReview(false)}
            onOpenStylePanel={() => {
              setActiveTab("style");
              setShowPendingReview(false);
            }}
            onOpenJingweiEntry={onOpenJingweiEntry}
            onOpenVoiceReview={onOpenVoiceReview}
            onOpenDistill={onOpenDistill}
            onOpenEvents={onOpenEvents}
            onOpenVault={onOpenVault}
            onOpenChapter={onOpenChapter}
          />
        </div>
      )}

      <div className={`min-h-0 flex-1 overflow-y-auto ${showPendingReview ? "hidden" : ""}`}>
        {activeTab === "skills" && (
          <div className="p-3">
            <WritingSkillsPanel bookId={bookId} />
          </div>
        )}

        {activeTab === "style" && (
          <div className="space-y-3 p-3">
            <StylePresetEditor bookId={bookId} refreshKey={presetRefreshKey} disabled={distilling} onBusyChange={setPresetBusy} />
            <div className="space-y-2 rounded-lg border border-border/80 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-medium">
                  <Wand2 className="size-3.5 text-primary" />
                  <span>当前统计基线</span>
                </div>
                <Button variant="ghost" size="xs" onClick={() => void loadProfile()} disabled={profileLoading || distilling} aria-label="刷新文风基线">
                  <RefreshCw className={`size-3 ${profileLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>

              {profileError && (
                <p role="alert" className="rounded border border-destructive/30 bg-destructive/5 p-2 text-2xs text-destructive">
                  {profileError}
                </p>
              )}

              {profile ? (
                <div className="grid grid-cols-3 gap-1.5 pt-1">
                  <Metric label="平均句长" value={profile.avgSentenceLength !== undefined ? `${profile.avgSentenceLength} 字` : "—"} />
                  <Metric label="句长标准差" value={profile.sentenceLengthStdDev !== undefined ? String(profile.sentenceLengthStdDev) : "—"} />
                  <Metric
                    label="爆发度"
                    value={profile.sentenceLengthBurstiness !== undefined ? String(profile.sentenceLengthBurstiness) : "—"}
                    hint="越接近 -1 表示句长越均质（AI 特征），大于 0 表示长短错落"
                  />
                  <Metric label="短句占比" value={percent(profile.shortSentenceRatio)} />
                  <Metric label="长句占比" value={percent(profile.longSentenceRatio)} />
                  <Metric label="对话占比" value={percent(profile.dialogueRatio)} />
                  <Metric
                    label="词汇丰富度"
                    value={profile.vocabularyDiversity !== undefined ? String(profile.vocabularyDiversity) : "—"}
                    hint="双字搭配去重率；越低越像固定词池循环"
                  />
                  <Metric label="段均长度" value={profile.avgParagraphLength !== undefined ? `${profile.avgParagraphLength} 字` : "—"} />
                  <Metric label="弱副词/千字" value={profile.weakAdverbPer1000 !== undefined ? String(profile.weakAdverbPer1000) : "—"} />
                </div>
              ) : profileLoading || profileError ? null : (
                <p className="text-2xs text-muted-foreground">尚未建立基线。用下方样文提取后即生效。</p>
              )}

              {profile?.sentenceLengthBuckets && profile.sentenceLengthBuckets.length > 0 && (
                <SentenceLengthHistogram buckets={profile.sentenceLengthBuckets} />
              )}
            </div>

            <StyleMemorySection
              bookId={bookId}
              disabled={distilling || presetBusy}
              onWritten={() => setPresetRefreshKey((value) => value + 1)}
            />

            <div className="space-y-2 rounded-lg border border-border/80 p-3">
              <div className="flex items-center gap-1 font-medium">
                <Upload className="size-3 text-primary" />
                <span>从参考样文提取统计</span>
              </div>
              <p className="text-2xs text-muted-foreground">
                贴入你满意的参考正文（建议 500-2000 字）。只提取句长节奏、对话密度、词汇丰富度等可复用统计特征，
                不会把样文的专名、口癖或情节带进本书。
              </p>
              <Textarea
                value={sampleText}
                onChange={(event) => setSampleText(event.target.value)}
                placeholder="在此贴入参考样文…"
                className="min-h-[100px] resize-y text-xs"
                aria-label="参考样文"
              />
              <Button
                size="xs"
                className="w-full gap-1"
                disabled={distilling || presetBusy || !sampleText.trim()}
                onClick={() => void handleDistill()}
              >
                {distilling ? <Loader2 className="size-3 animate-spin" /> : <Wand2 className="size-3" />}
                {distilling ? "提取中…" : "提取并设为基线"}
              </Button>

              {distillNotice && (
                <div className="flex items-start gap-1 rounded border border-emerald-500/20 bg-emerald-500/10 p-2 text-2xs text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="mt-0.5 size-3 shrink-0" />
                  <span>{distillNotice}</span>
                </div>
              )}
              {distillError && (
                <div role="alert" className="flex items-start gap-1 rounded border border-destructive/20 bg-destructive/10 p-2 text-2xs text-destructive">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                  <span>{distillError}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 写法记忆（T3.5）：作者显式「记住这种写法」的小表单 ──────────────────────

interface MemoryPreviewRule {
  readonly text: string;
  readonly evidence: string;
  readonly origin: "note" | "inferred";
}

interface MemoryPreviewSample {
  readonly text: string;
  readonly sceneType: string;
}

interface MemoryPreview {
  readonly note: string;
  readonly rules: readonly MemoryPreviewRule[];
  readonly samples: readonly MemoryPreviewSample[];
  readonly sceneTypes: readonly string[];
  readonly stats: {
    readonly charCount: number;
    readonly sentenceCount: number;
    readonly avgSentenceLength: number;
    readonly shortSentenceRatio: number;
    readonly longSentenceRatio: number;
    readonly dialogueRatio: number;
  };
  readonly warnings: readonly string[];
}

const MEMORY_SCENE_OPTIONS = [
  ["general", "通用"],
  ["dialogue", "对话"],
  ["action", "动作"],
  ["description", "描写"],
  ["interiority", "心理"],
  ["transition", "过渡"],
] as const;

function sceneLabel(value: string): string {
  return MEMORY_SCENE_OPTIONS.find(([scene]) => scene === value)?.[1] ?? value;
}

/**
 * 「记住这种写法」：文本框 + 一句话注解 → 预览（纯统计推断，不调模型）→ 勾选确认后写入
 * 文风预设的「手动写法记忆」来源。普通聊天不写入，这里只服务作者的显式指令。
 */
function StyleMemorySection({
  bookId,
  disabled,
  onWritten,
}: {
  bookId: string;
  disabled: boolean;
  onWritten: () => void;
}) {
  const [note, setNote] = useState("");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<MemoryPreview | null>(null);
  const [checkedRules, setCheckedRules] = useState<ReadonlySet<number>>(new Set());
  const [checkedSamples, setCheckedSamples] = useState<ReadonlySet<number>>(new Set());
  const [sampleScenes, setSampleScenes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<"preview" | "confirm" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const toggle = (set: ReadonlySet<number>, index: number, apply: (next: ReadonlySet<number>) => void) => {
    const next = new Set(set);
    if (next.has(index)) next.delete(index); else next.add(index);
    apply(next);
  };

  const handlePreview = async () => {
    if (busy || disabled || !text.trim()) return;
    setBusy("preview");
    setError(null);
    setNotice(null);
    try {
      const data = await fetchJson<MemoryPreview>(`/api/books/${encodeURIComponent(bookId)}/style/memories/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      setPreview(data);
      setCheckedRules(new Set(data.rules.map((_, index) => index)));
      setCheckedSamples(new Set(data.samples.map((_, index) => index)));
      setSampleScenes(Object.fromEntries(data.samples.map((sample, index) => [index, sample.sceneType])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "预览失败，请重试。");
    } finally {
      setBusy(null);
    }
  };

  const handleConfirm = async () => {
    if (busy || disabled || !preview) return;
    setBusy("confirm");
    setError(null);
    setNotice(null);
    try {
      // 每次确认前读最新版本号；冲突由服务端拒绝，不会静默覆盖别处修改。
      const preset = await fetchJson<{ revision: string | null }>(`/api/books/${encodeURIComponent(bookId)}/style/preset`);
      const rules = [...checkedRules].sort((a, b) => a - b)
        .map((index) => preview.rules[index])
        .filter((rule): rule is MemoryPreviewRule => Boolean(rule))
        .map((rule) => ({ text: rule.text, evidence: rule.evidence }));
      const samples = [...checkedSamples].sort((a, b) => a - b)
        .map((index) => ({ sample: preview.samples[index], index }))
        .filter((entry): entry is { sample: MemoryPreviewSample; index: number } => Boolean(entry.sample))
        .map(({ sample, index }) => ({ text: sample.text, sceneType: sampleScenes[index] ?? sample.sceneType }));
      await fetchJson(`/api/books/${encodeURIComponent(bookId)}/style/memories/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: preset.revision, ...(note.trim() ? { note: note.trim() } : {}), rules, samples }),
      });
      setNotice(`已写入「手动写法记忆」来源：${rules.length} 条规则、${samples.length} 条例句。之后写章会按这些写法约束。`);
      setText("");
      setNote("");
      setPreview(null);
      window.dispatchEvent(new CustomEvent("novelfork:style-preset-updated", { detail: { bookId } }));
      onWritten();
    } catch (cause) {
      setError(cause instanceof ApiRequestError && cause.code === "STYLE_PRESET_CONFLICT"
        ? "文风预设在写入期间被别处更新，未写入任何内容；请再点一次「确认写入」。"
        : cause instanceof Error ? cause.message : "写入失败，请重试。");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-border/80 p-3">
      <div className="flex items-center gap-1 font-medium">
        <BookMarked className="size-3 text-primary" />
        <span>记住这种写法</span>
      </div>
      <p className="text-2xs text-muted-foreground">
        贴入一段你认可的正文，配一句话注解。预览会推断写法规则与例句（纯统计，不调模型），
        确认后写进文风预设的「手动写法记忆」来源；普通聊天不会写入。
      </p>
      <Input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="一句话注解：为什么要记住这种写法"
        className="h-7 text-xs"
        aria-label="写法注解"
        disabled={busy !== null || disabled}
      />
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="贴入一段示例正文…"
        className="min-h-[80px] resize-y text-xs"
        aria-label="写法示例文本"
        disabled={busy !== null || disabled}
      />
      <Button
        size="xs"
        className="w-full gap-1"
        disabled={busy !== null || disabled || !text.trim()}
        onClick={() => void handlePreview()}
      >
        {busy === "preview" ? <Loader2 className="size-3 animate-spin" /> : <Wand2 className="size-3" />}
        {busy === "preview" ? "预览中…" : "预览写法"}
      </Button>

      {preview && (
        <div className="space-y-2 rounded-md border border-primary/25 bg-primary/5 p-2" aria-label="写法预览">
          <p className="text-2xs text-muted-foreground">
            共 {preview.stats.sentenceCount} 句 · 平均句长 {preview.stats.avgSentenceLength} 字 · 对话占比 {Math.round(preview.stats.dialogueRatio * 100)}%；
            推断适用场景：{preview.sceneTypes.map(sceneLabel).join("、")}
          </p>
          {preview.rules.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-2xs font-medium">写法规则（勾选后写入）</p>
              {preview.rules.map((rule, index) => (
                <label key={`rule-${index}`} className="flex items-start gap-1.5 text-2xs">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={checkedRules.has(index)}
                    onChange={() => toggle(checkedRules, index, setCheckedRules)}
                    aria-label={`选中规则 ${index + 1}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1">
                      <Badge variant={rule.origin === "note" ? "secondary" : "outline"} className="text-2xs">
                        {rule.origin === "note" ? "注解" : "推断"}
                      </Badge>
                      <span className="leading-relaxed">{rule.text}</span>
                    </span>
                    <span className="block text-muted-foreground">{rule.evidence}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          {preview.samples.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-2xs font-medium">例句（写入为本书范文）</p>
              {preview.samples.map((sample, index) => (
                <div key={`sample-${index}`} className="flex items-start gap-1.5 text-2xs">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={checkedSamples.has(index)}
                    onChange={() => toggle(checkedSamples, index, setCheckedSamples)}
                    aria-label={`选中例句 ${index + 1}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="leading-relaxed">{sample.text}</span>
                    <label className="mt-0.5 flex items-center gap-1 text-muted-foreground">
                      场景
                      <select
                        className="rounded border border-border bg-background px-1 py-0.5 text-2xs"
                        value={sampleScenes[index] ?? sample.sceneType}
                        onChange={(event) => setSampleScenes((current) => ({ ...current, [index]: event.target.value }))}
                        aria-label={`例句 ${index + 1} 的场景类型`}
                      >
                        {MEMORY_SCENE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {preview.warnings.map((warning, index) => (
            <p key={`warning-${index}`} className="text-2xs text-amber-600 dark:text-amber-400">• {warning}</p>
          ))}
          <Button
            size="xs"
            className="w-full gap-1"
            disabled={busy !== null || disabled || (checkedRules.size === 0 && checkedSamples.size === 0)}
            onClick={() => void handleConfirm()}
          >
            {busy === "confirm" ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
            {busy === "confirm" ? "写入中…" : `确认写入文风预设（${checkedRules.size + checkedSamples.size} 项）`}
          </Button>
        </div>
      )}

      {notice && (
        <div className="flex items-start gap-1 rounded border border-emerald-500/20 bg-emerald-500/10 p-2 text-2xs text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="mt-0.5 size-3 shrink-0" />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div role="alert" className="flex items-start gap-1 rounded border border-destructive/20 bg-destructive/10 p-2 text-2xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

function TavernPresetImportSection({
  bookId,
  onClose,
  onSuccess,
}: {
  bookId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [jsonText, setJsonText] = useState("");
  const [parsedResult, setParsedResult] = useState<TavernPresetImportResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleParse = () => {
    setParseError(null);
    setParsedResult(null);
    if (!jsonText.trim()) return;
    try {
      const result = importTavernPreset(jsonText, "sillytavern-preset.json");
      setParsedResult(result);
    } catch (e) {
      setParseError(e instanceof TavernPresetImportError ? e.message : "JSON 解析失败，请确认是否为酒馆预设");
    }
  };

  const handleConfirmImport = async () => {
    if (!parsedResult || saving) return;
    setSaving(true);
    try {
      await putApi(`/api/books/${encodeURIComponent(bookId)}/writing-skills/${encodeURIComponent(parsedResult.skill.slug)}`, {
        content: parsedResult.skill.content,
      });
      onSuccess();
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "保存 Skill 失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-b border-border p-3 bg-muted/30 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-semibold text-xs text-foreground">
          <FileCode2 className="size-3.5 text-primary" />
          <span>导入酒馆预设 (SillyTavern Preset)</span>
        </div>
        <Button size="xs" variant="ghost" onClick={onClose} className="h-5 w-5 p-0"><X className="size-3" /></Button>
      </div>
      <p className="text-2xs text-muted-foreground leading-relaxed">
        粘贴酒馆 Chat Completion 预设 JSON。系统会自动展开宏变量（如 {"{{user}}"} $\to$ 作者）、识别并小说化提纯破限词，转换为标准写作技能。
      </p>

      {!parsedResult ? (
        <div className="space-y-2">
          <Textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            placeholder='在此粘贴酒馆预设 JSON 文本（{"prompts": [...], "prompt_order": [...]}）...'
            className="min-h-[90px] font-mono text-2xs"
          />
          {parseError && (
            <p role="alert" className="text-2xs text-destructive bg-destructive/10 p-2 rounded border border-destructive/20">
              {parseError}
            </p>
          )}
          <div className="flex justify-end gap-1.5">
            <Button size="xs" variant="ghost" onClick={onClose}>取消</Button>
            <Button size="xs" onClick={handleParse} disabled={!jsonText.trim()}>解析预设</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2 pt-1">
          <div className="rounded border border-border bg-card p-2.5 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold">{parsedResult.skill.name}</span>
              <Badge variant="secondary" className="text-2xs">{parsedResult.skill.slug}</Badge>
            </div>
            <div className="grid grid-cols-3 gap-1 text-2xs text-muted-foreground pt-1">
              <span>有效提示词: {parsedResult.stats.importedPrompts} 条</span>
              <span>跳过标记项: {parsedResult.stats.skippedMarkers} 个</span>
              <span>破限提纯: {parsedResult.stats.jailbreakCount} 处</span>
            </div>
            {parsedResult.warnings.length > 0 && (
              <div className="space-y-0.5 pt-1 text-2xs text-amber-600 dark:text-amber-400">
                {parsedResult.warnings.map((w, i) => (
                  <p key={i}>• {w}</p>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-1.5">
            <Button size="xs" variant="ghost" onClick={() => setParsedResult(null)}>返回重填</Button>
            <Button size="xs" onClick={() => void handleConfirmImport()} disabled={saving}>
              {saving ? <Loader2 className="size-3 animate-spin mr-1 inline" /> : null}
              确认导入为技能
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
