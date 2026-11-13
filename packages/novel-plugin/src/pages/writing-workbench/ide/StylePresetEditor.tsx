import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpenCheck,
  Check,
  Feather,
  Layers,
  Loader2,
  Palette,
  RefreshCw,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiRequestError, fetchJson as defaultFetchJson } from "@/hooks/use-api";
import { composeStyleGuide, createStylePreset, type StylePreset } from "../../../engine/writing-layers/style-preset";
import {
  CUSTOM_CONSTRAINT_MAX_ITEM_CHARS,
  CUSTOM_CONSTRAINT_MAX_ITEMS,
  extractCustomConstraints,
  prepareCustomConstraints,
} from "../../../engine/writing-layers/style-preset-custom-constraints";

type BaseSource = StylePreset["sources"][number];
type SourceRule = BaseSource["rules"][number];
type SourceSample = BaseSource["samples"][number];

export type StyleSourceRole = "primary_voice" | "register_overlay";

export interface StyleSourceV2Fields {
  role?: StyleSourceRole;
  triggerTags?: string[];
  forbiddenSourceTerms?: string[];
}

export type ExtendedStyleSource = BaseSource & StyleSourceV2Fields;

export interface ConsolidatedStyleRule {
  readonly id: string;
  readonly category?: string;
  readonly rule: string;
  readonly doExample?: string;
  readonly dontExample?: string;
  readonly sourceIds: readonly string[];
}

export interface RegisterGuardrailConfig {
  enabled?: boolean;
  allowedAsciiAcronyms?: string[];
  extraForbiddenTerms?: string[];
}

/** 服务端启用硬约束与 v2 扩展字段后的预设类型（全部可选、向下兼容 v1）。 */
export type StylePresetWithCustomConstraints = Omit<StylePreset, "sources"> & {
  sources: ExtendedStyleSource[];
  customConstraints?: unknown;
  consolidatedRules?: ConsolidatedStyleRule[];
  registerGuardrail?: RegisterGuardrailConfig;
};

export interface StylePresetResponse {
  preset: StylePresetWithCustomConstraints | null;
  revision: string | null;
  source: "preset" | "legacy" | "none";
  guideText: string;
}

interface Draft {
  name: string;
  generalRules: string;
  tone: string;
  narrativeVoice: string;
  principles: string;
  sources: ExtendedStyleSource[];
  customConstraints: string[];
  consolidatedRules: ConsolidatedStyleRule[];
  registerGuardrail: RegisterGuardrailConfig | null;
}

interface EditorState {
  response: StylePresetResponse | null;
  draft: Draft | null;
  loading: boolean;
  saving: boolean;
  conflict: boolean;
  error: string | null;
  notice: string | null;
}

export interface StylePresetEditorProps {
  bookId: string;
  refreshKey?: number;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  variant?: "compact" | "workspace";
  fetchJsonFn?: <T>(path: string, init?: RequestInit) => Promise<T>;
}

const SCENE_LABELS: Record<SourceSample["sceneType"], string> = {
  dialogue: "对话",
  action: "动作",
  description: "描写",
  interiority: "内心",
  transition: "转场",
  general: "通用",
};

const CATEGORY_LABELS: Record<string, string> = {
  voice: "叙事声音",
  language: "语言肌理",
  rhythm: "句式节奏",
  dialogue: "人物对白",
  scene: "场景调度",
  consistency: "语域一致",
  general: "综合技法",
};

function isNotFoundError(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const record = cause as Record<string, unknown>;
  return record.status === 404 || record.statusCode === 404;
}

function normaliseConsolidatedRules(value: unknown): ConsolidatedStyleRule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, idx) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const rec = item as Record<string, unknown>;
    const rule = typeof rec.rule === "string" ? rec.rule.trim() : "";
    if (!rule) return [];
    const id = typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : `c-rule-${idx + 1}`;
    const sourceIds = Array.isArray(rec.sourceIds)
      ? rec.sourceIds.filter((s): s is string => typeof s === "string")
      : [];
    return [{
      id,
      rule,
      sourceIds,
      ...(typeof rec.category === "string" && rec.category.trim() ? { category: rec.category.trim() } : {}),
      ...(typeof rec.doExample === "string" && rec.doExample.trim() ? { doExample: rec.doExample.trim() } : {}),
      ...(typeof rec.dontExample === "string" && rec.dontExample.trim() ? { dontExample: rec.dontExample.trim() } : {}),
    }];
  });
}

function normaliseGuardrail(value: unknown): RegisterGuardrailConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  return {
    ...(typeof rec.enabled === "boolean" ? { enabled: rec.enabled } : {}),
    ...(Array.isArray(rec.allowedAsciiAcronyms)
      ? { allowedAsciiAcronyms: rec.allowedAsciiAcronyms.filter((s): s is string => typeof s === "string") }
      : {}),
    ...(Array.isArray(rec.extraForbiddenTerms)
      ? { extraForbiddenTerms: rec.extraForbiddenTerms.filter((s): s is string => typeof s === "string") }
      : {}),
  };
}

function toDraft(preset: StylePresetWithCustomConstraints | null): Draft {
  const value = preset ?? (createStylePreset() as StylePresetWithCustomConstraints);
  return {
    name: value.name,
    generalRules: value.generalRules.join("\n"),
    tone: value.bookVoice.tone,
    narrativeVoice: value.bookVoice.narrativeVoice,
    principles: value.bookVoice.principles.join("\n"),
    sources: value.sources.map((src) => ({
      ...src,
      ...(src.role ? { role: src.role } : {}),
      ...(Array.isArray(src.triggerTags) ? { triggerTags: [...src.triggerTags] } : {}),
      ...(Array.isArray(src.forbiddenSourceTerms) ? { forbiddenSourceTerms: [...src.forbiddenSourceTerms] } : {}),
    })),
    customConstraints: [...(extractCustomConstraints(preset as StylePreset | null)?.constraints ?? [])],
    consolidatedRules: normaliseConsolidatedRules(value.consolidatedRules),
    registerGuardrail: normaliseGuardrail(value.registerGuardrail),
  };
}

