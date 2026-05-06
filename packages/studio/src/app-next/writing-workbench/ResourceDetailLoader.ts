import type { ContractResult, ResourceDomainClient } from "../backend-contract";
import type { WorkbenchResourceNode } from "./useWorkbenchResources";

export type ResourceDetailSource = "detail" | "preview";

export type ResourceDetailState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly resourceId: string }
  | { readonly status: "ready"; readonly resourceId: string; readonly content: string; readonly source: ResourceDetailSource; readonly revision?: string; readonly loadedAt: string; readonly metadata?: Record<string, unknown> }
  | { readonly status: "error"; readonly resourceId: string; readonly error: unknown; readonly message: string };

function metadataString(node: WorkbenchResourceNode, key: string): string | undefined {
  const value = node.metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function metadataNumberOrString(node: WorkbenchResourceNode, key: string): number | string | undefined {
  const value = node.metadata?.[key];
  if (typeof value === "number" || (typeof value === "string" && value.length > 0)) return value;
  return undefined;
}

function nodeIdSuffix(node: WorkbenchResourceNode, prefix: string): string | undefined {
  return node.id.startsWith(prefix) ? node.id.slice(prefix.length) : undefined;
}

function pathFileName(path?: string): string | undefined {
  return path?.split("/").at(-1) ?? path?.split("\\").at(-1);
}

function detailSource(node: WorkbenchResourceNode): string | undefined {
  return metadataString(node, "detailSource") ?? metadataString(node, "source");
}

function isPreviewSource(node: WorkbenchResourceNode): boolean {
  const source = detailSource(node);
  return source === "preview" || source === "list-preview";
}

export function resourceNeedsDetailHydration(node: WorkbenchResourceNode): boolean {
  if (!node.capabilities.open || node.capabilities.unsupported) return false;
  if (metadataString(node, "detailSource") === "detail") return false;
  if (node.kind === "chapter") return isPreviewSource(node) || !node.content;
  if (node.kind === "story" || node.kind === "truth") return isPreviewSource(node);
  return false;
}

function messageFromContractResult(result: ContractResult<unknown>, fallback: string): string {
  if (result.ok) return fallback;
  const error = result.error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    if (record.error && typeof record.error === "object") {
      const nested = record.error as Record<string, unknown>;
      if (typeof nested.message === "string") return nested.message;
    }
  }
  if (typeof error === "string") return error;
  return result.code ? `${fallback}：${result.code}` : fallback;
}

function ready(node: WorkbenchResourceNode, content: string, source: ResourceDetailSource, metadata: Record<string, unknown> = {}): ResourceDetailState {
  return {
    status: "ready",
    resourceId: node.id,
    content,
    source,
    loadedAt: new Date().toISOString(),
    metadata,
  };
}

function errorState(node: WorkbenchResourceNode, error: unknown, message: string): ResourceDetailState {
  return { status: "error", resourceId: node.id, error, message };
}

function chapterNumberFromNode(node: WorkbenchResourceNode): number | string | undefined {
  const metadataChapter = metadataNumberOrString(node, "chapterNumber");
  if (metadataChapter !== undefined) return metadataChapter;
  if (!node.id.startsWith("chapter:")) return undefined;
  return node.id.split(":").at(-1);
}

function fileNameFromNode(node: WorkbenchResourceNode, prefix: string): string | undefined {
  return metadataString(node, "fileName") ?? nodeIdSuffix(node, prefix) ?? pathFileName(node.path);
}

function contentFromSnapshot(node: WorkbenchResourceNode): string {
  if (typeof node.content === "string") return node.content;
  const snapshot = node.metadata?.snapshot ?? node.metadata?.entry ?? node.metadata?.section ?? node.metadata ?? {};
  return JSON.stringify(snapshot, null, 2);
}

