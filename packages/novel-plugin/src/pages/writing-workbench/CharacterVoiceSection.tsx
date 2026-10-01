/**
 * 角色声线区块 — 挂在角色卡里。
 *
 * 声线权威源是经纬角色条目的 fields_json.voice；本区块只通过
 * `/jingwei/entries/:entryId/voice` 读取、生成待审草稿、逐项确认，写入携带条目版本。
 * 待审与待补充的字段不会进入写作约束，界面上明确区分三种状态。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Loader2, MessageSquareQuote, RefreshCw, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ApiRequestError, fetchJson } from "@/hooks/use-api";

import {
  CHARACTER_VOICE_FIELD_META,
  type CharacterVoiceFieldKey,
  type CharacterVoiceFieldMeta,
} from "../../engine/writing-layers/character-voice";

type FieldStatus = "missing" | "needs-review" | "confirmed";

interface VoiceFieldPayload {
  value: string | string[];
  status: FieldStatus;
  source?: "card" | "dialogue" | "model" | "author";
  evidence?: string[];
}

interface StoredVoicePayload {
  schemaVersion: 1;
  fields: Partial<Record<CharacterVoiceFieldKey, VoiceFieldPayload>>;
}

interface VoiceWarning {
  code: string;
  message: string;
  explanation?: { whatHappened?: string; whyItMatters?: string; suggestedAction?: string };
}

interface VoiceResponse {
  entryId: string;
  version: number;
  voice: StoredVoicePayload;
  summary: { confirmed: number; needsReview: number; missing: number };
  draft?: {
    appliedKeys: CharacterVoiceFieldKey[];
    keptConfirmedKeys: CharacterVoiceFieldKey[];
    sampleCount: number;
    modelUsed: boolean;
    modelStatus?: "not-requested" | "unavailable" | "failed" | "applied";
  };
  warnings?: VoiceWarning[];
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; version: number; voice: StoredVoicePayload }
  | { status: "error"; message: string };

const SCAN_CHAPTERS = 10;

const STATUS_LABEL: Record<FieldStatus, string> = {
  missing: "待补充",
  "needs-review": "待审",
  confirmed: "已确认",
};

const SOURCE_LABEL: Record<NonNullable<VoiceFieldPayload["source"]>, string> = {
  card: "角色卡原句",
  dialogue: "对白统计",
  model: "模型增补",
  author: "作者填写",
};

function isVoiceResponse(value: unknown): value is VoiceResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const voice = record.voice as Record<string, unknown> | undefined;
  return typeof record.version === "number" && Boolean(voice) && typeof voice === "object" && typeof voice.fields === "object";
}

function fieldOf(voice: StoredVoicePayload, meta: CharacterVoiceFieldMeta): VoiceFieldPayload {
  return voice.fields[meta.key] ?? { value: meta.kind === "list" ? [] : "", status: "missing" };
}

function toInput(field: VoiceFieldPayload): string {
  return Array.isArray(field.value) ? field.value.join("\n") : field.value;
}

function fromInput(meta: CharacterVoiceFieldMeta, input: string): string | string[] {
  if (meta.kind === "list") return input.split("\n").map((item) => item.trim()).filter(Boolean);
  return input.trim();
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function isConflict(cause: unknown): boolean {
  return cause instanceof ApiRequestError && cause.status === 409;
}

function statusVariant(status: FieldStatus): "default" | "secondary" | "outline" {
  if (status === "confirmed") return "default";
  if (status === "needs-review") return "secondary";
  return "outline";
}

export interface CharacterVoiceSectionProps {
  bookId: string;
  entryId: string;
  /** 角色卡条目版本；外部保存角色卡后变化时重新读取声线。 */
  entryVersion?: number;
  /** 声线写入成功后回传最新存储形态，供角色卡整卡保存时带上，避免旧快照覆盖。 */
  onVoiceSaved?: (voice: StoredVoicePayload) => void;
}

