/**
 * 规划留白编辑器（T2.6）：作者在写作台给本章各场景增、删、改留白。
 *
 * - 数据就是本章已落盘的场景（narrative_scene），留白存在场景上；叙述者下次 write.preflight
 *   会在结果与写前召回里读到这些留白。
 * - 每场单独保存，带读取时的 updatedAt；被别处改过时服务端 409，这里提示重新载入，不覆盖。
 * - 合法性判据与服务端同一份（parseSceneGaps）：类别不对、缺口或答案为空的条目保存时会被剔除，
 *   界面先把这些行标出来，作者不会以为存进去了。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, RefreshCw, Save, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Textarea } from "@/components/ui/textarea";
import { ApiRequestError, fetchJson } from "@/hooks/use-api";

import {
  MAX_SCENE_GAPS,
  MAX_SCENE_GAP_TEXT,
  SCENE_GAP_KINDS,
  SCENE_GAP_KIND_LABEL,
  parseSceneGaps,
  type SceneGap,
  type SceneGapKind,
} from "../../handlers/scene-gaps";

export interface EditableScene {
  readonly id: string;
  readonly ordinal: number;
  readonly title: string;
  readonly conflict?: string;
  readonly outcome?: string;
  readonly updatedAt: number;
  readonly gaps: readonly SceneGap[];
}

interface DraftGap {
  kind: SceneGapKind;
  gap: string;
  answer: string;
}

const KIND_OPTIONS = SCENE_GAP_KINDS.map((kind) => ({ value: kind, label: SCENE_GAP_KIND_LABEL[kind] }));

const KIND_HINT: Record<SceneGapKind, string> = {
  motivation: "人物为什么这样做，只有你知道真正的原因",
  detail: "一个关键细节该怎么落，你已经想好了",
  pacing: "这里该快还是慢、写多长",
};

export function chapterScenesPath(bookId: string, chapterNumber: number): string {
  return `/api/books/${encodeURIComponent(bookId)}/narrative-memory/chapters/${chapterNumber}/scenes`;
}

function sceneGapsPath(bookId: string, sceneId: string): string {
  return `/api/books/${encodeURIComponent(bookId)}/narrative-memory/scenes/${encodeURIComponent(sceneId)}/gaps`;
}

function isValidDraft(draft: DraftGap): boolean {
  return parseSceneGaps([draft]).length === 1;
}

function sameGaps(a: readonly DraftGap[], b: readonly SceneGap[]): boolean {
  return a.length === b.length && a.every((item, index) => item.kind === b[index]!.kind && item.gap === b[index]!.gap && item.answer === b[index]!.answer);
}

function SceneGapsCard({ bookId, scene, onSaved }: { readonly bookId: string; readonly scene: EditableScene; readonly onSaved: (scene: EditableScene) => void }) {
  const [drafts, setDrafts] = useState<DraftGap[]>(() => scene.gaps.map((gap) => ({ ...gap })));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error" | "conflict"; text: string } | null>(null);

  useEffect(() => {
    setDrafts(scene.gaps.map((gap) => ({ ...gap })));
  }, [scene.id, scene.updatedAt, scene.gaps]);

  const dirty = !sameGaps(drafts, scene.gaps);
  const invalidCount = drafts.filter((draft) => !isValidDraft(draft)).length;
  const tooLong = drafts.some((draft) => draft.gap.trim().length > MAX_SCENE_GAP_TEXT || draft.answer.trim().length > MAX_SCENE_GAP_TEXT);
  const label = `第 ${scene.ordinal} 场${scene.title ? `「${scene.title}」` : ""}`;

  const update = (index: number, patch: Partial<DraftGap>) => {
    setDrafts((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    setMessage(null);
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const result = await fetchJson<{ ok: boolean; summary: string; data?: EditableScene }>(sceneGapsPath(bookId, scene.id), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: scene.updatedAt, gaps: drafts }),
      });
      if (result.data) onSaved(result.data);
      setMessage({ tone: "ok", text: `${result.summary} 叙述者下次写这一章时会读到。` });
    } catch (error) {
      const text = error instanceof Error ? error.message : "保存失败。";
      const conflict = error instanceof ApiRequestError && error.status === 409;
      setMessage({ tone: conflict ? "conflict" : "error", text: conflict ? "这一场在你打开之后被改过（可能是叙述者重写了本章），为避免覆盖没有保存。请点「重新载入」后再改。" : text });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label={`${label}的留白`} className="space-y-2 rounded-lg border border-border bg-card p-3">
      <header className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-2xs">{label}</Badge>
        {scene.conflict ? <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground" title={scene.conflict}>{scene.conflict}</span> : <span className="flex-1" />}
        <span className="text-2xs text-muted-foreground">{drafts.length} / {MAX_SCENE_GAPS}</span>
      </header>

      {drafts.length === 0 ? (
        <p className="text-xs text-muted-foreground">这一场还没有留白。</p>
      ) : (
        <ul className="space-y-2">
          {drafts.map((draft, index) => {
            const invalid = !isValidDraft(draft);
            return (
              <li key={index} className="space-y-1.5 rounded-md border border-border/60 bg-background/60 p-2">
                <div className="flex items-center gap-2">
                  <SimpleSelect
                    value={draft.kind}
                    onValueChange={(value) => update(index, { kind: value as SceneGapKind })}
                    options={KIND_OPTIONS}
                    className="h-7 w-24 text-xs"
                    aria-label={`${label}留白 ${index + 1} 的类别`}
                  />
                  <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">{KIND_HINT[draft.kind]}</span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    onClick={() => { setDrafts((current) => current.filter((_, i) => i !== index)); setMessage(null); }}
                    aria-label={`删除${label}留白 ${index + 1}`}
                    title="删除这条留白"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <Textarea
                  value={draft.gap}
                  onChange={(event) => update(index, { gap: event.target.value })}
                  placeholder="缺口：读者会追问、但正文不该直说的地方（例：她为什么这次没有反驳）"
                  className="min-h-10 text-xs"
                  aria-label={`${label}留白 ${index + 1} 的缺口`}
                  aria-invalid={invalid && !draft.gap.trim() ? true : undefined}
                />
                <Textarea
                  value={draft.answer}
                  onChange={(event) => update(index, { answer: event.target.value })}
                  placeholder="真实答案：只有你知道的原因或处理方式，叙述者写到这里时按它来"
                  className="min-h-10 text-xs"
                  aria-label={`${label}留白 ${index + 1} 的真实答案`}
                  aria-invalid={invalid && !draft.answer.trim() ? true : undefined}
                />
                {invalid ? <p className="text-2xs text-warning">缺口和真实答案都要填，空着的这条保存时不会存下。</p> : null}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1"
          disabled={drafts.length >= MAX_SCENE_GAPS}
          onClick={() => { setDrafts((current) => [...current, { kind: "motivation", gap: "", answer: "" }]); setMessage(null); }}
        >
          <Plus className="size-3.5" />加一条留白
        </Button>
        <span className="flex-1" />
        <Button type="button" size="sm" className="gap-1" disabled={!dirty || saving || tooLong} onClick={() => void save()}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          保存{invalidCount > 0 ? `（${invalidCount} 条未填完不会存）` : ""}
        </Button>
      </div>
      {tooLong ? <p className="text-2xs text-destructive">缺口和答案每项最多 {MAX_SCENE_GAP_TEXT} 字，请精简后再保存。</p> : null}
      {message ? (
        <p role={message.tone === "ok" ? "status" : "alert"} className={message.tone === "ok" ? "text-2xs text-muted-foreground" : "text-2xs text-destructive"}>{message.text}</p>
      ) : null}
    </section>
  );
}

export interface SceneGapsEditorProps {
  readonly bookId: string;
  readonly chapterNumber: number;
  /** 本章留白总数变化时回报（状态栏显示用）。 */
  readonly onGapCountChange?: (count: number) => void;
}

