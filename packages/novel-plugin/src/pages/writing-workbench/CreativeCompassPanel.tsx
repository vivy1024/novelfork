/**
 * 创作罗盘常驻面板 —— 写作侧栏里编辑近 1-3 章焦点。
 *
 * 四字段落盘经纬单例 category=current-focus（不新增统一分类枚举）。
 * 驾驶舱 / write.preflight / pipeline.write 共用同一份条目。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Compass, Loader2, RefreshCw } from "lucide-react";
import { fetchJson, invalidateApiPaths, useApi } from "@/hooks/use-api";
import {
  CURRENT_FOCUS_CATEGORY,
  CURRENT_FOCUS_TITLE,
  currentFocusHasContent,
  emptyCurrentFocus,
  parseCurrentFocusFields,
  serializeCurrentFocusDoc,
  type CurrentFocusFields,
} from "../../engine/jingwei/current-focus";

export type { CurrentFocusFields };

interface CompassEntry {
  readonly id: string;
  readonly title?: string;
  readonly category?: string;
  readonly contentMd?: string;
  readonly fields?: Record<string, unknown>;
  readonly customFields?: Record<string, unknown>;
  readonly fieldsJson?: string;
  readonly updatedAt?: string;
}

interface EntriesResponse {
  readonly entries?: readonly CompassEntry[];
  readonly entry?: CompassEntry;
}

export interface CreativeCompassPanelProps {
  readonly bookId: string;
  /** 把罗盘「本章目标」填进写作指示框。 */
  readonly onFillDirective?: (goal: string) => void;
}

function parseEntryFields(entry: CompassEntry): Record<string, unknown> {
  const fromJson = typeof entry.fieldsJson === "string"
    ? (() => {
        try {
          const parsed: unknown = JSON.parse(entry.fieldsJson);
          return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : {};
        } catch {
          return {};
        }
      })()
    : {};
  return {
    ...fromJson,
    ...(entry.customFields ?? {}),
    ...(entry.fields ?? {}),
  };
}

export function pickCurrentFocusEntry(entries: readonly CompassEntry[]): CompassEntry | undefined {
  const matches = entries.filter((entry) => entry.category === CURRENT_FOCUS_CATEGORY || entry.category === "focus");
  if (matches.length === 0) return undefined;
  return [...matches].sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))[0];
}

function sameFields(left: CurrentFocusFields, right: CurrentFocusFields): boolean {
  return left.goal === right.goal
    && left.mustKeep === right.mustKeep
    && left.mustAvoid === right.mustAvoid
    && left.notes === right.notes;
}

const FIELDS: ReadonlyArray<{ key: keyof CurrentFocusFields; label: string; placeholder: string; rows: number }> = [
  { key: "goal", label: "本章目标", placeholder: "近 1-3 章最该推进的一件事，例如：让林舟通过守门人试炼。", rows: 2 },
  { key: "mustKeep", label: "必须守住", placeholder: "本章不能丢掉的承诺、人设、伏笔或节奏。", rows: 2 },
  { key: "mustAvoid", label: "必须避开", placeholder: "本章禁止的走向、OOC、提前揭底或跑题。", rows: 2 },
  { key: "notes", label: "备注", placeholder: "只给自己看的提醒，可空。", rows: 2 },
];

