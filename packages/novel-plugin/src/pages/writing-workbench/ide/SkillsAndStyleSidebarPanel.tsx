/**
 * 技能与文风侧栏面板。
 *
 * 核心能力：
 * 1. 【写作技能】：管理本作品启用的 Writing Skills，支持一键导入酒馆（SillyTavern）Chat Completion 预设；
 * 2. 【文风指纹】：读写 `story/style_profile.json` 唯一权威源，提供参考样文统计蒸馏与直方图。
 */

import { useState, useEffect, useCallback } from "react";
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
  X,
  SlidersHorizontal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { WritingSkillsPanel } from "../WritingSkillsPanel";
import { fetchJson, putApi } from "@/hooks/use-api";
import { toast } from "@/components/ui/toast";
import {
  importTavernPreset,
  TavernPresetImportError,
  type TavernPresetImportResult,
} from "../../../engine/writing-skills/sillytavern-preset";

export interface SkillsAndStyleSidebarPanelProps {
  bookId?: string;
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

export function SkillsAndStyleSidebarPanel({ bookId }: SkillsAndStyleSidebarPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("skills");
  const [profile, setProfile] = useState<StyleProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [sampleText, setSampleText] = useState("");
  const [distilling, setDistilling] = useState(false);
  const [distillNotice, setDistillNotice] = useState<string | null>(null);
  const [distillError, setDistillError] = useState<string | null>(null);
  const [showTavernImport, setShowTavernImport] = useState(false);

  const loadProfile = useCallback(async () => {
    if (!bookId) return;
    setProfileLoading(true);
    setProfileError(null);
    try {
      const data = await fetchJson<{ profile?: StyleProfile | null }>(
        `/api/books/${encodeURIComponent(bookId)}/style/profile`,
      );
      setProfile(data.profile ?? null);
    } catch (cause) {
      setProfileError(cause instanceof Error ? cause.message : "读取文风基线失败");
    } finally {
      setProfileLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    if (activeTab === "style") void loadProfile();
  }, [activeTab, loadProfile]);

  const handleDistill = useCallback(async () => {
    if (!bookId || !sampleText.trim()) return;
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
      if (data.profile) setProfile(data.profile);
      setDistillNotice(
        data.persisted
          ? "已提取并写入 story/style_profile.json，节奏分析与漂移检测已使用新基线。"
          : "已提取，但未落盘。",
      );
      setSampleText("");
    } catch (cause) {
      setDistillError(cause instanceof Error ? cause.message : "提取失败");
    } finally {
      setDistilling(false);
    }
  }, [bookId, sampleText]);

  if (!bookId) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
        先打开一本书，再查看技能与文风。
      </div>
    );
  }

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
            文风指纹
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
            toast("酒馆预设已成功转换为 Writing Skill 并导入！", "success");
          }}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === "skills" && (
          <div className="p-3">
            <WritingSkillsPanel bookId={bookId} />
          </div>
        )}

        {activeTab === "style" && (
          <div className="space-y-3 p-3">
            <div className="space-y-2 rounded-lg border border-border/80 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-medium">
                  <Wand2 className="size-3.5 text-primary" />
                  <span>当前文风基线</span>
                </div>
                <Button variant="ghost" size="xs" onClick={() => void loadProfile()} disabled={profileLoading} aria-label="刷新文风基线">
                  <RefreshCw className={`size-3 ${profileLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>
              <p className="text-2xs text-muted-foreground">权威源：story/style_profile.json</p>

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
              ) : profileLoading ? null : (
                <p className="text-2xs text-muted-foreground">尚未建立基线。用下方样文提取后即生效。</p>
              )}

              {profile?.sentenceLengthBuckets && profile.sentenceLengthBuckets.length > 0 && (
                <SentenceLengthHistogram buckets={profile.sentenceLengthBuckets} />
              )}
            </div>

            <div className="space-y-2 rounded-lg border border-border/80 p-3">
              <div className="flex items-center gap-1 font-medium">
                <Upload className="size-3 text-primary" />
                <span>从参考样文提取</span>
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
                disabled={distilling || !sampleText.trim()}
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
        粘贴酒馆 Chat Completion 预设 JSON。系统会自动展开宏变量（如 {"{{user}}"} $\to$ 作者）、识别并小说化提纯破限词，转换为标准 Writing Skill。
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