export function CharacterVoiceSection({ bookId, entryId, entryVersion, onVoiceSaved }: CharacterVoiceSectionProps) {
  const path = `/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(entryId)}/voice`;
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [inputs, setInputs] = useState<Partial<Record<CharacterVoiceFieldKey, string>>>({});
  const [dirty, setDirty] = useState<ReadonlySet<CharacterVoiceFieldKey>>(new Set());
  const [samplesText, setSamplesText] = useState("");
  const [scanChapters, setScanChapters] = useState(true);
  const [useModel, setUseModel] = useState(false);
  const [busy, setBusy] = useState<"draft" | CharacterVoiceFieldKey | null>(null);
  const [actionError, setActionError] = useState<{ message: string; conflict: boolean } | null>(null);
  const [warnings, setWarnings] = useState<VoiceWarning[]>([]);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  /** 用服务端最新声线刷新输入框；仍在编辑（dirty）的字段保留作者输入。 */
  const applyServerVoice = useCallback((response: VoiceResponse, keep: ReadonlySet<CharacterVoiceFieldKey>) => {
    setLoadState({ status: "ready", version: response.version, voice: response.voice });
    setInputs((previous) => {
      const next: Partial<Record<CharacterVoiceFieldKey, string>> = {};
      for (const meta of CHARACTER_VOICE_FIELD_META) {
        next[meta.key] = keep.has(meta.key) ? previous[meta.key] ?? "" : toInput(fieldOf(response.voice, meta));
      }
      return next;
    });
    setDirty(new Set(keep));
  }, []);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoadState({ status: "loading" });
    setActionError(null);
    try {
      const response = await fetchJson<unknown>(path);
      if (requestId !== requestIdRef.current) return;
      if (!isVoiceResponse(response)) {
        setLoadState({ status: "error", message: "声线数据格式不对，无法显示。" });
        return;
      }
      applyServerVoice(response, new Set());
    } catch (cause) {
      if (requestId !== requestIdRef.current) return;
      setLoadState({ status: "error", message: errorMessage(cause, "声线读取失败") });
    }
  }, [applyServerVoice, path]);

  useEffect(() => {
    void load();
    return () => {
      requestIdRef.current += 1;
    };
  }, [load, entryVersion]);

  const summary = useMemo(() => {
    if (loadState.status !== "ready") return null;
    const counts = { confirmed: 0, needsReview: 0, missing: 0 };
    for (const meta of CHARACTER_VOICE_FIELD_META) {
      const status = fieldOf(loadState.voice, meta).status;
      if (status === "confirmed") counts.confirmed += 1;
      else if (status === "needs-review") counts.needsReview += 1;
      else counts.missing += 1;
    }
    return counts;
  }, [loadState]);

  const handleDraft = async () => {
    if (loadState.status !== "ready") return;
    setBusy("draft");
    setActionError(null);
    try {
      const response = await fetchJson<unknown>(`${path}/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedVersion: loadState.version,
          dialogueSamples: samplesText.split("\n").map((line) => line.trim()).filter(Boolean),
          scanChapters: scanChapters ? SCAN_CHAPTERS : 0,
          useModel,
        }),
      });
      if (!isVoiceResponse(response)) throw new Error("生成结果格式不对。");
      applyServerVoice(response, new Set());
      setWarnings(response.warnings ?? []);
      const applied = response.draft?.appliedKeys.length ?? 0;
      const kept = response.draft?.keptConfirmedKeys.length ?? 0;
      const modelFailed = response.draft?.modelStatus === "failed";
      setDraftNote(applied > 0
        ? `已写入 ${applied} 项待审草稿（共用到 ${response.draft?.sampleCount ?? 0} 句对白）${kept > 0 ? `，${kept} 项已确认的保持不变` : ""}。${modelFailed ? "这次模型增补失败，写入的只是规则初稿。" : ""}`
        : modelFailed ? "模型增补失败，规则初稿也没有新内容，声线未改动。" : "没有找到新的依据，声线未改动。");
      onVoiceSaved?.(response.voice);
    } catch (cause) {
      setActionError({ message: errorMessage(cause, "生成草稿失败"), conflict: isConflict(cause) });
    } finally {
      setBusy(null);
    }
  };

  const handleConfirm = async (meta: CharacterVoiceFieldMeta) => {
    if (loadState.status !== "ready") return;
    setBusy(meta.key);
    setActionError(null);
    try {
      const response = await fetchJson<unknown>(path, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedVersion: loadState.version,
          fields: { [meta.key]: { value: fromInput(meta, inputs[meta.key] ?? ""), status: "confirmed" } },
        }),
      });
      if (!isVoiceResponse(response)) throw new Error("保存结果格式不对。");
      const keep = new Set(dirty);
      keep.delete(meta.key);
      applyServerVoice(response, keep);
      onVoiceSaved?.(response.voice);
    } catch (cause) {
      setActionError({ message: errorMessage(cause, "保存声线失败"), conflict: isConflict(cause) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="border-sky-500/30 bg-sky-500/[0.03]" data-testid="character-voice-section">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquareQuote className="size-4 text-sky-600" />
              角色声线
              <Badge variant="secondary" className="text-2xs font-normal">写对白时的高优先级约束</Badge>
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              从角色卡与该角色的对白里提取，不凭空设定。只有「已确认」的项会约束写作；待审、待补充的项不会注入。
            </p>
          </div>
          <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => void load()} aria-label="重新载入声线">
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
        {summary ? (
          <div className="flex flex-wrap gap-1.5 pt-1" data-testid="character-voice-summary">
            <Badge variant="default" className="text-2xs font-normal">已确认 {summary.confirmed}</Badge>
            <Badge variant="secondary" className="text-2xs font-normal">待审 {summary.needsReview}</Badge>
            <Badge variant="outline" className="text-2xs font-normal">待补充 {summary.missing}</Badge>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {loadState.status === "loading" ? (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border/70 px-3 py-4 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />正在读取声线……
          </div>
        ) : loadState.status === "error" ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/[0.04] px-3 py-3 text-xs text-destructive">
            <span>{loadState.message}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>重试</Button>
          </div>
        ) : (
          <>
            <section className="space-y-2 rounded-md border border-border/50 bg-background/60 p-3" aria-label="生成声线草稿">
              <label htmlFor={`voice-samples-${entryId}`} className="text-xs font-medium text-muted-foreground">
                对白样本（可选，每行一句该角色的原话）
              </label>
              <Textarea
                id={`voice-samples-${entryId}`}
                value={samplesText}
                onChange={(event) => setSamplesText(event.target.value)}
                placeholder={"粘贴几句这个角色说过的话，越像本人越好"}
                className="min-h-[72px] text-sm"
              />
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch checked={scanChapters} onCheckedChange={setScanChapters} aria-label={`扫描最近 ${SCAN_CHAPTERS} 章正文对白`} />
                  扫描最近 {SCAN_CHAPTERS} 章正文对白
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch checked={useModel} onCheckedChange={setUseModel} aria-label="请模型增补" />
                  请模型增补（须附原文依据）
                </label>
                <Button size="sm" className="ml-auto gap-1.5" onClick={() => void handleDraft()} disabled={busy !== null}>
                  {busy === "draft" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  生成草稿
                </Button>
              </div>
              <p className="text-2xs text-muted-foreground">生成读取的是已保存的角色卡；刚改的内容请先保存。草稿只写成「待审」，已确认的项不会被覆盖。</p>
              {draftNote ? <p className="text-xs text-foreground/80" data-testid="character-voice-draft-note">{draftNote}</p> : null}
            </section>

            {actionError ? (
              <div className="flex items-start justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/[0.04] px-3 py-2.5 text-xs text-destructive" role="alert">
                <span>{actionError.message}</span>
                {actionError.conflict ? <Button variant="outline" size="sm" onClick={() => void load()}>重新载入</Button> : null}
              </div>
            ) : null}

            {warnings.length > 0 ? (
              <ul className="space-y-1.5" data-testid="character-voice-warnings">
                {warnings.map((warning) => (
                  <li key={warning.code} className="rounded-md border border-amber-500/40 bg-amber-500/[0.05] px-3 py-2">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="size-3.5 shrink-0" />{warning.message}
                    </p>
                    {warning.explanation?.whatHappened && warning.explanation.whatHappened !== warning.message ? (
                      <p className="mt-0.5 text-2xs text-muted-foreground">{warning.explanation.whatHappened}</p>
                    ) : null}
                    {warning.explanation?.whyItMatters ? <p className="mt-0.5 text-2xs text-muted-foreground">{warning.explanation.whyItMatters}</p> : null}
                    {warning.explanation?.suggestedAction ? <p className="mt-0.5 text-2xs text-muted-foreground">建议：{warning.explanation.suggestedAction}</p> : null}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {CHARACTER_VOICE_FIELD_META.map((meta) => {
                const field = fieldOf(loadState.voice, meta);
                const input = inputs[meta.key] ?? "";
                const unchanged = input.trim() === toInput(field).trim();
                const willClear = !input.trim() && field.status !== "missing";
                const actionLabel = willClear ? "清空" : field.status === "confirmed" && unchanged ? "已确认" : "确认";
                const disabled = busy !== null || (field.status === "confirmed" && unchanged) || (!input.trim() && field.status === "missing");
                return (
                  <div
                    key={meta.key}
                    className="space-y-1.5 rounded-md border border-border/50 bg-background/70 p-2.5"
                    data-testid={`voice-field-${meta.key}`}
                    data-status={field.status}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <label htmlFor={`voice-${entryId}-${meta.key}`} className="text-xs font-semibold">{meta.label}</label>
                      <Badge variant={statusVariant(field.status)} className="text-2xs font-normal">{STATUS_LABEL[field.status]}</Badge>
                      {field.source && field.status !== "missing" ? <span className="text-2xs text-muted-foreground">{SOURCE_LABEL[field.source]}</span> : null}
                    </div>
                    <Textarea
                      id={`voice-${entryId}-${meta.key}`}
                      value={input}
                      onChange={(event) => {
                        const value = event.target.value;
                        setInputs((previous) => ({ ...previous, [meta.key]: value }));
                        setDirty((previous) => new Set(previous).add(meta.key));
                      }}
                      placeholder={`待补充：${meta.hint}`}
                      className="min-h-[56px] text-sm"
                    />
                    {field.evidence && field.evidence.length > 0 ? (
                      <ul className="space-y-0.5">
                        {field.evidence.map((item, index) => (
                          <li key={`${meta.key}-evidence-${index}`} className="text-2xs leading-relaxed text-muted-foreground">依据：{item}</li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="flex justify-end">
                      <Button
                        variant={field.status === "needs-review" ? "default" : "outline"}
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs"
                        disabled={disabled}
                        onClick={() => void handleConfirm(meta)}
                        aria-label={`${actionLabel}${meta.label}`}
                      >
                        {busy === meta.key ? <Loader2 className="size-3 animate-spin" /> : null}
                        {actionLabel}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