export function SceneGapsEditor({ bookId, chapterNumber, onGapCountChange }: SceneGapsEditorProps) {
  const [scenes, setScenes] = useState<EditableScene[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // 加载序号：快速切章时，旧章的响应晚到不能把旧章的场景显示在新章标题下（作者会以为在改新章）。
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<{ scenes?: EditableScene[] }>(chapterScenesPath(bookId, chapterNumber));
      if (seq === loadSeq.current) setScenes(data.scenes ?? []);
    } catch (cause) {
      if (seq === loadSeq.current) setError(`读取本章场景失败：${cause instanceof Error ? cause.message : "未知错误"}`);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [bookId, chapterNumber]);

  useEffect(() => {
    // 换章先清掉上一章的场景，新章读回来前不显示别章内容。
    setScenes(null);
    void load();
    return () => { loadSeq.current += 1; };
  }, [load]);

  const gapCount = useMemo(() => (scenes ?? []).reduce((sum, scene) => sum + scene.gaps.length, 0), [scenes]);
  useEffect(() => { if (scenes) onGapCountChange?.(gapCount); }, [gapCount, onGapCountChange, scenes]);

  const createScene = async () => {
    setCreating(true);
    setError(null);
    try {
      await fetchJson(`/api/books/${encodeURIComponent(bookId)}/narrative-memory/scenes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterNumber }),
      });
      await load();
    } catch (cause) {
      setError(`新建场景失败：${cause instanceof Error ? cause.message : "未知错误"}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="scene-gaps-editor">
      <div className="flex items-start gap-2">
        <p className="flex-1 text-xs text-muted-foreground">
          留白是你刻意不让 AI 自己补的地方：动机、细节或节奏上的缺口，配上只有你知道的真实答案。叙述者下次写这一章时会按你的答案处理，不会另编一套标准解答。
        </p>
        <Button type="button" size="icon" variant="ghost" className="size-7 shrink-0" onClick={() => void load()} disabled={loading} aria-label="重新载入本章场景" title="重新载入">
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        </Button>
      </div>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      {scenes && scenes.length === 0 ? (
        <div className="space-y-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          <p>第 {chapterNumber} 章还没有场景。叙述者按蓝图写完本章后会自动生成场景；也可以先手建一场，把留白写上。</p>
          <Button type="button" size="sm" variant="outline" className="gap-1" disabled={creating} onClick={() => void createScene()}>
            {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}新建一场
          </Button>
        </div>
      ) : null}
      {(scenes ?? []).map((scene) => (
        <SceneGapsCard
          key={scene.id}
          bookId={bookId}
          scene={scene}
          onSaved={(saved) => setScenes((current) => (current ?? []).map((item) => (item.id === saved.id ? saved : item)))}
        />
      ))}
    </div>
  );
}
