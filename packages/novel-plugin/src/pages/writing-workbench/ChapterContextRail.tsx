import { useCallback } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/use-api";
import { cn } from "@/lib/utils";

export interface ChapterContextRailProps {
  bookId: string;
  chapterNumber?: number;
  onOpenJingweiEntry?: (entryId: string) => boolean;
  className?: string;
}

interface ContextEntry {
  readonly id: string;
  readonly title?: string;
  readonly lifecycle?: string;
  readonly entryStatus?: string;
  readonly status?: string;
  readonly fields?: Record<string, unknown>;
  readonly customFields?: Record<string, unknown>;
  readonly fieldsJson?: string;
}

interface EntriesResponse {
  readonly entries?: readonly ContextEntry[];
}

interface CockpitChapterResult {
  readonly chapterNumber?: number;
  readonly wordCount?: number;
}

interface CockpitChapterResultsResponse {
  readonly items?: readonly CockpitChapterResult[];
}

export interface DueForeshadowing {
  readonly id: string;
  readonly name: string;
  readonly plantedChapter: number;
  readonly suspenseChapters: number;
}

const AVATAR_COLORS = [
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#dc2626",
  "#d97706",
  "#059669",
  "#0891b2",
  "#65a30d",
] as const;

const SETTLED_FORESHADOWING_STATUSES = new Set(["已回收", "已揭示", "已废弃"]);

