import { useEffect, useMemo, useState } from "react";

import { UnsupportedCapability } from "../../components/runtime/UnsupportedCapability";
import { Button } from "../../components/ui/button";
import { fetchJson, postApi, putApi, useApi } from "../../hooks/use-api";
import type { DraftResource } from "../../shared/contracts";
import { InlineError } from "../components/feedback";
import type { StudioResourceNode } from "./resource-adapter";
import { WorkspaceFileViewer } from "./WorkspaceFileViewer";

export type WorkspaceNodeViewKind =
  | "chapter-editor"
  | "candidate-editor"
  | "draft-editor"
  | "outline-editor"
  | "bible-category-view"
  | "bible-entry-editor"
  | "markdown-viewer"
  | "material-viewer"
  | "publish-report-viewer"
  | "unsupported";

export function resolveWorkspaceNodeViewKind(node: StudioResourceNode): WorkspaceNodeViewKind {
  switch (node.kind) {
    case "chapter":
      return "chapter-editor";
    case "generated-chapter":
      return "candidate-editor";
    case "draft":
      return "draft-editor";
    case "outline":
      return "outline-editor";
    case "bible-category":
      return "bible-category-view";
    case "bible-entry":
      return "bible-entry-editor";
    case "story-file":
    case "truth-file":
      return "markdown-viewer";
    case "material":
      return "material-viewer";
    case "publish-report":
      return "publish-report-viewer";
    default:
      return "unsupported";
  }
}

function PlaceholderSection({
  title,
  meta,
  description,
}: {
  readonly title: string;
  readonly meta: string;
  readonly description: string;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{meta}</p>
      </div>
      <div className="rounded-lg border border-dashed border-border bg-background/60 p-4 text-sm text-muted-foreground">
        {description}
      </div>
    </div>
  );
}

type BibleCategoryKey = "characters" | "locations" | "factions" | "items" | "foreshadowing" | "worldRules";

interface BibleWorkspaceEntry {
  readonly id: string;
  readonly name?: string;
  readonly title?: string;
  readonly content?: string;
  readonly summary?: string;
  readonly category?: string;
  readonly eventType?: string;
  readonly firstChapter?: number;
  readonly lastChapter?: number;
  readonly chapterStart?: number;
  readonly chapterEnd?: number;
}

interface BibleCategoryConfig {
  readonly key: BibleCategoryKey;
  readonly label: string;
  readonly endpointKind: "characters" | "events" | "settings";
  readonly dataKey: "characters" | "events" | "settings";
  readonly settingCategory?: string;
  readonly eventType?: string;
  readonly detailField: "summary" | "content";
}

const BIBLE_CATEGORY_CONFIG: Record<BibleCategoryKey, BibleCategoryConfig> = {
  characters: { key: "characters", label: "人物", endpointKind: "characters", dataKey: "characters", detailField: "summary" },
  locations: { key: "locations", label: "地点", endpointKind: "settings", dataKey: "settings", settingCategory: "location", detailField: "content" },
  factions: { key: "factions", label: "势力", endpointKind: "settings", dataKey: "settings", settingCategory: "faction", detailField: "content" },
  items: { key: "items", label: "物品", endpointKind: "settings", dataKey: "settings", settingCategory: "item", detailField: "content" },
  foreshadowing: { key: "foreshadowing", label: "伏笔", endpointKind: "events", dataKey: "events", eventType: "foreshadow", detailField: "summary" },
  worldRules: { key: "worldRules", label: "世界规则", endpointKind: "settings", dataKey: "settings", settingCategory: "world-rule", detailField: "content" },
};

function isBibleCategoryKey(value: unknown): value is BibleCategoryKey {
  return typeof value === "string" && value in BIBLE_CATEGORY_CONFIG;
}

function resolveBibleCategoryConfig(node: StudioResourceNode): BibleCategoryConfig | null {
  const category = node.metadata?.category;
  return isBibleCategoryKey(category) ? BIBLE_CATEGORY_CONFIG[category] : null;
}

function resolveBibleBookId(node: StudioResourceNode): string {
  return typeof node.metadata?.bookId === "string" ? node.metadata.bookId : "";
}

