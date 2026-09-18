/**
 * 经纬权威设定面板 — 角色卡 / 世界卡共用。
 *
 * 卡片视图把分类、层级、可见性、关联、历史、结构化字段藏掉了；
 * 这里把这些能力收回来。状态由父组件持有，保存时并入 payload。
 */

import { useEffect, useMemo, useState } from "react";
import { History, Link2, Loader2, RotateCcw, X } from "lucide-react";

import { ApiRequestError, fetchJson } from "@/hooks/use-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { CATEGORY_SCHEMAS, getCategorySchema, type CategoryFieldSchema } from "./jingwei/category-schemas";
import type { JingweiEntryData, JingweiPriorityTier, RelatedEntryItem } from "./JingweiEntryEditor";

export type JingweiVisibility = "global" | "tracked" | "nested";

export interface JingweiCanonValues {
  readonly category: string;
  readonly layer: string;
  readonly visibility: JingweiVisibility;
  readonly status: string;
  readonly priorityTier: JingweiPriorityTier;
  readonly aliases: readonly string[];
  readonly relatedEntryIds: readonly string[];
  readonly fields: Record<string, unknown>;
}

export interface JingweiCanonSaveSlice {
  readonly category: string;
  readonly layer: string;
  readonly status: string;
  readonly priorityTier: JingweiPriorityTier;
  readonly aliases: string[];
  readonly relatedEntryIds: string[];
  readonly visibility: JingweiVisibility;
  readonly visibleAfterChapter: number | null;
  readonly visibleUntilChapter: number | null;
  readonly fields: Record<string, unknown>;
}

interface RevisionRecord {
  id: string;
  content_md: string;
  category?: string | null;
  layer?: string | null;
  snapshot?: {
    title?: string;
    contentMd?: string;
    priorityTier?: JingweiPriorityTier;
    fields?: Record<string, unknown>;
    status?: string;
    layer?: string;
    category?: string;
    aliases?: string[];
    relatedEntryIds?: string[];
    visibility?: JingweiVisibility;
  } | null;
  reason?: string | null;
  changed_by: string;
  created_at: number;
}

const SOURCE_LABELS: Record<string, string> = {
  user: "手动编辑",
  "agent-write": "AI 写作",
  "auto-settle": "自动整理",
  "system-init": "系统初始化",
  "ai-enrich": "AI 丰富",
};

function sourceBadgeVariant(src: string): "default" | "secondary" | "outline" {
  if (src === "user") return "default";
  if (src.startsWith("agent") || src.startsWith("ai")) return "secondary";
  return "outline";
}

