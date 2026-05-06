import type { ContractResult, ResourceDomainClient } from "../backend-contract";
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

function contractErrorMessage(result: ContractResult<unknown>, fallback: string): string {
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

async function assertContractSave(result: ContractResult<unknown>, fallback: string): Promise<void> {
  if (!result.ok) throw new Error(contractErrorMessage(result, fallback));
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

function draftIdFromNode(node: WorkbenchResourceNode): string | undefined {
  return metadataString(node, "draftId") ?? nodeIdSuffix(node, "draft:");
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
  if (node.kind === "candidate") {
    throw new Error("候选稿不能从画布保存为正式资源，请通过应用/另存草稿流程处理");
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

async function saveTruthAndHydrate(resource: ResourceDomainClient, bookId: string, node: WorkbenchResourceNode, content: string): Promise<WorkbenchResourceNode> {
  const fileName = fileNameFromNode(node, "truth-file:");
  if (!fileName) throw new Error("Truth 资源缺少文件名，无法保存");
  await assertContractSave(await resource.saveTruthFile(bookId, fileName, { content }), "Truth 文件保存失败");
  return hydrateAfterSave(resource, bookId, node);
}

async function saveDraftAndHydrate(resource: ResourceDomainClient, bookId: string, node: WorkbenchResourceNode, content: string): Promise<WorkbenchResourceNode> {
  const draftId = draftIdFromNode(node);
  if (!draftId) throw new Error("草稿资源缺少 draftId，无法保存");
  await assertContractSave(await resource.saveDraft(bookId, { id: draftId, title: node.title, content }), "草稿保存失败");
  const result = await resource.getDraft(bookId, draftId);
  if (!result.ok) throw new Error(contractErrorMessage(result, "草稿保存后详情回读失败"));
  const data = result.data as { readonly id?: unknown; readonly content?: unknown; readonly updatedAt?: unknown };
  return {
    ...node,
    content: typeof data.content === "string" ? data.content : content,
    metadata: {
      ...node.metadata,
      detailSource: "detail",
      draftId: typeof data.id === "string" ? data.id : draftId,
      updatedAt: data.updatedAt,
      loadedAt: new Date().toISOString(),
    },
  };
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

export async function saveResourceAndHydrate(
  resource: ResourceDomainClient,
  fallbackBookId: string,
  node: WorkbenchResourceNode,
  content: string,
): Promise<WorkbenchResourceNode> {
  assertSaveable(node);
  const bookId = metadataString(node, "bookId") ?? fallbackBookId;

  if (node.kind === "chapter") return saveChapterAndHydrate(resource, bookId, node, content);
  if (node.kind === "draft") return saveDraftAndHydrate(resource, bookId, node, content);
  if (node.kind === "truth") return saveTruthAndHydrate(resource, bookId, node, content);
  if (node.kind === "jingwei-entry") return saveJingweiEntryAndHydrate(resource, bookId, node, content);

  throw new Error(`${node.title} 暂不支持从工作台保存`);
}
