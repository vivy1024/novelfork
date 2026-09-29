import { useEffect, useRef, useState } from "react";
import { Loader2, Palette } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiRequestError, fetchJson } from "@/hooks/use-api";
import { composeStyleGuide, createStylePreset, type StylePreset } from "../../../engine/writing-layers/style-preset";

type SourceRule = StylePreset["sources"][number]["rules"][number];
type SourceSample = StylePreset["sources"][number]["samples"][number];

export interface StylePresetResponse {
  preset: StylePreset | null;
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
  sources: StylePreset["sources"];
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

interface StylePresetEditorProps {
  bookId: string;
  refreshKey?: number;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}

const SCENE_LABELS: Record<SourceSample["sceneType"], string> = {
  dialogue: "对话", action: "动作", description: "描写", interiority: "内心", transition: "转场", general: "通用",
};

function toDraft(preset: StylePreset | null): Draft {
  const value = preset ?? createStylePreset();
  return {
    name: value.name,
    generalRules: value.generalRules.join("\n"),
    tone: value.bookVoice.tone,
    narrativeVoice: value.bookVoice.narrativeVoice,
    principles: value.bookVoice.principles.join("\n"),
    sources: value.sources,
  };
}

function lines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function toPreset(draft: Draft, stored: StylePreset | null): StylePreset {
  const preset = stored ?? createStylePreset();
  return { ...preset, name: draft.name.trim(), generalRules: lines(draft.generalRules), sources: draft.sources,
    bookVoice: { ...preset.bookVoice, tone: draft.tone.trim(), narrativeVoice: draft.narrativeVoice.trim(),
      principles: lines(draft.principles) } };
}

function isDirty(state: EditorState): boolean {
  return state.draft !== null && JSON.stringify(state.draft) !== JSON.stringify(toDraft(state.response?.preset ?? null));
}

export function StylePresetEditor(props: StylePresetEditorProps) {
  // 每次切书都建立独立编辑会话，旧书的异步响应只能回到已卸载的会话。
  return <BookStylePresetEditor key={props.bookId} {...props} />;
}

function BookStylePresetEditor({ bookId, refreshKey = 0, disabled = false, onBusyChange }: StylePresetEditorProps) {
  const [state, setState] = useState<EditorState>({
    response: null, draft: null, loading: true, saving: false, conflict: false, error: null, notice: null,
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const mounted = useRef(false);
  const lastRefreshKey = useRef(refreshKey);
  const [reloadKey, setReloadKey] = useState(0);
  const path = `/api/books/${encodeURIComponent(bookId)}/style/preset`;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    onBusyChange?.(state.loading || state.saving);
    return () => onBusyChange?.(false);
  }, [onBusyChange, state.loading, state.saving]);

  useEffect(() => {
    const controller = new AbortController();
    const preserveDraft = lastRefreshKey.current !== refreshKey;
    lastRefreshKey.current = refreshKey;
    let active = true;
    setState((current) => ({ ...current, loading: true, error: null, notice: null }));
    void fetchJson<StylePresetResponse>(path, { signal: controller.signal }).then((response) => {
      if (!active) return;
      const current = stateRef.current;
      // 统计更新只改变指纹时，可安全更新版本并保留未保存的创作文字。
      // 若期间其他作者也改了预设，不把本地整份草稿写到那个新版本上。
      const changedElsewhere = preserveDraft && isDirty(current)
        && JSON.stringify(toDraft(current.response?.preset ?? null)) !== JSON.stringify(toDraft(response.preset));
      if (changedElsewhere || (preserveDraft && current.conflict)) {
        setState((value) => ({ ...value, loading: false, conflict: true,
          error: "文风预设已有新版本，本地修改尚未保存。请先保留需要的文字，再重新载入。" }));
        return;
      }
      setState((value) => ({ ...value, response,
        draft: preserveDraft && isDirty(value) ? value.draft : toDraft(response.preset),
        loading: false, conflict: false, error: null }));
    }).catch((cause: unknown) => {
      if (!active) return;
      setState((current) => ({ ...current, loading: false,
        error: cause instanceof Error ? cause.message : "读取文风预设失败，请重新载入。" }));
    });
    return () => { active = false; controller.abort(); };
  }, [path, refreshKey, reloadKey]);

  const busy = disabled || state.loading || state.saving;
  const dirty = isDirty(state);
  const guideText = dirty && state.draft
    ? composeStyleGuide(toPreset(state.draft, state.response?.preset ?? null))
    : state.response?.guideText;

  function updateDraft(patch: Partial<Draft>) {
    setState((current) => ({ ...current, draft: current.draft ? { ...current.draft, ...patch } : null, notice: null }));
  }

  function confirm(sourceIndex: number, collection: "rules" | "samples", index: number) {
    if (!state.draft) return;
    updateDraft({ sources: state.draft.sources.map((source, i) => i !== sourceIndex ? source : {
      ...source,
      [collection]: source[collection].map((entry, j) => j !== index ? entry : {
        ...entry, status: entry.status === "confirmed" ? "needs-review" : "confirmed",
      }),
    }) });
  }

  async function save() {
    if (busy || state.conflict || !state.draft || !state.response || !state.draft.name.trim()) return;
    const preset = toPreset(state.draft, state.response.preset);
    setState((current) => ({ ...current, saving: true, error: null, notice: null }));
    try {
      const response = await fetchJson<StylePresetResponse>(path, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: state.response.revision, preset }),
      });
      window.dispatchEvent(new CustomEvent("novelfork:style-preset-updated", { detail: { bookId } }));
      if (!mounted.current) return;
      setState((current) => ({ ...current, response, draft: toDraft(response.preset),
        saving: false, conflict: false, notice: "文风预设已保存。" }));
    } catch (cause) {
      if (!mounted.current) return;
      const conflict = cause instanceof ApiRequestError && cause.status === 409;
      setState((current) => ({ ...current, saving: false, conflict,
        error: conflict
          ? "保存冲突：文风预设已有新版本，本地修改尚未保存。请先保留需要的文字，再重新载入。"
          : cause instanceof Error ? cause.message : "保存文风预设失败，请重试。" }));
    }
  }

  function sourceEntry(entry: SourceRule, sourceIndex: number, collection: "rules" | "samples", index: number) {
    return (
      <div key={collection === "samples" ? (entry as SourceSample).id : index} className="space-y-1 rounded bg-muted/30 p-2">
        <div className="flex flex-wrap items-center gap-1">
          {collection === "samples" && <Badge variant="outline">{SCENE_LABELS[(entry as SourceSample).sceneType]}样文</Badge>}
          <Badge variant="secondary">{entry.transfer === "transferable" ? "可迁移" : "作品专属"}</Badge>
          <Badge variant="outline">{entry.status === "confirmed" ? "已确认" : "待审"}</Badge>
        </div>
        <p className="whitespace-pre-wrap break-words text-xs">{entry.text}</p>
        <p className="whitespace-pre-wrap break-words text-2xs text-muted-foreground">证据：{entry.evidence || "未提供"}</p>
        <Button size="xs" variant="ghost" disabled={busy}
          aria-label={`${entry.status === "confirmed" ? "撤回确认" : "确认"}：${entry.text}`}
          onClick={() => confirm(sourceIndex, collection, index)}>
          {entry.status === "confirmed" ? "撤回确认" : "确认"}
        </Button>
      </div>
    );
  }

  return (
    <section aria-label="本书文风预设" className="space-y-3 rounded-lg border border-border/80 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-medium"><Palette className="size-3.5 text-primary" />本书文风预设</div>
        <Button size="xs" variant="ghost" disabled={busy} onClick={() => setReloadKey((value) => value + 1)}>重新载入</Button>
      </div>
      <p className="text-2xs text-muted-foreground">每本书使用一份文风预设。重新载入会放弃本地未保存的修改。</p>
      {state.response?.source === "legacy" && <p className="text-2xs text-muted-foreground">已沿用旧统计基线，首次保存后升级为本书文风预设。</p>}
      {state.loading && <p role="status" className="text-2xs text-muted-foreground">正在读取文风预设…</p>}
      {state.error && <p role="alert" className="rounded border border-destructive/30 bg-destructive/5 p-2 text-2xs text-destructive">{state.error}</p>}
      {state.draft && <>
        <fieldset disabled={busy} className="min-w-0 space-y-2">
          <label className="block space-y-1"><span>预设名称</span>
            <Input value={state.draft.name} maxLength={120} onChange={(event) => updateDraft({ name: event.target.value })} className="text-xs" />
          </label>
          <label className="block space-y-1"><span>通用写法（每行一条）</span>
            <Textarea aria-label="通用写法（每行一条）" value={state.draft.generalRules} onChange={(event) => updateDraft({ generalRules: event.target.value })} className="resize-y text-xs" />
          </label>
          <label className="block space-y-1"><span>基调</span>
            <Input value={state.draft.tone} onChange={(event) => updateDraft({ tone: event.target.value })} className="text-xs" />
          </label>
          <label className="block space-y-1"><span>叙事声音</span>
            <Textarea aria-label="叙事声音" value={state.draft.narrativeVoice} onChange={(event) => updateDraft({ narrativeVoice: event.target.value })} className="resize-y text-xs" />
          </label>
          <label className="block space-y-1"><span>本书创作原则（每行一条）</span>
            <Textarea aria-label="本书创作原则（每行一条）" value={state.draft.principles} onChange={(event) => updateDraft({ principles: event.target.value })} className="resize-y text-xs" />
          </label>
        </fieldset>
        {state.draft.sources.length > 0 && <div className="space-y-2">
          <p className="font-medium">来源包</p>
          <p className="text-2xs text-muted-foreground">仅已确认且可迁移的规则进入指南；作品专属内容即使确认也不会进入。样文目前仅供审阅，按场景使用尚未接入。</p>
          {state.draft.sources.map((source, sourceIndex) => <details key={source.id} open className="space-y-2 rounded border border-border p-2">
            <summary className="cursor-pointer font-medium">{source.title}</summary>
            {source.rules.map((entry, index) => sourceEntry(entry, sourceIndex, "rules", index))}
            {source.samples.map((entry, index) => sourceEntry(entry, sourceIndex, "samples", index))}
          </details>)}
        </div>}
        <Button size="xs" className="w-full gap-1" disabled={busy || state.conflict || !state.draft.name.trim() || (!dirty && state.response?.source === "preset")}
          onClick={() => void save()}>
          {state.saving && <Loader2 className="size-3 animate-spin" />}{state.saving ? "保存中…" : "保存文风预设"}
        </Button>
        {state.notice && <p role="status" className="text-2xs text-muted-foreground">{state.notice}</p>}
      </>}
      <div className="space-y-1 border-t border-border pt-2">
        <p className="font-medium">合成指南预览</p>
        <p className="text-2xs text-muted-foreground">{dirty ? "正在预览未保存的修改，保存后生效。" : "以下为当前已保存预设的合成结果。"}</p>
        <div aria-label="合成指南内容" className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded bg-muted/30 p-2 text-2xs">
          {guideText || "暂无合成指南。"}
        </div>
      </div>
    </section>
  );
}