function lines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function commaTokens(text: string): string[] {
  return text
    .split(/[,，、\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * 稀疏序列化：仅当原存储对象已包含扩展字段或作者显式编辑了扩展字段时才写入对应键，
 * 保证旧版严格 Schema 校验与回归测试字节级兼容，同时完整保存 v2 双轨与护栏配置。
 */
function toPreset(
  draft: Draft,
  stored: StylePresetWithCustomConstraints | null,
  options?: { forceCustomConstraints?: boolean },
): StylePresetWithCustomConstraints {
  const preset = stored ?? (createStylePreset() as StylePresetWithCustomConstraints);
  const sources: ExtendedStyleSource[] = draft.sources.map((src) => {
    const orig = stored?.sources.find((item) => item.id === src.id);
    const nextSrc: ExtendedStyleSource = {
      id: src.id,
      title: src.title,
      rules: src.rules,
      samples: src.samples,
    };
    if (src.role !== undefined || (orig && "role" in orig)) {
      nextSrc.role = src.role;
    }
    if ((src.triggerTags && src.triggerTags.length > 0) || (orig && "triggerTags" in orig)) {
      nextSrc.triggerTags = src.triggerTags ?? [];
    }
    if ((src.forbiddenSourceTerms && src.forbiddenSourceTerms.length > 0) || (orig && "forbiddenSourceTerms" in orig)) {
      nextSrc.forbiddenSourceTerms = src.forbiddenSourceTerms ?? [];
    }
    return nextSrc;
  });

  const next: StylePresetWithCustomConstraints = {
    ...preset,
    name: draft.name.trim(),
    generalRules: lines(draft.generalRules),
    sources,
    bookVoice: {
      ...preset.bookVoice,
      tone: draft.tone.trim(),
      narrativeVoice: draft.narrativeVoice.trim(),
      principles: lines(draft.principles),
    },
  };

  if (options?.forceCustomConstraints || extractCustomConstraints(stored as StylePreset | null)) {
    next.customConstraints = prepareCustomConstraints(draft.customConstraints).constraints;
  }

  if (draft.consolidatedRules.length > 0 || (stored && "consolidatedRules" in stored)) {
    next.consolidatedRules = draft.consolidatedRules;
  } else {
    delete next.consolidatedRules;
  }

  if (draft.registerGuardrail !== null || (stored && "registerGuardrail" in stored)) {
    next.registerGuardrail = draft.registerGuardrail ?? { enabled: false };
  } else {
    delete next.registerGuardrail;
  }

  return next;
}

function isDirty(state: EditorState): boolean {
  return (
    state.draft !== null &&
    JSON.stringify(state.draft) !== JSON.stringify(toDraft(state.response?.preset ?? null))
  );
}

export function StylePresetEditor(props: StylePresetEditorProps) {
  return <BookStylePresetEditor key={props.bookId} {...props} />;
}

function BookStylePresetEditor({
  bookId,
  refreshKey = 0,
  disabled = false,
  onBusyChange,
  variant = "compact",
  fetchJsonFn,
}: StylePresetEditorProps) {
  const requestJson = fetchJsonFn ?? defaultFetchJson;
  const [state, setState] = useState<EditorState>({
    response: null,
    draft: null,
    loading: true,
    saving: false,
    conflict: false,
    error: null,
    notice: null,
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const mounted = useRef(false);
  const lastRefreshKey = useRef(refreshKey);
  const [reloadKey, setReloadKey] = useState(0);
  const [constraintInput, setConstraintInput] = useState("");
  const [constraintsNote, setConstraintsNote] = useState<string | null>(null);
  const [negativeFeedbackInput, setNegativeFeedbackInput] = useState("");
  const [consolidating, setConsolidating] = useState(false);
  const [triggerTagInputs, setTriggerTagInputs] = useState<Record<string, string>>({});
  const [forbiddenTermInputs, setForbiddenTermInputs] = useState<Record<string, string>>({});
  const [anchorFilter, setAnchorFilter] = useState<string>("all");

  const encodedBookId = encodeURIComponent(bookId);
  const path = `/api/books/${encodedBookId}/style/preset`;
  const v2BasePrimary = `/api/books/${encodedBookId}/style-preset`;
  const v2BaseFallback = `/api/books/${encodedBookId}/style/preset`;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    onBusyChange?.(state.loading || state.saving || consolidating);
    return () => onBusyChange?.(false);
  }, [onBusyChange, state.loading, state.saving, consolidating]);

  useEffect(() => {
    const controller = new AbortController();
    const preserveDraft = lastRefreshKey.current !== refreshKey;
    lastRefreshKey.current = refreshKey;
    let active = true;
    setState((current) => ({ ...current, loading: true, error: null, notice: null }));
    void requestJson<StylePresetResponse>(path, { signal: controller.signal })
      .then((response) => {
        if (!active) return;
        const current = stateRef.current;
        const changedElsewhere =
          preserveDraft &&
          isDirty(current) &&
          JSON.stringify(toDraft(current.response?.preset ?? null)) !== JSON.stringify(toDraft(response.preset));
        if (changedElsewhere || (preserveDraft && current.conflict)) {
          setState((value) => ({
            ...value,
            loading: false,
            conflict: true,
            error: "文风预设已有新版本，本地修改尚未保存。请先保留需要的文字，再重新载入。",
          }));
          return;
        }
        setState((value) => ({
          ...value,
          response,
          draft: preserveDraft && isDirty(value) ? value.draft : toDraft(response.preset),
          loading: false,
          conflict: false,
          error: null,
        }));
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setState((current) => ({
          ...current,
          loading: false,
          error: cause instanceof Error ? cause.message : "读取文风预设失败，请重新载入。",
        }));
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [path, refreshKey, reloadKey, requestJson]);

  const busy = disabled || state.loading || state.saving || consolidating;
  const dirty = isDirty(state);
  const guideText =
    dirty && state.draft
      ? composeStyleGuide(toPreset(state.draft, state.response?.preset ?? null) as unknown as StylePreset)
      : state.response?.guideText;

  // 服务端未启用 customConstraints 字段时硬约束分区整体隐藏（半成品不露出）。
  const constraintsExtraction = extractCustomConstraints((state.response?.preset ?? null) as StylePreset | null);
  const constraintsSupported = constraintsExtraction !== null;
  const isWorkspace = variant === "workspace";
  const hasV2Data = Boolean(
    state.draft &&
      (state.draft.consolidatedRules.length > 0 ||
        state.draft.registerGuardrail !== null ||
        state.draft.sources.some(
          (s) => s.role || (s.triggerTags && s.triggerTags.length > 0) || (s.forbiddenSourceTerms && s.forbiddenSourceTerms.length > 0),
        )),
  );
  const showV2Architecture = isWorkspace || hasV2Data;

  function updateDraft(patch: Partial<Draft>) {
    setState((current) => ({
      ...current,
      draft: current.draft ? { ...current.draft, ...patch } : null,
      notice: null,
    }));
  }

  function confirm(sourceIndex: number, collection: "rules" | "samples", index: number) {
    if (!state.draft) return;
    updateDraft({
      sources: state.draft.sources.map((source, i) =>
        i !== sourceIndex
          ? source
          : {
              ...source,
              [collection]: source[collection].map((entry, j) =>
                j !== index
                  ? entry
                  : {
                      ...entry,
                      status: entry.status === "confirmed" ? "needs-review" : "confirmed",
                    },
              ),
            },
      ),
    });
  }

  function addConstraint() {
    if (!state.draft || !constraintInput.trim()) return;
    if (state.draft.customConstraints.length >= CUSTOM_CONSTRAINT_MAX_ITEMS) {
      setConstraintsNote(`硬约束最多 ${CUSTOM_CONSTRAINT_MAX_ITEMS} 条，这条没有加入。`);
      return;
    }
    const prepared = prepareCustomConstraints([...state.draft.customConstraints, constraintInput]);
    updateDraft({ customConstraints: prepared.constraints });
    setConstraintInput("");
    setConstraintsNote(
      prepared.clampedItems > 0
        ? `这条超过 ${CUSTOM_CONSTRAINT_MAX_ITEM_CHARS} 字，已按 ${CUSTOM_CONSTRAINT_MAX_ITEM_CHARS} 字收短。`
        : null,
    );
  }

  function removeConstraint(index: number) {
    if (!state.draft) return;
    updateDraft({ customConstraints: state.draft.customConstraints.filter((_, i) => i !== index) });
    setConstraintsNote(null);
  }

  async function saveWithDraft(
    nextDraft: Draft,
    options?: { forceCustomConstraints?: boolean; successNotice?: string },
  ) {
    if (busy || state.conflict || !state.response || !nextDraft.name.trim()) return;
    const preset = toPreset(nextDraft, state.response.preset, options);
    setState((current) => ({ ...current, saving: true, error: null, notice: null }));
    try {
      const response = await requestJson<StylePresetResponse>(path, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: state.response.revision, preset }),
      });
      window.dispatchEvent(new CustomEvent("novelfork:style-preset-updated", { detail: { bookId } }));
      if (!mounted.current) return;
      setState((current) => ({
        ...current,
        response,
        draft: toDraft(response.preset),
        saving: false,
        conflict: false,
        notice: options?.successNotice ?? "文风预设已保存。",
      }));
    } catch (cause) {
      if (!mounted.current) return;
      const conflict = cause instanceof ApiRequestError && cause.status === 409;
      setState((current) => ({
        ...current,
        saving: false,
        conflict,
        error: conflict
          ? "保存冲突：文风预设已有新版本，本地修改尚未保存。请先保留需要的文字，再重新载入。"
          : cause instanceof Error
            ? cause.message
            : "保存文风预设失败，请重试。",
      }));
    }
  }

  async function save() {
    if (!state.draft) return;
    await saveWithDraft(state.draft);
  }

  /**
   * L5 负反馈热修正直通车：
   * 优先调 POST /style-preset/negative-override，若 404 则把该条置顶进 customConstraints 并整份 PUT 保存。
   */
  async function submitNegativeOverride() {
    const feedback = negativeFeedbackInput.trim();
    if (!feedback || busy || !state.draft) return;
    setState((current) => ({ ...current, saving: true, error: null, notice: null }));
    try {
      let resp: StylePresetResponse | null = null;
      try {
        resp = await requestJson<StylePresetResponse>(`${v2BasePrimary}/negative-override`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feedback }),
        });
      } catch (firstErr) {
        if (isNotFoundError(firstErr)) {
          try {
            resp = await requestJson<StylePresetResponse>(`${v2BaseFallback}/negative-override`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ feedback }),
            });
          } catch (secondErr) {
            if (!isNotFoundError(secondErr)) throw secondErr;
          }
        } else {
          throw firstErr;
        }
      }

      if (resp && resp.preset) {
        window.dispatchEvent(new CustomEvent("novelfork:style-preset-updated", { detail: { bookId } }));
        if (!mounted.current) return;
        setNegativeFeedbackInput("");
        setState((current) => ({
          ...current,
          response: resp,
          draft: toDraft(resp.preset),
          saving: false,
          conflict: false,
          notice: "负反馈铁律已置顶生效，后续润色与正文生成将最高优先拦截。",
        }));
        return;
      }

      // 404 降级：置顶写入 customConstraints 并调 PUT 保存
      const prepared = prepareCustomConstraints([feedback, ...state.draft.customConstraints]);
      const nextDraft: Draft = {
        ...state.draft,
        name: state.draft.name.trim() || "本书文风",
        customConstraints: prepared.constraints,
      };
      setNegativeFeedbackInput("");
      setState((current) => ({ ...current, draft: nextDraft, saving: false }));
      await saveWithDraft(nextDraft, {
        forceCustomConstraints: true,
        successNotice: "负反馈铁律已置顶写入硬约束并保存生效。",
      });
    } catch (cause) {
      if (!mounted.current) return;
      setState((current) => ({
        ...current,
        saving: false,
        error: cause instanceof Error ? cause.message : "添加负反馈铁律失败，请稍后重试。",
      }));
    }
  }

  /**
   * 更新来源主副角色、触发词或原著禁抄词：
   * 优先 PATCH /style-preset/sources/:sourceId，若 404 则通过 PUT /style/preset 整份保存预设（双重保障）。
   */
  async function updateSourceMetadata(
    targetSourceId: string,
    patch: { role?: StyleSourceRole; triggerTags?: string[]; forbiddenSourceTerms?: string[] },
  ) {
    if (!state.draft || busy) return;
    const nextSources = state.draft.sources.map((src) => {
      if (src.id === targetSourceId) {
        return {
          ...src,
          ...(patch.role !== undefined ? { role: patch.role } : {}),
          ...(patch.triggerTags !== undefined ? { triggerTags: patch.triggerTags } : {}),
          ...(patch.forbiddenSourceTerms !== undefined ? { forbiddenSourceTerms: patch.forbiddenSourceTerms } : {}),
        };
      }
      // 主文风唯一：若将当前来源设为主文风，原先的主文风自动降为局部语域插件
      if (patch.role === "primary_voice" && src.role === "primary_voice") {
        return { ...src, role: "register_overlay" as const };
      }
      return src;
    });

    const target = nextSources.find((s) => s.id === targetSourceId);
    if (!target) return;

    const patchBody = {
      ...(target.role ? { role: target.role } : {}),
      ...(target.triggerTags ? { triggerTags: target.triggerTags } : {}),
      ...(target.forbiddenSourceTerms ? { forbiddenSourceTerms: target.forbiddenSourceTerms } : {}),
    };

    const nextDraft: Draft = { ...state.draft, sources: nextSources };
    setState((current) => ({ ...current, draft: nextDraft, saving: true, error: null, notice: null }));

    try {
      let patchResp: StylePresetResponse | null = null;
      const encodedSourceId = encodeURIComponent(targetSourceId);
      try {
        patchResp = await requestJson<StylePresetResponse>(`${v2BasePrimary}/sources/${encodedSourceId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchBody),
        });
      } catch (firstErr) {
        if (isNotFoundError(firstErr)) {
          try {
            patchResp = await requestJson<StylePresetResponse>(`${v2BaseFallback}/sources/${encodedSourceId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(patchBody),
            });
          } catch (secondErr) {
            if (!isNotFoundError(secondErr)) throw secondErr;
          }
        } else {
          throw firstErr;
        }
      }

      if (patchResp && patchResp.preset) {
        window.dispatchEvent(new CustomEvent("novelfork:style-preset-updated", { detail: { bookId } }));
        if (!mounted.current) return;
        setState((current) => ({
          ...current,
          response: patchResp,
          draft: toDraft(patchResp.preset),
          saving: false,
          conflict: false,
          notice: "来源角色与语域护栏已更新。",
        }));
        return;
      }

      // 404 回退整份 PUT 保存预设
      setState((current) => ({ ...current, saving: false }));
      await saveWithDraft(nextDraft, { successNotice: "来源角色与语域护栏已保存。" });
    } catch (cause) {
      if (!mounted.current) return;
      setState((current) => ({
        ...current,
        saving: false,
        error: cause instanceof Error ? cause.message : "更新来源角色失败，请重试。",
      }));
    }
  }

  /**
   * 一键规则聚类瘦身（Consolidate）：
   * 调 POST /style-preset/consolidate 收敛为 ≤12 条带正反例的高密度执行铁律。
   */
  async function handleConsolidate() {
    if (!state.draft || busy) return;
    setConsolidating(true);
    setState((current) => ({ ...current, error: null, notice: null }));
    try {
      let resp: StylePresetResponse | null = null;
      try {
        resp = await requestJson<StylePresetResponse>(`${v2BasePrimary}/consolidate`, {
          method: "POST",
        });
      } catch (firstErr) {
        if (isNotFoundError(firstErr)) {
          resp = await requestJson<StylePresetResponse>(`${v2BaseFallback}/consolidate`, {
            method: "POST",
          });
        } else {
          throw firstErr;
        }
      }

      if (resp && resp.preset) {
        window.dispatchEvent(new CustomEvent("novelfork:style-preset-updated", { detail: { bookId } }));
        if (!mounted.current) return;
        const nextDraft = toDraft(resp.preset);
        setState((current) => ({
          ...current,
          response: resp,
          draft: nextDraft,
          conflict: false,
          notice: `已完成规则聚类瘦身，收敛为 ${nextDraft.consolidatedRules.length} 条核心执行铁律。`,
        }));
      }
    } catch (cause) {
      if (!mounted.current) return;
      if (isNotFoundError(cause)) {
        // 后端尚未接入 consolidate 时，本地按已确认可迁移规则生成预览卡片
        const fallbackConsolidated: ConsolidatedStyleRule[] = state.draft.sources
          .flatMap((src) =>
            src.rules
              .filter((r) => r.status === "confirmed" && r.transfer === "transferable")
              .map((r, i) => ({
                id: `${src.id}-r-${i}`,
                category: r.category,
                rule: r.text,
                doExample: r.evidence,
                sourceIds: [src.id],
              })),
          )
          .slice(0, 12);
        setState((current) => ({
          ...current,
          draft: current.draft ? { ...current.draft, consolidatedRules: fallbackConsolidated } : null,
          notice: `已按当前已确认规则提炼 ${fallbackConsolidated.length} 条高密度铁律预览。`,
        }));
      } else {
        setState((current) => ({
          ...current,
          error: cause instanceof Error ? cause.message : "聚类瘦身失败，请稍后重试。",
        }));
      }
    } finally {
      if (mounted.current) setConsolidating(false);
    }
  }

  const primarySources = useMemo(
    () => state.draft?.sources.filter((s) => s.role === "primary_voice") ?? [],
    [state.draft?.sources],
  );
  const overlaySources = useMemo(
    () => state.draft?.sources.filter((s) => s.role === "register_overlay") ?? [],
    [state.draft?.sources],
  );
  const unassignedSources = useMemo(
    () => state.draft?.sources.filter((s) => !s.role) ?? [],
    [state.draft?.sources],
  );

  const allAnchors = useMemo(() => {
    if (!state.draft) return [];
    return state.draft.sources.flatMap((src, sourceIndex) =>
      src.samples.map((sample, sampleIndex) => ({
        sourceId: src.id,
        sourceTitle: src.title,
        sourceRole: src.role,
        sourceIndex,
        sampleIndex,
        sample,
      })),
    );
  }, [state.draft]);

  const filteredAnchors = useMemo(
    () =>
      anchorFilter === "all"
        ? allAnchors
        : allAnchors.filter((item) => item.sample.sceneType === anchorFilter),
    [allAnchors, anchorFilter],
  );

  function addSourceTriggerTag(src: ExtendedStyleSource) {
    const raw = (triggerTagInputs[src.id] ?? "").trim();
    if (!raw) return;
    const incoming = commaTokens(raw);
    const merged = [...new Set([...(src.triggerTags ?? []), ...incoming])];
    setTriggerTagInputs((prev) => ({ ...prev, [src.id]: "" }));
    void updateSourceMetadata(src.id, { role: src.role ?? "register_overlay", triggerTags: merged });
  }

  function removeSourceTriggerTag(src: ExtendedStyleSource, tag: string) {
    const nextTags = (src.triggerTags ?? []).filter((t) => t !== tag);
    void updateSourceMetadata(src.id, { triggerTags: nextTags });
  }

  function addForbiddenTerm(src: ExtendedStyleSource) {
    const raw = (forbiddenTermInputs[src.id] ?? "").trim();
    if (!raw) return;
    const incoming = commaTokens(raw);
    const merged = [...new Set([...(src.forbiddenSourceTerms ?? []), ...incoming])];
    setForbiddenTermInputs((prev) => ({ ...prev, [src.id]: "" }));
    void updateSourceMetadata(src.id, { forbiddenSourceTerms: merged });
  }

  function removeForbiddenTerm(src: ExtendedStyleSource, term: string) {
    const nextTerms = (src.forbiddenSourceTerms ?? []).filter((t) => t !== term);
    void updateSourceMetadata(src.id, { forbiddenSourceTerms: nextTerms });
  }

  function sourceEntry(entry: SourceRule, sourceIndex: number, collection: "rules" | "samples", index: number) {
    return (
      <div
        key={collection === "samples" ? (entry as SourceSample).id : index}
        className="space-y-1.5 rounded-md border border-border/60 bg-muted/25 p-2.5"
      >
        <div className="flex flex-wrap items-center gap-1">
          {collection === "samples" && (
            <Badge variant="outline">{SCENE_LABELS[(entry as SourceSample).sceneType]}样文</Badge>
          )}
          <Badge variant="secondary">{entry.transfer === "transferable" ? "可迁移" : "作品专属"}</Badge>
          <Badge variant={entry.status === "confirmed" ? "default" : "outline"}>
            {entry.status === "confirmed" ? "已确认" : "待审"}
          </Badge>
        </div>
        <p
          className="whitespace-pre-wrap break-words text-xs leading-relaxed"
          style={collection === "samples" ? { fontFamily: "var(--font-prose)" } : undefined}
        >
          {entry.text}
        </p>
        <p className="whitespace-pre-wrap break-words text-2xs text-muted-foreground">
          证据：{entry.evidence || "未提供"}
        </p>
        <Button
          size="xs"
          variant={entry.status === "confirmed" ? "outline" : "ghost"}
          disabled={busy}
          aria-label={`${entry.status === "confirmed" ? "撤回确认" : "确认"}：${entry.text}`}
          onClick={() => confirm(sourceIndex, collection, index)}
        >
          {entry.status === "confirmed" ? "撤回确认" : "确认"}
        </Button>
      </div>
    );
  }

  return (
    <section
      aria-label="本书文风预设"
      className={
        isWorkspace
          ? "space-y-5"
          : "space-y-3 rounded-lg border border-border/80 bg-card p-3"
      }
    >
      {/* 顶栏标题与重载 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 font-medium">
            {isWorkspace ? (
              <BookOpenCheck className="size-4 text-primary" />
            ) : (
              <Palette className="size-3.5 text-primary" />
            )}
            <span
              className={isWorkspace ? "text-base font-semibold" : ""}
              style={isWorkspace ? { fontFamily: "var(--font-display)" } : undefined}
            >
              {isWorkspace ? "本书文风 DNA 与语域护栏" : "本书文风预设"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            每本书使用一份文风预设。重新载入会放弃本地未保存的修改。
          </p>
        </div>
        <Button size="xs" variant="ghost" disabled={busy} onClick={() => setReloadKey((value) => value + 1)}>
          <RefreshCw className={`size-3 ${state.loading ? "animate-spin" : ""}`} />
          重新载入
        </Button>
      </div>

      {state.response?.source === "legacy" && (
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          已沿用旧统计基线，首次保存后升级为本书文风预设。
        </p>
      )}
      {state.loading && (
        <p role="status" className="text-xs text-muted-foreground">
          正在读取文风预设…
        </p>
      )}
      {state.error && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
          {state.error}
        </p>
      )}

      {state.draft && (
        <>
          {/* 模块 A：L5 负反馈热修正快捷栏（工作台模式始终置顶显示） */}
          {isWorkspace && (
            <Card className="border-primary/35 bg-primary/4" data-testid="negative-override-bar">
              <CardContent className="space-y-2.5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="size-4 text-primary" />
                    <span className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-display)" }}>
                      负反馈热修正直通车
                    </span>
                    <Badge variant="secondary" className="text-2xs">
                      最高优铁律
                    </Badge>
                  </div>
                  <span className="text-2xs text-muted-foreground">
                    随写随纠偏，回车立即固化为压过一切润色技法的硬性禁令
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    aria-label="负反馈热修正"
                    value={negativeFeedbackInput}
                    disabled={busy}
                    onChange={(event) => setNegativeFeedbackInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void submitNegativeOverride();
                      }
                    }}
                    placeholder="输入你不满意的写法，如“别出现英文缩写 SQUID/PLL”“少写心理独白”，回车立即置顶为最高铁律"
                    className="h-8 min-w-60 flex-1 bg-background text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy || !negativeFeedbackInput.trim()}
                    onClick={() => void submitNegativeOverride()}
                  >
                    置顶为铁律
                  </Button>
                </div>
                {state.draft.customConstraints.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span className="text-2xs text-muted-foreground">已生效禁令：</span>
                    {state.draft.customConstraints.slice(0, 8).map((item, idx) => (
                      <span
                        key={`top-constraint-${idx}-${item}`}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-2xs text-foreground"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* 模块 B：双书主副隔离架构卡（Primary Voice vs Register Overlays） */}
          {showV2Architecture && (
            <div className="grid gap-4 lg:grid-cols-2" aria-label="主副双轨文风架构">
              {/* 唯一主文风 */}
              <Card className="border-primary/35 bg-card" data-testid="primary-voice-card">
                <CardHeader className="border-b border-border/60 pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-sm font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                      <Feather className="size-4 text-primary" />
                      唯一主文风（全局声线）
                    </CardTitle>
                    <Badge variant="default" className="text-2xs">
                      全局唯一
                    </Badge>
                  </div>
                  <CardDescription className="text-xs">
                    唯一接管本书日常句式长短、段落呼吸、叙述冷暖与人物对白腔调，避免多书文风互相打架。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2.5 pt-3">
                  {primarySources.length > 0 ? (
                    primarySources.map((src) => (
                      <div key={src.id} className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-foreground">{src.title}</p>
                            <p className="text-2xs text-muted-foreground tabular-nums">
                              已确认 {src.rules.filter((r) => r.status === "confirmed").length} 条规则 ·{" "}
                              {src.samples.filter((s) => s.status === "confirmed").length} 段原文锚点
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void updateSourceMetadata(src.id, { role: "register_overlay" })}
                          >
                            转为局部语域插件
                          </Button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                      {state.draft.sources.length > 0
                        ? "当前尚未指定唯一主文风，请在下方参考来源上点击「设为主文风」。"
                        : "尚未采纳参考来源。可在「拆书与蒸馏采样」中抽样采纳一部主参考书。"}
                    </div>
                  )}

                  {unassignedSources.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <span className="text-2xs font-medium text-muted-foreground">待分配角色的来源：</span>
                      {unassignedSources.map((src) => (
                        <div
                          key={src.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 bg-muted/20 px-2.5 py-1.5 text-xs"
                        >
                          <span className="font-medium">{src.title}</span>
                          <div className="flex items-center gap-1.5">
                            <Button
                              type="button"
                              size="xs"
                              variant="secondary"
                              disabled={busy}
                              onClick={() => void updateSourceMetadata(src.id, { role: "primary_voice" })}
                            >
                              设为主文风
                            </Button>
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              disabled={busy}
                              onClick={() => void updateSourceMetadata(src.id, { role: "register_overlay" })}
                            >
                              设为局部语域插件
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* 局部语域插件 */}
              <Card className="border-border/80 bg-card" data-testid="register-overlays-card">
                <CardHeader className="border-b border-border/60 pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-sm font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                      <Layers className="size-4 text-primary" />
                      局部语域插件（按场景挂载）
                    </CardTitle>
                    <Badge variant="outline" className="tabular-nums text-2xs">
                      {overlaySources.length} 个插件
                    </Badge>
                  </div>
                  <CardDescription className="text-xs">
                    平时完全静默；仅当本章细纲或场景命中绑定的触发场景词时局部激活，不污染主文风对白。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2.5 pt-3">
                  {overlaySources.length > 0 ? (
                    overlaySources.map((src) => (
                      <div key={src.id} className="space-y-2 rounded-lg border border-border/80 bg-muted/20 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-foreground">{src.title}</span>
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void updateSourceMetadata(src.id, { role: "primary_voice" })}
                          >
                            切换为主文风
                          </Button>
                        </div>
                        <div className="space-y-1">
                          <span className="block text-2xs text-muted-foreground">触发场景词（命中时局部挂载）：</span>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {(src.triggerTags ?? []).map((tag) => (
                              <span
                                key={tag}
                                className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/8 px-2 py-0.5 text-2xs text-foreground"
                              >
                                {tag}
                                <button
                                  type="button"
                                  disabled={busy}
                                  aria-label={`移除触发词 ${tag}`}
                                  onClick={() => removeSourceTriggerTag(src, tag)}
                                  className="text-muted-foreground hover:text-destructive"
                                >
                                  <X className="size-2.5" />
                                </button>
                              </span>
                            ))}
                            <input
                              aria-label={`为「${src.title}」新增触发词`}
                              placeholder="+ 如：道藏古籍"
                              value={triggerTagInputs[src.id] ?? ""}
                              disabled={busy}
                              onChange={(e) => setTriggerTagInputs((prev) => ({ ...prev, [src.id]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  addSourceTriggerTag(src);
                                }
                              }}
                              className="h-5 w-28 rounded border border-dashed border-border bg-background px-1.5 text-2xs outline-none focus:border-primary"
                            />
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                      暂无局部语域插件。若第二本参考书只学其古籍推演、制度公文或算账清单，采纳时选「设为局部语域插件」即可隔离。
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* 模块 C：核心执行铁律区（DO / DON'T 对照卡 + 一键聚类瘦身） */}
          {showV2Architecture && (
            <Card className="border-border/80 bg-card" aria-label="核心执行铁律对照区">
              <CardHeader className="border-b border-border/60 pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Scale className="size-4 text-primary" />
                      <CardTitle className="text-sm font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                        核心执行铁律（DO / DON&apos;T 对照卡）
                      </CardTitle>
                      <Badge variant="outline" className="tabular-nums text-2xs">
                        {state.draft.consolidatedRules.length} / 12 条上限
                      </Badge>
                    </div>
                    <CardDescription className="text-xs">
                      将分散在多批次的碎片写法收敛为不超过 12 条带正反例对照的高密度执行铁律，消除规则膨胀与相互矛盾。
                    </CardDescription>
                  </div>

                  <Button
                    type="button"
                    size="xs"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void handleConsolidate()}
                  >
                    {consolidating ? <Loader2 className="size-3 animate-spin" /> : <SlidersHorizontal className="size-3 text-primary" />}
                    {consolidating ? "正在聚类瘦身…" : "一键聚类瘦身"}
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="pt-3">
                {state.draft.consolidatedRules.length > 0 ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    {state.draft.consolidatedRules.map((item, idx) => (
                      <div
                        key={item.id}
                        data-testid="consolidated-rule-card"
                        className="space-y-2 rounded-lg border border-border/75 bg-background/60 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-2xs text-muted-foreground tabular-nums">
                              #{String(idx + 1).padStart(2, "0")}
                            </span>
                            <Badge variant="secondary" className="text-2xs">
                              {item.category ? (CATEGORY_LABELS[item.category] ?? item.category) : "核心铁律"}
                            </Badge>
                          </div>
                        </div>
                        <p className="text-xs font-medium leading-relaxed text-foreground">{item.rule}</p>
                        {(item.doExample || item.dontExample) && (
                          <div className="grid gap-2 pt-0.5 text-2xs">
                            {item.doExample && (
                              <div className="rounded-r border-l-2 border-success/70 bg-success/6 px-2.5 py-1.5">
                                <span className="block font-medium text-success">正例示范（DO）</span>
                                <p className="mt-0.5 whitespace-pre-wrap text-foreground/90" style={{ fontFamily: "var(--font-prose)" }}>
                                  {item.doExample}
                                </p>
                              </div>
                            )}
                            {item.dontExample && (
                              <div className="rounded-r border-l-2 border-warning/70 bg-warning/6 px-2.5 py-1.5">
                                <span className="block font-medium text-warning">反例警示（DON&apos;T）</span>
                                <p className="mt-0.5 whitespace-pre-wrap text-foreground/90">
                                  {item.dontExample}
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                    尚未生成聚类对照铁律。确认参考来源规则后，点击右上角「一键聚类瘦身」即可收敛为不超过 12 条正反例对照卡。
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* 模块 D：分场景原文锚点库（Few-shot Anchors，工作台全景模式展示） */}
          {isWorkspace && (
            <Card className="border-border/80 bg-card" aria-label="分场景原文锚点库">
              <CardHeader className="border-b border-border/60 pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <CardTitle className="text-sm font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                      分场景原文锚点库（精选段落）
                    </CardTitle>
                    <CardDescription className="text-xs">
                      写前优先保底注入 1–2 段同基调锚点（300–500 字精选原文段落），比百条抽象形容词更能稳住呼吸与语感。
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="tabular-nums text-2xs">
                    已确认 {allAnchors.filter((a) => a.sample.status === "confirmed").length} / 共 {allAnchors.length} 段
                  </Badge>
                </div>

                {allAnchors.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-2">
                    <button
                      type="button"
                      onClick={() => setAnchorFilter("all")}
                      className={`rounded-md border px-2 py-0.5 text-2xs transition-colors ${
                        anchorFilter === "all"
                          ? "border-primary/50 bg-primary text-primary-foreground font-medium"
                          : "border-border/70 bg-background text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      全部场景（{allAnchors.length}）
                    </button>
                    {(Object.entries(SCENE_LABELS) as [SourceSample["sceneType"], string][]).map(([key, label]) => {
                      const count = allAnchors.filter((a) => a.sample.sceneType === key).length;
                      if (count === 0) return null;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setAnchorFilter(key)}
                          className={`rounded-md border px-2 py-0.5 text-2xs transition-colors ${
                            anchorFilter === key
                              ? "border-primary/50 bg-primary text-primary-foreground font-medium"
                              : "border-border/70 bg-background text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {label}（{count}）
                        </button>
                      );
                    })}
                  </div>
                )}
              </CardHeader>
              <CardContent className="pt-3">
                {filteredAnchors.length > 0 ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    {filteredAnchors.map(({ sourceId, sourceTitle, sourceRole, sourceIndex, sampleIndex, sample }) => {
                      const confirmed = sample.status === "confirmed";
                      return (
                        <div
                          key={`${sourceId}-${sample.id}`}
                          className="flex flex-col justify-between gap-2.5 rounded-lg border border-border/75 bg-background/80 p-3"
                        >
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-1.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge variant="secondary" className="text-2xs">
                                  {SCENE_LABELS[sample.sceneType]}
                                </Badge>
                                <Badge variant="outline" className="text-2xs">
                                  {sourceTitle}
                                  {sourceRole === "register_overlay" ? " · 语域插件" : sourceRole === "primary_voice" ? " · 主文风" : ""}
                                </Badge>
                                <span className="text-2xs text-muted-foreground tabular-nums">
                                  {sample.text.length} 字
                                </span>
                              </div>
                              <Badge variant={confirmed ? "default" : "outline"} className="text-2xs">
                                {confirmed ? "已启用" : "待审"}
                              </Badge>
                            </div>
                            <p
                              className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-6 text-foreground"
                              style={{ fontFamily: "var(--font-prose)" }}
                            >
                              {sample.text}
                            </p>
                          </div>
                          <div className="flex items-center justify-between border-t border-border/50 pt-2">
                            <span className="truncate text-2xs text-muted-foreground">出处：{sample.evidence}</span>
                            <Button
                              type="button"
                              size="xs"
                              variant={confirmed ? "outline" : "secondary"}
                              disabled={busy}
                              onClick={() => confirm(sourceIndex, "samples", sampleIndex)}
                            >
                              {confirmed ? <Check className="size-3" /> : null}
                              {confirmed ? "停用锚点" : "启用锚点"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                    暂无精选原文锚点。在「拆书与蒸馏采样」审阅区勾选 300–500 字代表性段落并采纳后，此处将按场景归档。
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* 模块 E：语域纯洁度与防抄袭黑名单 */}
          {showV2Architecture && (
            <Card className="border-border/80 bg-card" aria-label="语域纯洁度与防抄袭黑名单">
              <CardHeader className="border-b border-border/60 pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                  <ShieldCheck className="size-4 text-primary" />
                  语域纯洁度与原著专名黑名单
                </CardTitle>
                <CardDescription className="text-xs">
                  拦截跨题材出戏的现代英文缩写与公式，并自动屏蔽各参考书的原著专有人名、宗门、功法词。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-3 text-xs">
                <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 p-3">
                  <label className="flex cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      aria-label="拦截英文专业缩写与公式"
                      checked={Boolean(state.draft.registerGuardrail?.enabled)}
                      disabled={busy}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        updateDraft({
                          registerGuardrail: {
                            ...(state.draft?.registerGuardrail ?? {}),
                            enabled,
                          },
                        });
                      }}
                      className="mt-0.5 size-4 cursor-pointer accent-primary"
                    />
                    <div className="space-y-0.5">
                      <span className="font-medium text-foreground">拦截英文专业缩写与公式</span>
                      <p className="text-2xs text-muted-foreground">
                        开启后，古风、仙侠或本土语境正文中禁止混入未加白名单的大写英文缩写与理科公式符号。
                      </p>
                    </div>
                  </label>

                  {state.draft.registerGuardrail?.enabled && (
                    <label className="w-full sm:w-72 space-y-1">
                      <span className="text-2xs text-muted-foreground">允许保留的英文缩写白名单（逗号分隔）</span>
                      <Input
                        aria-label="允许保留的英文缩写白名单"
                        placeholder="如：AI, VIP"
                        value={(state.draft.registerGuardrail.allowedAsciiAcronyms ?? []).join(", ")}
                        disabled={busy}
                        onChange={(event) =>
                          updateDraft({
                            registerGuardrail: {
                              ...state.draft?.registerGuardrail,
                              enabled: true,
                              allowedAsciiAcronyms: commaTokens(event.target.value),
                            },
                          })
                        }
                        className="h-7 text-xs"
                      />
                    </label>
                  )}
                </div>

                {state.draft.sources.length > 0 && (
                  <div className="space-y-2.5">
                    <span className="block font-medium text-foreground">各参考书原著专名黑名单（严禁带入本书正文）</span>
                    <div className="grid gap-2.5 md:grid-cols-2">
                      {state.draft.sources.map((src) => (
                        <div key={`forbidden-${src.id}`} className="space-y-1.5 rounded-lg border border-border/70 bg-background/60 p-2.5">
                          <span className="text-xs font-medium text-foreground">{src.title}</span>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {(src.forbiddenSourceTerms ?? []).map((term) => (
                              <span
                                key={term}
                                className="inline-flex items-center gap-1 rounded-md border border-warning/35 bg-warning/8 px-2 py-0.5 text-2xs text-foreground"
                              >
                                {term}
                                <button
                                  type="button"
                                  disabled={busy}
                                  aria-label={`移除「${src.title}」禁抄词 ${term}`}
                                  onClick={() => removeForbiddenTerm(src, term)}
                                  className="text-muted-foreground hover:text-destructive"
                                >
                                  <X className="size-2.5" />
                                </button>
                              </span>
                            ))}
                            <input
                              aria-label={`为「${src.title}」新增原著禁抄词`}
                              placeholder="+ 原著专名回车添加"
                              value={forbiddenTermInputs[src.id] ?? ""}
                              disabled={busy}
                              onChange={(e) => setForbiddenTermInputs((prev) => ({ ...prev, [src.id]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  addForbiddenTerm(src);
                                }
                              }}
                              className="h-5 w-32 rounded border border-dashed border-border bg-card px-1.5 text-2xs outline-none focus:border-warning"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* 本书声线基础表单与硬约束（完整保留原有可编辑项与无障碍标签） */}
          <div className={isWorkspace ? "rounded-xl border border-border/80 bg-card p-4 space-y-3" : "space-y-2"}>
            {isWorkspace && (
              <div className="border-b border-border/60 pb-2">
                <h3 className="text-sm font-semibold text-foreground" style={{ fontFamily: "var(--font-display)" }}>
                  本书基础声线与硬性约束
                </h3>
                <p className="text-xs text-muted-foreground">
                  定义本书自身的叙事视角、冷暖基调、通用写法与作者手写硬约束。
                </p>
              </div>
            )}

            <fieldset
              disabled={busy}
              className={isWorkspace ? "grid min-w-0 gap-3 md:grid-cols-2" : "min-w-0 space-y-2"}
            >
              <label className="block space-y-1">
                <span className="text-xs font-medium">预设名称</span>
                <Input
                  value={state.draft.name}
                  maxLength={120}
                  onChange={(event) => updateDraft({ name: event.target.value })}
                  className="text-xs"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">基调</span>
                <Input
                  value={state.draft.tone}
                  onChange={(event) => updateDraft({ tone: event.target.value })}
                  className="text-xs"
                />
              </label>
              <label className={`block space-y-1 ${isWorkspace ? "md:col-span-2" : ""}`}>
                <span className="text-xs font-medium">叙事声音</span>
                <Textarea
                  aria-label="叙事声音"
                  value={state.draft.narrativeVoice}
                  onChange={(event) => updateDraft({ narrativeVoice: event.target.value })}
                  className="resize-y text-xs"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">通用写法（每行一条）</span>
                <Textarea
                  aria-label="通用写法（每行一条）"
                  value={state.draft.generalRules}
                  onChange={(event) => updateDraft({ generalRules: event.target.value })}
                  className="resize-y text-xs"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">本书创作原则（每行一条）</span>
                <Textarea
                  aria-label="本书创作原则（每行一条）"
                  value={state.draft.principles}
                  onChange={(event) => updateDraft({ principles: event.target.value })}
                  className="resize-y text-xs"
                />
              </label>

              {constraintsSupported && (
                <div className={`space-y-1.5 ${isWorkspace ? "md:col-span-2" : ""}`} data-testid="custom-constraints">
                  <span className="text-xs font-medium">
                    硬约束（{state.draft.customConstraints.length}/{CUSTOM_CONSTRAINT_MAX_ITEMS}，每条 {CUSTOM_CONSTRAINT_MAX_ITEM_CHARS} 字）
                  </span>
                  <p className="text-xs text-muted-foreground">
                    作者手写的硬性要求，随「交叙述者做语感体检」和划词 AI 指令一起注入，优先于语感体检的手法说明；不进入章节写作指南。
                  </p>
                  <ul className="space-y-1">
                    {state.draft.customConstraints.map((item, index) => (
                      <li
                        key={`${index}-${item}`}
                        className="flex items-start justify-between gap-2 rounded bg-muted/30 px-2 py-1"
                        data-testid="custom-constraint-item"
                      >
                        <span className="min-w-0 break-words text-xs">{item}</span>
                        <Button
                          size="xs"
                          variant="ghost"
                          aria-label={`删除硬约束：${item}`}
                          onClick={() => removeConstraint(index)}
                        >
                          删除
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center gap-1">
                    <Input
                      aria-label="新增硬约束"
                      value={constraintInput}
                      placeholder="例如：对话必须口语化"
                      onChange={(event) => {
                        setConstraintInput(event.target.value);
                        setConstraintsNote(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") addConstraint();
                      }}
                      className="text-xs"
                    />
                    <Button
                      size="xs"
                      disabled={!constraintInput.trim() || state.draft.customConstraints.length >= CUSTOM_CONSTRAINT_MAX_ITEMS}
                      onClick={addConstraint}
                    >
                      添加
                    </Button>
                  </div>
                  {constraintsExtraction && (constraintsExtraction.clampedItems > 0 || constraintsExtraction.truncatedItems > 0) ? (
                    <p role="status" className="text-xs text-muted-foreground">
                      载入的硬约束超出上限，已自动收短到每条 {CUSTOM_CONSTRAINT_MAX_ITEM_CHARS} 字、保留前 {CUSTOM_CONSTRAINT_MAX_ITEMS} 条；保存后生效。
                    </p>
                  ) : null}
                  {constraintsNote ? (
                    <p role="status" className="text-xs text-muted-foreground">
                      {constraintsNote}
                    </p>
                  ) : null}
                </div>
              )}
            </fieldset>

            {state.draft.sources.length > 0 && (
              <div className="space-y-2 pt-1">
                <p className="text-xs font-medium">来源包明细</p>
                <p className="text-xs text-muted-foreground">
                  仅已确认且可迁移的规则进入指南；作品专属内容即使确认也不会进入。已确认的样文会按本章场景类型挑选 2–4 段，写章时作为示例。
                </p>
                {state.draft.sources.map((source, sourceIndex) => (
                  <details key={source.id} open={!isWorkspace} className="space-y-2 rounded-lg border border-border p-2.5">
                    <summary className="cursor-pointer text-xs font-medium">
                      {source.title}
                      {source.role === "primary_voice"
                        ? "（唯一主文风）"
                        : source.role === "register_overlay"
                          ? "（局部语域插件）"
                          : ""}
                    </summary>
                    <div className="space-y-2 pt-1">
                      {source.rules.map((entry, index) => sourceEntry(entry, sourceIndex, "rules", index))}
                      {source.samples.map((entry, index) => sourceEntry(entry, sourceIndex, "samples", index))}
                    </div>
                  </details>
                ))}
              </div>
            )}

            <Button
              size={isWorkspace ? "sm" : "xs"}
              className="w-full gap-1"
              disabled={busy || state.conflict || !state.draft.name.trim() || (!dirty && state.response?.source === "preset")}
              onClick={() => void save()}
            >
              {state.saving && <Loader2 className="size-3 animate-spin" />}
              {state.saving ? "保存中…" : "保存文风预设"}
            </Button>
            {state.notice && (
              <p role="status" className="text-xs text-muted-foreground">
                {state.notice}
              </p>
            )}
          </div>
        </>
      )}

      {/* 合成指南预览 */}
      <div className={isWorkspace ? "rounded-xl border border-border/80 bg-card p-4 space-y-1.5" : "space-y-1 border-t border-border pt-2"}>
        <p className="text-xs font-medium">合成指南预览</p>
        <p className="text-xs text-muted-foreground">
          {dirty ? "正在预览未保存的修改，保存后生效。" : "以下为当前已保存预设的合成结果。"}
        </p>
        <div
          aria-label="合成指南内容"
          className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded bg-muted/30 p-2.5 text-2xs"
        >
          {guideText || "暂无合成指南。"}
        </div>
      </div>
    </section>
  );
}