function requestStatus(cause: unknown): number | undefined {
  if (typeof ApiRequestError === "function" && cause instanceof ApiRequestError) return cause.status;
  if (cause && typeof cause === "object" && "status" in cause) {
    const status = (cause as { status?: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }
  return undefined;
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function fieldValueToInput(value: unknown, field: CategoryFieldSchema): string {
  if (value == null) return "";
  if (field.type === "tags" || field.type === "multi-select") {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join("，") : String(value);
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function parseFieldInput(field: CategoryFieldSchema, raw: string): unknown {
  if (field.type === "number" || field.type === "chapter") {
    if (raw.trim() === "") return "";
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : raw;
  }
  if (field.type === "boolean") return raw === "true";
  if (field.type === "tags" || field.type === "multi-select") {
    return raw.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
  }
  return raw;
}

export function canonValuesFromEntry(entry: JingweiEntryData): JingweiCanonValues {
  return {
    category: entry.category ?? "unclassified",
    layer: entry.layer ?? "dynamic",
    visibility: entry.visibility ?? "tracked",
    status: entry.status ?? "confirmed",
    priorityTier: entry.priorityTier ?? "auto",
    aliases: [...(entry.aliases ?? [])],
    relatedEntryIds: [...(entry.relatedEntryIds ?? [])],
    fields: { ...(entry.fields ?? {}) },
  };
}

export function toCanonSaveSlice(values: JingweiCanonValues, entry: JingweiEntryData): JingweiCanonSaveSlice {
  return {
    category: values.category,
    layer: values.layer,
    status: values.status,
    priorityTier: values.priorityTier,
    aliases: [...values.aliases],
    relatedEntryIds: [...values.relatedEntryIds],
    visibility: values.visibility,
    visibleAfterChapter: entry.visibleAfterChapter ?? null,
    visibleUntilChapter: entry.visibleUntilChapter ?? null,
    fields: values.fields,
  };
}

export function JingweiSchemaField({
  field,
  value,
  onChange,
}: {
  field: CategoryFieldSchema;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const inputId = `jingwei-field-${field.key}`;
  const display = fieldValueToInput(value, field);
  const controlClass = "w-full h-8 text-xs rounded-md border border-input bg-background px-2";
  return (
    <div>
      <label htmlFor={inputId} className="text-xs text-muted-foreground mb-1 block">{field.label}{field.required ? " *" : ""}</label>
      {field.type === "textarea" ? (
        <Textarea
          id={inputId}
          value={display}
          onChange={(event) => onChange(parseFieldInput(field, event.target.value))}
          className="min-h-16 text-xs"
        />
      ) : field.type === "select" ? (
        <select
          id={inputId}
          value={display}
          onChange={(event) => onChange(parseFieldInput(field, event.target.value))}
          className={controlClass}
        >
          <option value="">未选择</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      ) : field.type === "boolean" ? (
        <select
          id={inputId}
          value={display === "true" ? "true" : "false"}
          onChange={(event) => onChange(parseFieldInput(field, event.target.value))}
          className={controlClass}
        >
          <option value="false">否</option>
          <option value="true">是</option>
        </select>
      ) : (
        <Input
          id={inputId}
          type={field.type === "number" || field.type === "chapter" ? "number" : "text"}
          value={display}
          onChange={(event) => onChange(parseFieldInput(field, event.target.value))}
          className="h-8 text-xs"
        />
      )}
      {field.helpText ? <p className="mt-1 text-2xs text-muted-foreground">{field.helpText}</p> : null}
    </div>
  );
}

export interface JingweiCanonPanelProps {
  readonly entry: JingweiEntryData;
  readonly bookId?: string;
  readonly values: JingweiCanonValues;
  readonly onChange: (next: JingweiCanonValues) => void;
  readonly relatedEntries?: RelatedEntryItem[];
  readonly hiddenFieldKeys?: readonly string[];
  /** 角色卡已有别名输入时关掉，避免两处改同一字段。 */
  readonly showAliases?: boolean;
  readonly onNavigateToEntry?: (entryId: string) => void;
  /** 回滚成功后把完整条目交给父组件（标题/正文也要跟着改）。 */
  readonly onRestored?: (entry: JingweiEntryData) => void;
}

export function JingweiCanonPanel({
  entry,
  bookId,
  values,
  onChange,
  relatedEntries,
  hiddenFieldKeys = ["name"],
  showAliases = true,
  onNavigateToEntry,
  onRestored,
}: JingweiCanonPanelProps) {
  const [aliasInput, setAliasInput] = useState("");
  const [relationSearch, setRelationSearch] = useState("");
  const [relationSearchResults, setRelationSearchResults] = useState<RelatedEntryItem[]>([]);
  const [relationAdding, setRelationAdding] = useState(false);
  const [resolvedRelatedEntries, setResolvedRelatedEntries] = useState<RelatedEntryItem[]>([]);
  const [revisionRecords, setRevisionRecords] = useState<RevisionRecord[]>([]);
  const [revisionLoading, setRevisionLoading] = useState(false);
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [revertingRevisionId, setRevertingRevisionId] = useState<string | null>(null);
  const [revertError, setRevertError] = useState<string | null>(null);

  const schemaFields = useMemo(
    () => (getCategorySchema(values.category)?.fields ?? []).filter((field) => !hiddenFieldKeys.includes(field.key)),
    [hiddenFieldKeys, values.category],
  );
  const relatedIdsKey = values.relatedEntryIds.join("\u0000");
  const relatedEntriesKey = (relatedEntries ?? []).map((item) => `${item.id}\u0000${item.title}`).join("\u0001");
  const relationItems = useMemo(() => {
    const titles = new Map<string, string>();
    for (const item of [...resolvedRelatedEntries, ...(relatedEntries ?? []), ...relationSearchResults]) {
      if (item.id) titles.set(item.id, item.title);
    }
    return values.relatedEntryIds.map((id) => ({ id, title: titles.get(id) ?? id }));
  }, [relatedEntries, relationSearchResults, resolvedRelatedEntries, values.relatedEntryIds]);

  useEffect(() => {
    if (!bookId) {
      setRevisionRecords([]);
      setRevisionError(null);
      setResolvedRelatedEntries(relatedEntries ?? []);
      return;
    }
    let cancelled = false;
    setRevisionLoading(true);
    setRevisionError(null);
    void fetchJson<{ revisions?: RevisionRecord[] }>(
      `/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(entry.id)}/revisions`,
    )
      .then((data) => {
        if (cancelled) return;
        setRevisionRecords(Array.isArray(data.revisions) ? data.revisions : []);
      })
      .catch((cause) => {
        if (cancelled) return;
        setRevisionRecords([]);
        const status = requestStatus(cause);
        setRevisionError(status ? `历史加载失败（${status}）` : cause instanceof Error ? cause.message : "历史加载失败");
      })
      .finally(() => {
        if (!cancelled) setRevisionLoading(false);
      });

    void fetchJson<{ entries?: Array<Record<string, unknown>> }>(`/api/books/${encodeURIComponent(bookId)}/jingwei/entries`)
      .catch(() => ({ entries: [] }))
      .then((entriesData) => {
        if (cancelled) return;
        const allEntries = Array.isArray(entriesData?.entries) ? entriesData.entries : [];
        const byId = new Map(allEntries.map((candidate) => [String(candidate.id ?? ""), String(candidate.title ?? "未命名条目")]));
        const relatedIds = (values.relatedEntryIds.length > 0
          ? [...values.relatedEntryIds]
          : parseStringArray(allEntries.find((candidate) => String(candidate.id ?? "") === entry.id)?.relatedEntryIds)
        ).filter((id) => id !== entry.id);
        setResolvedRelatedEntries(relatedIds.map((id) => ({ id, title: byId.get(id) ?? id })));
      });
    return () => { cancelled = true; };
    // 关联列表由 relatedIdsKey / relatedEntriesKey 驱动，避免父组件每次 render 都重拉。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, entry.id, relatedIdsKey, relatedEntriesKey]);

  const patch = (partial: Partial<JingweiCanonValues>) => {
    onChange({ ...values, ...partial });
  };

  async function handleRevert(revision: RevisionRecord) {
    if (!bookId || revertingRevisionId) return;
    setRevertingRevisionId(revision.id);
    setRevertError(null);
    try {
      const data = await fetchJson<{ entry?: JingweiEntryData }>(
        `/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(entry.id)}/revert`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revisionId: revision.id }),
        },
      );
      const restored = data.entry;
      if (restored) {
        onChange(canonValuesFromEntry(restored));
        onRestored?.(restored);
      }
      const refreshed = await fetchJson<{ revisions?: RevisionRecord[] }>(
        `/api/books/${encodeURIComponent(bookId)}/jingwei/entries/${encodeURIComponent(entry.id)}/revisions`,
      ).catch(() => ({ revisions: revisionRecords }));
      setRevisionRecords(Array.isArray(refreshed.revisions) ? refreshed.revisions : []);
    } catch (cause) {
      setRevertError(cause instanceof Error ? cause.message : "回滚失败");
    } finally {
      setRevertingRevisionId(null);
    }
  }

  return (
    <Card data-testid="jingwei-canon-panel">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">经纬设定</CardTitle>
        <p className="text-xs text-muted-foreground">分类、层级、可见性、关联和历史。卡片视图不再把这些藏掉。</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">分类</label>
            <Select value={values.category} onValueChange={(value) => patch({ category: value })}>
              <SelectTrigger className="w-full h-8 text-xs" aria-label="分类">
                <SelectValue placeholder="选择分类" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_SCHEMAS.map((schema) => (
                  <SelectItem key={schema.id} value={schema.id}>{schema.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">层级</label>
            <Select value={values.layer} onValueChange={(value) => patch({ layer: value })}>
              <SelectTrigger className="w-full h-8 text-xs" aria-label="层级">
                <SelectValue placeholder="选择层级" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="canon">Canon（权威设定）</SelectItem>
                <SelectItem value="dynamic">Dynamic（随剧情推进）</SelectItem>
                <SelectItem value="reference">Reference（参考）</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">可见性</label>
            <Select value={values.visibility} onValueChange={(value) => patch({ visibility: value as JingweiVisibility })}>
              <SelectTrigger className="w-full h-8 text-xs" aria-label="可见性">
                <SelectValue placeholder="选择可见性" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="global">全局（始终可见）</SelectItem>
                <SelectItem value="tracked">追踪（按章节窗口）</SelectItem>
                <SelectItem value="nested">嵌套（随父条目）</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">状态</label>
            <Select value={values.status} onValueChange={(value) => patch({ status: value })}>
              <SelectTrigger className="w-full h-8 text-xs" aria-label="状态">
                <SelectValue placeholder="选择状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="confirmed">已确认</SelectItem>
                <SelectItem value="draft">未确认</SelectItem>
                <SelectItem value="needs-review">需审查</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground mb-1 block">上下文优先级</label>
            <Select value={values.priorityTier} onValueChange={(value) => patch({ priorityTier: value as JingweiPriorityTier })}>
              <SelectTrigger className="w-48 h-8 text-xs" aria-label="上下文优先级">
                <SelectValue placeholder="选择优先级" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">自动（按规则推断）</SelectItem>
                <SelectItem value="core">核心（始终注入）</SelectItem>
                <SelectItem value="relevant">相关（按匹配注入）</SelectItem>
                <SelectItem value="reference">参考（仅 full 模式）</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {schemaFields.length > 0 ? (
          <div className="grid grid-cols-2 gap-3" data-testid="jingwei-entry-fields">
            {schemaFields.map((field) => (
              <div key={field.key} className={field.type === "textarea" ? "col-span-2" : undefined}>
                <JingweiSchemaField
                  field={field}
                  value={values.fields[field.key]}
                  onChange={(value) => patch({ fields: { ...values.fields, [field.key]: value } })}
                />
              </div>
            ))}
          </div>
        ) : null}

        {showAliases ? (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">别名</label>
          <div className="flex flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1.5">
            {values.aliases.map((alias, index) => (
              <Badge key={`${alias}-${index}`} variant="secondary" className="text-2xs gap-0.5 pr-1">
                {alias}
                <button type="button" onClick={() => patch({ aliases: values.aliases.filter((_, i) => i !== index) })} className="ml-0.5 hover:text-destructive" aria-label={`移除别名 ${alias}`}>
                  <X className="size-2.5" />
                </button>
              </Badge>
            ))}
            <Input
              value={aliasInput}
              onChange={(e) => setAliasInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && aliasInput.trim()) {
                  patch({ aliases: [...values.aliases, aliasInput.trim()] });
                  setAliasInput("");
                  e.preventDefault();
                }
              }}
              placeholder={values.aliases.length === 0 ? "回车添加别名" : "添加…"}
              className="h-6 w-28 text-2xs border-none bg-transparent px-1 focus-visible:ring-0"
              aria-label="添加别名"
            />
          </div>
        </div>
        ) : null}

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium">关联条目</span>
            <Button size="xs" variant="outline" onClick={() => setRelationAdding((v) => !v)}>
              <Link2 className="size-3 mr-1" />{relationAdding ? "取消" : "添加关联"}
            </Button>
          </div>
          {relationAdding && bookId ? (
            <div className="space-y-1 rounded-md border border-border p-2">
              <Input
                value={relationSearch}
                onChange={(e) => {
                  const q = e.target.value;
                  setRelationSearch(q);
                  if (!q.trim() || !bookId) { setRelationSearchResults([]); return; }
                  fetchJson<{ results?: RelatedEntryItem[] }>(`/api/books/${encodeURIComponent(bookId)}/jingwei/search?q=${encodeURIComponent(q)}`)
                    .then((d) => setRelationSearchResults((Array.isArray(d.results) ? d.results : []).filter((item) => item.id !== entry.id).slice(0, 8)))
                    .catch(() => setRelationSearchResults([]));
                }}
                placeholder="搜索要关联的条目…"
                className="h-7 text-xs"
                aria-label="搜索关联条目"
                autoFocus
              />
              {relationSearchResults.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (!values.relatedEntryIds.includes(item.id)) patch({ relatedEntryIds: [...values.relatedEntryIds, item.id] });
                    setResolvedRelatedEntries((current) => current.some((existing) => existing.id === item.id) ? current : [...current, item]);
                    setRelationSearch("");
                    setRelationSearchResults([]);
                    setRelationAdding(false);
                  }}
                  className="block w-full text-left text-xs px-2 py-1 rounded hover:bg-muted"
                >
                  {item.title}
                </button>
              ))}
            </div>
          ) : null}
          {relationItems.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {relationItems.map((item) => (
                <span key={item.id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-secondary text-secondary-foreground border border-border">
                  <button type="button" onClick={() => onNavigateToEntry?.(item.id)} className="inline-flex items-center gap-1 hover:underline">
                    <Link2 className="size-3 opacity-60" />
                    {item.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => patch({ relatedEntryIds: values.relatedEntryIds.filter((id) => id !== item.id) })}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`移除关联 ${item.title}`}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">暂无关联条目。关联会写回经纬，AI 注入时一并带上。</p>
          )}
        </div>

        <div className="space-y-2">
          <Button size="xs" variant={showHistory ? "default" : "outline"} onClick={() => setShowHistory((v) => !v)}>
            <History className="size-3 mr-1" />历史
            {revisionRecords.length > 0 ? <Badge variant="secondary" className="ml-1 text-2xs px-1 py-0">{revisionRecords.length}</Badge> : null}
          </Button>
          {revertError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
              {revertError}
            </div>
          ) : null}
          {showHistory ? (
            <div data-testid="jingwei-canon-history">
              {revisionLoading ? (
                <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />正在加载修改历史…
                </div>
              ) : revisionError ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
                  {revisionError}
                </div>
              ) : revisionRecords.length > 0 ? (
                <div className="space-y-2">
                  {revisionRecords.map((revision) => (
                    <div key={revision.id} className="flex items-start justify-between gap-2 rounded-md border px-3 py-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-2xs text-muted-foreground">
                            {new Date(revision.created_at).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <Badge variant={sourceBadgeVariant(revision.changed_by)} className="text-2xs px-1.5 py-0">
                            {SOURCE_LABELS[revision.changed_by] ?? revision.changed_by}
                          </Badge>
                        </div>
                        {revision.reason ? <p className="text-2xs text-muted-foreground mt-0.5">{revision.reason}</p> : null}
                      </div>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={revertingRevisionId !== null}
                        onClick={() => void handleRevert(revision)}
                        title="回滚到此版本"
                        aria-label={`回滚到 ${new Date(revision.created_at).toLocaleString("zh-CN")}`}
                      >
                        {revertingRevisionId === revision.id ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">暂无修改记录</p>
              )}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