export function CreativeCompassPanel({ bookId, onFillDirective }: CreativeCompassPanelProps) {
  const listPath = `/api/books/${encodeURIComponent(bookId)}/jingwei/entries?category=${encodeURIComponent(CURRENT_FOCUS_CATEGORY)}`;
  const { data, loading, error, refetch } = useApi<EntriesResponse>(listPath);
  const [draft, setDraft] = useState<CurrentFocusFields>(emptyCurrentFocus());
  const [entryId, setEntryId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedRef = useRef<CurrentFocusFields>(emptyCurrentFocus());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedRef = useRef<{ bookId: string; nonce: number } | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (loading) return;
    const already = hydratedRef.current?.bookId === bookId && hydratedRef.current?.nonce === reloadNonce;
    if (already) return;
    hydratedRef.current = { bookId, nonce: reloadNonce };
    const entry = pickCurrentFocusEntry(data?.entries ?? []);
    if (!entry) {
      setEntryId(null);
      const empty = emptyCurrentFocus();
      setDraft(empty);
      savedRef.current = empty;
      return;
    }
    const next = parseCurrentFocusFields(parseEntryFields(entry));
    setEntryId(entry.id);
    setDraft(next);
    savedRef.current = next;
  }, [bookId, data, loading, reloadNonce]);

  const persist = useCallback(async (fields: CurrentFocusFields) => {
    if (sameFields(fields, savedRef.current)) return;
    setStatus("saving");
    setSaveError(null);
    const contentMd = serializeCurrentFocusDoc(fields);
    try {
      if (entryId) {
        await fetchJson(`/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(entryId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: CURRENT_FOCUS_TITLE,
            contentMd,
            fieldsPatch: fields,
            category: CURRENT_FOCUS_CATEGORY,
          }),
        });
      } else {
        const created = await fetchJson<EntriesResponse>(
          `/api/books/${encodeURIComponent(bookId)}/jingwei/entries`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              category: CURRENT_FOCUS_CATEGORY,
              title: CURRENT_FOCUS_TITLE,
              contentMd,
              fields,
              participatesInAi: true,
              priorityTier: "core",
              layer: "dynamic",
            }),
          },
        );
        const id = created.entry?.id;
        if (id) setEntryId(id);
      }
      savedRef.current = fields;
      setStatus("saved");
      invalidateApiPaths([`/api/books/${encodeURIComponent(bookId)}/jingwei/entries`]);
    } catch (cause) {
      setStatus("error");
      setSaveError(cause instanceof Error ? cause.message : "创作罗盘保存失败");
    }
  }, [bookId, entryId]);

  const scheduleSave = useCallback((next: CurrentFocusFields) => {
    setDraft(next);
    setStatus("idle");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void persist(next);
    }, 600);
  }, [persist]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const statusLabel = status === "saving"
    ? "保存中…"
    : status === "saved"
      ? "已落盘经纬"
      : status === "error"
        ? (saveError ?? "保存失败")
        : currentFocusHasContent(draft)
          ? "有未保存改动将自动写入"
          : "空罗盘不阻断写作";

  return (
    <section className="rounded-md border border-border bg-card/40 px-2 py-1.5" data-testid="creative-compass">
      <div className="flex items-center gap-1.5">
        <Compass className="size-3.5 text-primary" />
        <span className="min-w-0 flex-1 text-2xs font-medium text-foreground">创作罗盘</span>
        {loading ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> : null}
        <button
          type="button"
          onClick={() => {
            hydratedRef.current = null;
            setReloadNonce((value) => value + 1);
            void refetch();
          }}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="刷新创作罗盘"
        >
          <RefreshCw className="size-3" />
        </button>
      </div>
      <p className="mt-0.5 text-2xs text-muted-foreground">
        近 1–3 章焦点。会写入经纬 current-focus，并注入写章上下文。
      </p>
      {error ? <p className="mt-1 text-2xs text-destructive">加载失败：{error}</p> : null}
      <div className="mt-1.5 flex flex-col gap-1.5">
        {FIELDS.map((field) => (
          <label key={field.key} className="grid gap-0.5 text-2xs text-muted-foreground">
            {field.label}
            <textarea
              value={draft[field.key]}
              rows={field.rows}
              placeholder={field.placeholder}
              data-testid={`creative-compass-${field.key}`}
              className="resize-none rounded border border-border bg-background px-2 py-1 text-2xs text-foreground outline-none focus:border-primary"
              onChange={(event) => scheduleSave({ ...draft, [field.key]: event.currentTarget.value })}
            />
          </label>
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span
          className={`text-2xs ${status === "error" ? "text-destructive" : "text-muted-foreground"}`}
          data-testid="creative-compass-status"
        >
          {statusLabel}
        </span>
        {draft.goal.trim() && onFillDirective ? (
          <button
            type="button"
            className="text-2xs text-primary hover:underline"
            data-testid="creative-compass-fill-directive"
            onClick={() => onFillDirective(draft.goal.trim())}
          >
            填入本章指示
          </button>
        ) : null}
      </div>
    </section>
  );
}