function bibleCategoryPath(bookId: string, config: BibleCategoryConfig): string {
  return `/books/${bookId}/bible/${config.endpointKind}`;
}

function normalizeBibleEntries(data: Record<string, unknown> | null | undefined, config: BibleCategoryConfig): readonly BibleWorkspaceEntry[] {
  const rawEntries = data?.[config.dataKey];
  const entries = Array.isArray(rawEntries) ? rawEntries as BibleWorkspaceEntry[] : [];
  if (config.settingCategory) return entries.filter((entry) => entry.category === config.settingCategory);
  if (config.eventType) return entries.filter((entry) => entry.eventType === config.eventType);
  return entries;
}

function bibleEntryTitle(entry: BibleWorkspaceEntry): string {
  return entry.name ?? entry.title ?? entry.id;
}

function bibleEntryDetail(entry: BibleWorkspaceEntry): string {
  return entry.content ?? entry.summary ?? "";
}

function bibleEntryChapterText(entry: BibleWorkspaceEntry): string | null {
  const chapters = [entry.firstChapter, entry.lastChapter, entry.chapterStart, entry.chapterEnd]
    .filter((value): value is number => typeof value === "number");
  if (chapters.length === 0) return null;
  return `关联章节：${[...new Set(chapters)].join("、")}`;
}

function buildBibleEntryPayload(config: BibleCategoryConfig, title: string, detail: string): Record<string, unknown> {
  const payload: Record<string, unknown> = { name: title };
  payload[config.detailField] = detail;
  if (config.settingCategory) payload.category = config.settingCategory;
  if (config.eventType) {
    payload.eventType = config.eventType;
    payload.foreshadowState = "buried";
  }
  return payload;
}

function resolveDraftEndpoint(node: StudioResourceNode): string | null {
  const bookId = typeof node.metadata?.bookId === "string" ? node.metadata.bookId : "";
  const draftId = typeof node.metadata?.draftId === "string" ? node.metadata.draftId : String(node.id).replace(/^draft:/, "");
  if (!bookId || !draftId) return null;
  return `/books/${bookId}/drafts/${encodeURIComponent(draftId)}`;
}

function formatAiResultMetadata(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const metadata = value as Record<string, unknown>;
  const provider = typeof metadata.provider === "string" ? metadata.provider : null;
  const model = typeof metadata.model === "string" ? metadata.model : null;
  const request = typeof metadata.runId === "string" ? metadata.runId : typeof metadata.requestId === "string" ? metadata.requestId : null;
  const parts = [provider, model, request].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? `AI 来源：${parts.join(" / ")}` : null;
}

export function DraftEditor({ node }: { readonly node: StudioResourceNode }) {
  const endpoint = useMemo(() => resolveDraftEndpoint(node), [node]);
  const [draft, setDraft] = useState<DraftResource | null>(null);
  const [content, setContent] = useState("");
  const [saveState, setSaveState] = useState<"loading" | "clean" | "dirty" | "saving" | "saved" | "failed">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!endpoint) {
      setError("缺少草稿定位信息");
      setSaveState("failed");
      return () => {
        cancelled = true;
      };
    }

    setDraft(null);
    setContent("");
    setSaveState("loading");
    setError(null);

    void fetchJson<{ draft: DraftResource }>(endpoint)
      .then((result) => {
        if (cancelled) return;
        setDraft(result.draft);
        setContent(result.draft.content);
        setSaveState("clean");
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setSaveState("failed");
      });

    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  const saveDraft = async () => {
    if (!endpoint || !draft) return;
    setSaveState("saving");
    setError(null);
    try {
      const result = await fetchJson<{ draft: DraftResource }>(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: draft.title, content }),
      });
      setDraft(result.draft);
      setContent(result.draft.content);
      setSaveState("saved");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
      setSaveState("failed");
    }
  };

  const statusText = saveState === "loading" ? "加载中"
    : saveState === "dirty" ? "未保存"
      : saveState === "saving" ? "保存中"
        : saveState === "saved" ? "已保存"
          : saveState === "failed" ? "失败"
            : "未修改";
  const aiMetadataText = formatAiResultMetadata(draft?.metadata ?? node.metadata?.aiMetadata);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <h2 className="text-xl font-semibold">{draft?.title ?? node.title}</h2>
          <p className="text-sm text-muted-foreground">DraftEditor · {draft?.wordCount ?? node.count ?? 0} 字 · 草稿保存状态：{statusText}</p>
          {aiMetadataText && <p className="text-xs text-muted-foreground">{aiMetadataText}</p>}
        </div>
        <Button size="sm" variant="outline" type="button" disabled={!draft || saveState === "loading" || saveState === "saving"} onClick={() => void saveDraft()}>
          保存草稿
        </Button>
      </div>
      {error && <InlineError message={error} />}
      {saveState === "loading" && !error ? <p className="text-sm text-muted-foreground">加载草稿中…</p> : (
        <textarea
          aria-label="草稿正文"
          className="min-h-[55vh] w-full rounded-lg border border-border bg-background p-3 font-serif text-base leading-8 outline-none focus:ring-2 focus:ring-ring/50"
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
            setSaveState("dirty");
          }}
        />
      )}
    </div>
  );
}