export async function loadResourceDetailState(
  resource: ResourceDomainClient,
  fallbackBookId: string,
  node: WorkbenchResourceNode,
): Promise<ResourceDetailState> {
  if (!node.capabilities.open || node.capabilities.unsupported) {
    return errorState(node, { code: "unsupported-resource" }, "当前资源不可打开或没有详情读取能力");
  }

  if (node.kind === "chapter") {
    const bookId = metadataString(node, "bookId") ?? fallbackBookId;
    const chapterNumber = chapterNumberFromNode(node);
    if (chapterNumber === undefined) return errorState(node, { code: "missing-chapter-number" }, "章节资源缺少章节编号");
    const result = await resource.getChapter(bookId, chapterNumber);
    if (!result.ok) return errorState(node, result.error ?? result.raw ?? result.code, messageFromContractResult(result, "章节详情加载失败"));
    const data = result.data as { readonly content?: unknown; readonly filename?: unknown; readonly chapterNumber?: unknown };
    return ready(node, typeof data.content === "string" ? data.content : "", "detail", {
      detailSource: "detail",
      filename: data.filename,
      chapterNumber: data.chapterNumber ?? chapterNumber,
      bookId,
    });
  }

  if (node.kind === "story") {
    const bookId = metadataString(node, "bookId") ?? fallbackBookId;
    const fileName = fileNameFromNode(node, "story-file:");
    if (!fileName) return errorState(node, { code: "missing-file-name" }, "Story 资源缺少文件名");
    const result = await resource.getStoryFile(bookId, fileName);
    if (!result.ok) return errorState(node, result.error ?? result.raw ?? result.code, messageFromContractResult(result, "Story 文件详情加载失败"));
    const data = result.data as { readonly content?: unknown; readonly file?: unknown };
    return ready(node, typeof data.content === "string" ? data.content : "", "detail", { detailSource: "detail", fileName: data.file ?? fileName, bookId });
  }

  if (node.kind === "truth") {
    const bookId = metadataString(node, "bookId") ?? fallbackBookId;
    const fileName = fileNameFromNode(node, "truth-file:");
    if (!fileName) return errorState(node, { code: "missing-file-name" }, "Truth 资源缺少文件名");
    const result = await resource.getTruthFile(bookId, fileName);
    if (!result.ok) return errorState(node, result.error ?? result.raw ?? result.code, messageFromContractResult(result, "Truth 文件详情加载失败"));
    const data = result.data as { readonly content?: unknown; readonly file?: unknown };
    return ready(node, typeof data.content === "string" ? data.content : "", "detail", { detailSource: "detail", fileName: data.file ?? fileName, bookId });
  }

  if (node.kind === "draft") {
    const bookId = metadataString(node, "bookId") ?? fallbackBookId;
    const draftId = metadataString(node, "draftId") ?? nodeIdSuffix(node, "draft:");
    if (isPreviewSource(node) && draftId) {
      const result = await resource.getDraft(bookId, draftId);
      if (!result.ok) return errorState(node, result.error ?? result.raw ?? result.code, messageFromContractResult(result, "草稿详情加载失败"));
      const data = result.data as { readonly content?: unknown; readonly id?: unknown; readonly updatedAt?: unknown };
      return ready(node, typeof data.content === "string" ? data.content : "", "detail", { detailSource: "detail", draftId: data.id ?? draftId, updatedAt: data.updatedAt, bookId });
    }
    return ready(node, typeof node.content === "string" ? node.content : "", "detail", { detailSource: "detail", bookId, draftId });
  }

  if (node.kind === "candidate") {
    if (typeof node.content === "string") return ready(node, node.content, "detail", { detailSource: "detail" });
    return errorState(node, { code: "candidate-content-missing" }, "候选稿列表未返回正文，当前没有独立详情接口");
  }

  if (node.kind === "jingwei-entry" || node.kind === "jingwei-section" || node.kind === "narrative-line" || node.kind === "storyline" || node.kind === "bible-entry" || node.kind === "tool-result") {
    return ready(node, contentFromSnapshot(node), "detail", { detailSource: "detail" });
  }

  return ready(node, typeof node.content === "string" ? node.content : contentFromSnapshot(node), isPreviewSource(node) ? "preview" : "detail", { detailSource: isPreviewSource(node) ? "preview" : "detail" });
}

export function applyResourceDetailToNode(node: WorkbenchResourceNode, detail: ResourceDetailState): WorkbenchResourceNode {
  if (detail.status !== "ready" || detail.resourceId !== node.id) return node;
  return {
    ...node,
    content: detail.content,
    metadata: {
      ...node.metadata,
      ...detail.metadata,
      detailSource: detail.source,
      loadedAt: detail.loadedAt,
    },
  };
}
