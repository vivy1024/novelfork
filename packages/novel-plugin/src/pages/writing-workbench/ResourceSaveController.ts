import type { ResourceDomainClient } from "@/app-next/backend-contract";
import { applyResourceDetailToNode, loadResourceDetailState, resourceNeedsDetailHydration } from "./ResourceDetailLoader";
import type { WorkbenchResourceNode } from "./useWorkbenchResources";

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

function assertContractSave(result: { ok: boolean; error?: unknown; code?: string }, fallback: string): void {
  if (result.ok) return;
  if (result.error && typeof result.error === "object") {
    const record = result.error as Record<string, unknown>;
    if (typeof record.message === "string") throw new Error(record.message);
    const nested = record.error;
    if (nested && typeof nested === "object" && typeof (nested as Record<string, unknown>).message === "string") {
      throw new Error((nested as Record<string, string>).message);
    }
  }
  if (typeof result.error === "string") throw new Error(result.error);
  throw new Error(result.code ? `${fallback}：${result.code}` : fallback);
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

function jingweiEntryIdFromNode(node: WorkbenchResourceNode): string | undefined {
  return metadataString(node, "entryId") ?? nodeIdSuffix(node, "jingwei-entry:");
}

function assertSaveable(node: WorkbenchResourceNode): void {
  if (!node.capabilities.edit || node.capabilities.readonly || node.capabilities.unsupported) {
    throw new Error("当前资源只读或不支持保存");
  }
  if (resourceNeedsDetailHydration(node)) {
    throw new Error("资源详情尚未完成 hydrate，禁止保存预览内容");
  }
}

async function hydrateAfterSave(resource: ResourceDomainClient, bookId: string, node: WorkbenchResourceNode): Promise<WorkbenchResourceNode> {
  const detail = await loadResourceDetailState(resource, bookId, node);
  if (detail.status !== "ready") {
    throw new Error(detail.status === "error" ? detail.message : "保存后资源详情回读失败");
  }
  return applyResourceDetailToNode(node, detail);
}

async function saveChapterAndHydrate(resource: ResourceDomainClient, bookId: string, node: WorkbenchResourceNode, content: string): Promise<WorkbenchResourceNode> {
  const chapterNumber = chapterNumberFromNode(node);
  if (chapterNumber === undefined) throw new Error("章节资源缺少章节编号，无法保存");
  await assertContractSave(await resource.saveChapter(bookId, chapterNumber, { content }), "章节保存失败");
  return hydrateAfterSave(resource, bookId, node);
}

async function saveJingweiAndHydrate(resource: ResourceDomainClient, bookId: string, node: WorkbenchResourceNode, content: string): Promise<WorkbenchResourceNode> {
  const fileName = fileNameFromNode(node, "jingwei-file:") ?? fileNameFromNode(node, "truth-file:");
  if (!fileName) throw new Error("经纬资料缺少文件名，无法保存");
  await assertContractSave(await resource.saveJingweiFile(bookId, fileName, { content }), "经纬资料保存失败");
  return hydrateAfterSave(resource, bookId, node);
}

async function saveJingweiEntryAndHydrate(resource: ResourceDomainClient, bookId: string, node: WorkbenchResourceNode, content: string): Promise<WorkbenchResourceNode> {
  const entryId = jingweiEntryIdFromNode(node);
  if (!entryId) throw new Error("经纬条目缺少 entryId，无法保存");
  const sectionId = metadataString(node, "sectionId");
  const payload = { title: node.title, contentMd: content, ...(sectionId ? { sectionId } : {}) };
  const result = await resource.saveJingweiEntry(bookId, entryId, payload);
  await assertContractSave(result, "经纬条目保存失败");
  const data = result.ok ? result.data as { readonly entry?: Record<string, unknown> } : {};
  const entry = data.entry ?? {};
  return {
    ...node,
    content: typeof entry.contentMd === "string" ? entry.contentMd : content,
    title: typeof entry.title === "string" ? entry.title : node.title,
    metadata: {
      ...node.metadata,
      entry,
      detailSource: "detail",
      entryId: typeof entry.id === "string" ? entry.id : entryId,
      sectionId: typeof entry.sectionId === "string" ? entry.sectionId : sectionId,
      updatedAt: entry.updatedAt,
      loadedAt: new Date().toISOString(),
    },
  };
}

async function saveFileTreeFile(bookId: string, node: WorkbenchResourceNode, content: string): Promise<WorkbenchResourceNode> {
  const filePath = metadataString(node, "filePath");
  if (!filePath) throw new Error("文件缺少路径，无法保存");
  const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/files`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: filePath, content }),
  });
  if (!res.ok) {
    let message = `文件保存失败 (${res.status})`;
    try {
      const data = await res.json() as { error?: string; message?: string };
      message = data.error ?? data.message ?? message;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  // 文件树文件不需要 hydrate，直接返回更新后的节点
  return { ...node, content };
}

export async function saveResourceAndHydrate(
  resource: ResourceDomainClient,
  fallbackBookId: string,
  node: WorkbenchResourceNode,
  content: string,
): Promise<WorkbenchResourceNode> {
  assertSaveable(node);
  const bookId = metadataString(node, "bookId") ?? fallbackBookId;

  // 文件树文件（来自 IDE 资源管理器的 .py/.md/.txt 等）
  if (node.metadata?.isFile === true && typeof node.metadata?.filePath === "string") {
    return saveFileTreeFile(bookId, node, content);
  }

  if (node.kind === "chapter") return saveChapterAndHydrate(resource, bookId, node, content);
  if (node.kind === "jingwei") return saveJingweiAndHydrate(resource, bookId, node, content);
  // 经纬文件节点（有 fileName）走文件保存，经纬条目节点（有 entryId）走条目保存
  if (node.kind === "jingwei-entry" && metadataString(node, "fileName")) return saveJingweiAndHydrate(resource, bookId, node, content);
  if (node.kind === "jingwei-entry") return saveJingweiEntryAndHydrate(resource, bookId, node, content);

  throw new Error(`${node.title} 暂不支持从工作台保存`);
}
