import { useEffect, useMemo, useState } from "react";

import { fetchJson } from "../../hooks/use-api";
import { InlineError } from "../components/feedback";
import type { StudioResourceNode } from "./resource-adapter";

function buildViewerMeta(node: StudioResourceNode): string {
  if (node.kind === "material") return "TextViewer · 素材";
  const viewer = node.metadata?.fileType === "text" ? "TextViewer" : "MarkdownViewer";
  return node.kind === "truth-file" ? `${viewer} · Truth 文件` : `${viewer} · Story 文件`;
}

function resolveInlineContent(node: StudioResourceNode): string | null | undefined {
  if (node.kind !== "material") return undefined;
  const content = node.metadata?.content;
  return typeof content === "string" || content === null ? content : undefined;
}

function resolveStoryFileNameFromPath(path: string): string | null {
  const normalizedPath = path.replace(/\\/g, "/");
  if (!normalizedPath.startsWith("story/")) return null;
  const fileName = normalizedPath.slice("story/".length);
  return fileName && !fileName.includes("/") ? fileName : null;
}

function resolveFileEndpoint(node: StudioResourceNode): string | null {
  const bookId = typeof node.metadata?.bookId === "string" ? node.metadata.bookId : "";
  const fileName = node.kind === "material" && typeof node.metadata?.path === "string"
    ? resolveStoryFileNameFromPath(node.metadata.path)
    : node.title;
  if (!bookId || !fileName) return null;
  return node.kind === "truth-file"
    ? `/books/${bookId}/truth-files/${encodeURIComponent(fileName)}`
    : `/books/${bookId}/story-files/${encodeURIComponent(fileName)}`;
}

export function WorkspaceFileViewer({ node }: { readonly node: StudioResourceNode }) {
  const endpoint = useMemo(() => resolveFileEndpoint(node), [node]);
  const inlineContent = useMemo(() => resolveInlineContent(node), [node]);
  const [content, setContent] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (inlineContent !== undefined) {
      setContent(inlineContent);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    if (!endpoint) {
      if (node.kind === "material") {
        setError(null);
        setContent(null);
      } else {
        setError("缺少文件定位信息");
        setContent(null);
      }
      return () => {
        cancelled = true;
      };
    }

    setContent(undefined);
    setError(null);

    void fetchJson<{ file: string; content: string | null }>(endpoint)
      .then((result) => {
        if (!cancelled) setContent(result.content);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      });

    return () => {
      cancelled = true;
    };
  }, [endpoint, inlineContent, node.kind]);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">{node.title}</h2>
        <p className="text-sm text-muted-foreground">{buildViewerMeta(node)}</p>
      </div>

      <div className="rounded-lg border border-border bg-background/60 p-4 text-sm">
        {content === undefined && !error && <p className="text-muted-foreground">加载中…</p>}
        {error && <InlineError message={error} />}
        {content === null && !error && (
          <div className="space-y-2 text-muted-foreground">
            <p className="font-medium text-foreground">文件为空</p>
            <p>当前文件已存在，但还没有可显示的正文。</p>
          </div>
        )}
        {typeof content === "string" && !error && (
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap text-sm leading-relaxed">{content}</pre>
        )}
      </div>
    </div>
  );
}