function BibleEntryForm({
  entry,
  config,
  onCancel,
  onSubmit,
}: {
  readonly entry?: BibleWorkspaceEntry;
  readonly config: BibleCategoryConfig;
  readonly onCancel: () => void;
  readonly onSubmit: (title: string, detail: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(entry ? bibleEntryTitle(entry) : "");
  const [detail, setDetail] = useState(entry ? bibleEntryDetail(entry) : "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitLabel = entry ? `保存${config.label}` : `创建${config.label}`;

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(title.trim(), detail.trim());
      if (!entry) {
        setTitle("");
        setDetail("");
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-border bg-background/60 p-3 text-sm">
      <input
        aria-label={`${config.label}名称`}
        className="w-full rounded border border-border bg-background px-2 py-1"
        onChange={(event) => setTitle(event.target.value)}
        placeholder={`${config.label}名称`}
        value={title}
      />
      <textarea
        aria-label={`${config.label}内容`}
        className="min-h-24 w-full rounded border border-border bg-background px-2 py-1"
        onChange={(event) => setDetail(event.target.value)}
        placeholder="内容、摘要或规则说明"
        value={detail}
      />
      {error && <InlineError message={error} />}
      <div className="flex gap-2">
        <Button size="sm" type="button" disabled={submitting || !title.trim()} onClick={() => void handleSubmit()}>
          {submitting ? "保存中…" : submitLabel}
        </Button>
        <Button size="sm" variant="outline" type="button" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}

function BibleEntryCard({ entry, config, onEdit }: { readonly entry: BibleWorkspaceEntry; readonly config: BibleCategoryConfig; readonly onEdit: () => void }) {
  const title = bibleEntryTitle(entry);
  const detail = bibleEntryDetail(entry);
  const chapterText = bibleEntryChapterText(entry);

  return (
    <div className="space-y-2 rounded-lg border border-border bg-background/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button className="text-left font-medium hover:text-primary" type="button" onClick={onEdit}>
          {title}
        </button>
        <Button size="sm" variant="outline" type="button" aria-label={`编辑${title}`} onClick={onEdit}>
          编辑
        </Button>
      </div>
      {detail ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{detail}</p> : <p className="text-sm text-muted-foreground">暂无内容</p>}
      {chapterText && <p className="text-xs text-muted-foreground">{chapterText}</p>}
      {config.eventType && <p className="text-xs text-muted-foreground">伏笔状态：{entry.eventType ?? config.eventType}</p>}
    </div>
  );
}

export function BibleCategoryView({ node }: { readonly node: StudioResourceNode }) {
  const config = resolveBibleCategoryConfig(node);
  const bookId = resolveBibleBookId(node);
  const endpoint = config && bookId ? bibleCategoryPath(bookId, config) : null;
  const { data, loading, error, refetch } = useApi<Record<string, unknown>>(endpoint);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  if (!config || !bookId || !endpoint) {
    return (
      <UnsupportedCapability
        title={`${node.title} 暂未接入经纬编辑`}
        reason="缺少 bookId 或经纬分类映射，不能伪造成功。"
        status="planned"
        capability={`workspace.bible.${String(node.metadata?.category ?? node.id)}`}
      />
    );
  }

  const entries = normalizeBibleEntries(data, config);
  const editingEntry = entries.find((entry) => entry.id === editingId);

  const createEntry = async (title: string, detail: string) => {
    await postApi(endpoint, buildBibleEntryPayload(config, title, detail));
    setCreating(false);
    await refetch();
  };

  const updateEntry = async (entry: BibleWorkspaceEntry, title: string, detail: string) => {
    await putApi(`${endpoint}/${encodeURIComponent(entry.id)}`, buildBibleEntryPayload(config, title, detail));
    setEditingId(null);
    await refetch();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <h2 className="text-xl font-semibold">{node.title}</h2>
          <p className="text-sm text-muted-foreground">BibleCategoryView · {config.label}</p>
        </div>
        <Button size="sm" type="button" onClick={() => setCreating(true)}>
          新建{config.label}
        </Button>
      </div>

      {loading && <p className="text-sm text-muted-foreground">加载{config.label}中…</p>}
      {error && <InlineError message={error} />}
      {!loading && !error && entries.length === 0 && <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">暂无{config.label}，可以新建第一条。</p>}

      {creating && <BibleEntryForm config={config} onCancel={() => setCreating(false)} onSubmit={createEntry} />}

      {editingEntry && (
        <BibleEntryForm
          key={editingEntry.id}
          entry={editingEntry}
          config={config}
          onCancel={() => setEditingId(null)}
          onSubmit={(title, detail) => updateEntry(editingEntry, title, detail)}
        />
      )}

      <div className="space-y-2">
        {entries.map((entry) => (
          <BibleEntryCard key={entry.id} entry={entry} config={config} onEdit={() => setEditingId(entry.id)} />
        ))}
      </div>
    </div>
  );
}

export function OutlineEditor({ node }: { readonly node: StudioResourceNode }) {
  return <PlaceholderSection title={node.title} meta="OutlineEditor" description="大纲查看与编辑将在后续任务接入真实 story/truth 文件。" />;
}

export function BibleEntryEditor({ node }: { readonly node: StudioResourceNode }) {
  const config = resolveBibleCategoryConfig(node);
  const inlineEntry: BibleWorkspaceEntry = {
    id: typeof node.metadata?.entryId === "string" ? node.metadata.entryId : node.id,
    name: node.title,
    summary: node.subtitle,
  };

  if (!config) {
    return <PlaceholderSection title={node.title} meta="BibleEntryEditor" description="经纬条目缺少分类映射，不能伪造编辑成功。" />;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1 border-b border-border pb-3">
        <h2 className="text-xl font-semibold">{node.title}</h2>
        <p className="text-sm text-muted-foreground">BibleEntryEditor · {config.label}</p>
      </div>
      <BibleEntryCard entry={inlineEntry} config={config} onEdit={() => undefined} />
    </div>
  );
}

export function MarkdownViewer({ node }: { readonly node: StudioResourceNode }) {
  return <WorkspaceFileViewer node={node} />;
}

export function MaterialViewer({ node }: { readonly node: StudioResourceNode }) {
  return <WorkspaceFileViewer node={node} />;
}

export function PublishReportViewer({ node }: { readonly node: StudioResourceNode }) {
  return <PlaceholderSection title={node.title} meta="PublishReportViewer" description="发布报告查看器已注册，等待后续任务接入真实发布检查结果。" />;
}

export function UnsupportedWorkspaceNodeView({ node }: { readonly node: StudioResourceNode }) {
  return (
    <UnsupportedCapability
      title={`${node.title} 当前不可直接编辑`}
      reason="该资源节点当前只作为结构容器存在；后续若接入真实 viewer/editor，会在资源 registry 中显式替换。"
      status="planned"
      capability={`workspace.resource.${node.kind}`}
    />
  );
}
