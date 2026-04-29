import { useEffect, useMemo, useState } from "react";

import { UnsupportedCapability } from "../../components/runtime/UnsupportedCapability";
import { Button } from "../../components/ui/button";
import { fetchJson } from "../../hooks/use-api";
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

export function OutlineEditor({ node }: { readonly node: StudioResourceNode }) {
  return <PlaceholderSection title={node.title} meta="OutlineEditor" description="大纲查看与编辑将在后续任务接入真实 story/truth 文件。" />;
}

export function BibleEntryEditor({ node }: { readonly node: StudioResourceNode }) {
  return <PlaceholderSection title={node.title} meta="BibleEntryEditor" description="经纬条目编辑器将在后续任务接入真实资料读取与保存。" />;
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