function parseFields(entry: ContextEntry): Record<string, unknown> {
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

function textField(fields: Record<string, unknown>, key: string): string | undefined {
  const value = fields[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberField(fields: Record<string, unknown>, key: string): number | undefined {
  const value = fields[key];
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : undefined;
}

function entryName(entry: ContextEntry, fields = parseFields(entry)): string {
  return textField(fields, "name") ?? entry.title?.trim() ?? "未命名条目";
}

function isActiveEntry(entry: ContextEntry): boolean {
  if (typeof entry.lifecycle === "string") return entry.lifecycle === "active";
  if (typeof entry.entryStatus === "string" && ["active", "archived", "inactive", "retired"].includes(entry.entryStatus)) {
    return entry.entryStatus === "active";
  }
  return true;
}

function avatarColor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function selectDueForeshadowings(
  entries: readonly ContextEntry[],
  chapterNumber: number | undefined,
  limit = 5,
): DueForeshadowing[] {
  if (chapterNumber === undefined) return [];

  return entries
    .filter(isActiveEntry)
    .map((entry) => {
      const fields = parseFields(entry);
      const status = textField(fields, "status") ?? entry.status;
      const plantedChapter = numberField(fields, "plantedChapter");
      const suspenseChapters = plantedChapter === undefined ? 0 : chapterNumber - plantedChapter;
      return {
        id: entry.id,
        name: entryName(entry, fields),
        plantedChapter: plantedChapter ?? 0,
        suspenseChapters,
        status,
      };
    })
    .filter((item) => (
      item.plantedChapter > 0
      && item.suspenseChapters >= 3
      && !SETTLED_FORESHADOWING_STATUSES.has(item.status ?? "")
    ))
    .sort((left, right) => right.suspenseChapters - left.suspenseChapters)
    .slice(0, limit)
    .map(({ status: _status, ...item }) => item);
}

function retryButton(onRetry: () => void, label: string) {
  return (
    <button
      type="button"
      onClick={onRetry}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/10"
    >
      <RefreshCw className="size-3" />
      {label}
    </button>
  );
}

function SectionHeader({
  title,
  loading,
  count,
  action,
}: {
  readonly title: string;
  readonly loading: boolean;
  readonly count?: number;
  readonly action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 border-b border-border/60 px-3 py-2">
      <h2 className="min-w-0 flex-1 truncate text-[11px] font-semibold text-foreground">{title}</h2>
      {loading ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> : null}
      {typeof count === "number" && count > 0 ? (
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">{count}</span>
      ) : null}
      {action}
    </div>
  );
}

function SectionError({ error, onRetry }: { readonly error: string; readonly onRetry: () => void }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-2 text-[11px] text-destructive">
      <AlertTriangle className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">加载失败</span>
      {retryButton(onRetry, "重试")}
      <span className="sr-only">{error}</span>
    </div>
  );
}

function SectionSkeleton({ kind }: { readonly kind: "avatars" | "rows" }) {
  return kind === "avatars" ? (
    <div className="flex gap-2 px-3 py-3">
      {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="size-8 rounded-full" />)}
    </div>
  ) : (
    <div className="flex flex-col gap-2 px-3 py-3">
      {[0, 1, 2].map((item) => <Skeleton key={item} className="h-5 w-full" />)}
    </div>
  );
}

export function ChapterContextRail({
  bookId,
  chapterNumber,
  onOpenJingweiEntry,
  className,
}: ChapterContextRailProps) {
  const characterQuery = useApi<EntriesResponse>(
    `/api/books/${encodeURIComponent(bookId)}/jingwei/entries?category=characters&limit=10`,
  );
  const foreshadowingQuery = useApi<EntriesResponse>(
    `/api/books/${encodeURIComponent(bookId)}/jingwei/entries?category=foreshadowing&limit=10`,
  );
  const cockpitQuery = useApi<CockpitChapterResultsResponse>(
    `/api/books/${encodeURIComponent(bookId)}/cockpit/recent-chapter-results?limit=50`,
  );

  const reload = useCallback(() => {
    void Promise.allSettled([
      characterQuery.refetch(),
      foreshadowingQuery.refetch(),
      cockpitQuery.refetch(),
    ]);
  }, [characterQuery, cockpitQuery, foreshadowingQuery]);

  const characterEntries = (characterQuery.data?.entries ?? []).filter(isActiveEntry);
  const characterModels = characterEntries.map((entry) => {
    const fields = parseFields(entry);
    return {
      id: entry.id,
      name: entryName(entry, fields),
      motive: textField(fields, "core_motive"),
      fear: textField(fields, "core_fear"),
      injury: textField(fields, "injury") ?? textField(fields, "fields.injury"),
    };
  });
  const dueForeshadowings = selectDueForeshadowings(foreshadowingQuery.data?.entries ?? [], chapterNumber);
  const wordCount = cockpitQuery.data?.items?.find((item) => item.chapterNumber === chapterNumber)?.wordCount;
  const isReloading = characterQuery.loading || foreshadowingQuery.loading || cockpitQuery.loading;

  const openEntry = (entryId: string) => {
    onOpenJingweiEntry?.(entryId);
  };

  return (
    <aside
      className={cn("flex h-full min-h-0 w-[280px] shrink-0 flex-col overflow-y-auto bg-card text-card-foreground", className)}
      data-testid="chapter-context-rail"
    >
      <header className="flex shrink-0 items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] font-semibold text-foreground">
              {typeof chapterNumber === "number" ? `第 ${chapterNumber} 章` : "未选择章节"}
            </span>
            {typeof wordCount === "number" ? (
              <span className="text-[11px] tabular-nums text-muted-foreground">{wordCount.toLocaleString()} 字</span>
            ) : null}
            {typeof chapterNumber === "number" && typeof wordCount === "number" ? (
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${wordCount > 0 ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                {wordCount > 0 ? "已收稿" : "未收稿"}
              </span>
            ) : null}
          </div>
          {cockpitQuery.error ? (
            <div className="mt-1 flex items-center gap-1 text-[10px] text-destructive">
              <span>字数加载失败</span>
              {retryButton(() => void cockpitQuery.refetch(), "重试")}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={reload}
          disabled={isReloading}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          title="刷新本章上下文"
          aria-label="刷新本章上下文"
          data-testid="chapter-context-refresh"
        >
          {isReloading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        </button>
      </header>

      <section className="shrink-0 border-b border-border">
        <SectionHeader
          title="出场角色内核"
          loading={characterQuery.loading}
          count={characterModels.length}
          action={characterModels[0] && onOpenJingweiEntry ? (
            <button
              type="button"
              onClick={() => openEntry(characterModels[0]!.id)}
              className="shrink-0 text-[10px] text-primary hover:underline"
            >
              编辑 →
            </button>
          ) : null}
        />
        {characterQuery.error ? <SectionError error={characterQuery.error} onRetry={() => void characterQuery.refetch()} /> : null}
        {!characterQuery.error && characterQuery.loading && characterModels.length === 0 ? <SectionSkeleton kind="avatars" /> : null}
        {!characterQuery.error && !characterQuery.loading && characterModels.length === 0 ? (
          <p className="px-3 py-3 text-[11px] text-muted-foreground">暂无出场角色</p>
        ) : null}
        {characterModels.length > 0 ? (
          <div className="flex items-center gap-2 px-3 py-3">
            {characterModels.slice(0, 5).map((character) => {
              const tooltip = [
                character.name,
                character.motive ? `核心动机：${character.motive}` : null,
                character.fear ? `最深恐惧：${character.fear}` : null,
                character.injury ? `伤势：${character.injury}` : null,
              ].filter(Boolean).join("\n");
              return (
                <button
                  key={character.id}
                  type="button"
                  onClick={() => openEntry(character.id)}
                  title={tooltip}
                  aria-label={`打开角色 ${character.name}`}
                  className="flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md"
                  style={{ backgroundColor: avatarColor(character.name) }}
                >
                  {character.name.slice(0, 2)}
                </button>
              );
            })}
            {characterModels.length > 5 ? (
              <button
                type="button"
                onClick={() => openEntry(characterModels[0]!.id)}
                className="shrink-0 rounded-full bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
                title="打开角色卡"
              >
                +{characterModels.length - 5}
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="shrink-0 border-b border-border">
        <SectionHeader title="本章到期伏笔" loading={foreshadowingQuery.loading} count={dueForeshadowings.length} />
        {foreshadowingQuery.error ? <SectionError error={foreshadowingQuery.error} onRetry={() => void foreshadowingQuery.refetch()} /> : null}
        {!foreshadowingQuery.error && foreshadowingQuery.loading && dueForeshadowings.length === 0 ? <SectionSkeleton kind="rows" /> : null}
        {!foreshadowingQuery.error && !foreshadowingQuery.loading && dueForeshadowings.length === 0 ? (
          <p className="px-3 py-3 text-[11px] text-muted-foreground">暂无到期伏笔</p>
        ) : null}
        {dueForeshadowings.length > 0 ? (
          <ul className="flex flex-col gap-1.5 px-3 py-2.5">
            {dueForeshadowings.map((foreshadowing) => (
              <li key={foreshadowing.id} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
                <span className="min-w-0 flex-1 truncate text-[11px] text-foreground" title={foreshadowing.name}>{foreshadowing.name}</span>
                <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                  已埋 {foreshadowing.suspenseChapters} 章
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="shrink-0 border-b border-border">
        <SectionHeader title="欠账清单" loading={foreshadowingQuery.loading} count={dueForeshadowings.length} />
        {foreshadowingQuery.error ? <SectionError error={foreshadowingQuery.error} onRetry={() => void foreshadowingQuery.refetch()} /> : null}
        {!foreshadowingQuery.error && foreshadowingQuery.loading && dueForeshadowings.length === 0 ? <SectionSkeleton kind="rows" /> : null}
        {!foreshadowingQuery.error && !foreshadowingQuery.loading && dueForeshadowings.length === 0 ? (
          <p className="px-3 py-3 text-[11px] text-muted-foreground">暂无欠账</p>
        ) : null}
        {dueForeshadowings.length > 0 ? (
          <ul className="flex flex-col gap-1 px-3 py-2.5">
            {dueForeshadowings.map((foreshadowing) => (
              <li key={foreshadowing.id} className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
                ⚠️ {foreshadowing.name}（第{foreshadowing.plantedChapter}章埋设，已{foreshadowing.suspenseChapters}章未推进）
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </aside>
  );
}
