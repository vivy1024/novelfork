import type { WorkbenchResourceNode } from "../useWorkbenchResources";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"]);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

export function isImageResourceNode(node: WorkbenchResourceNode): boolean {
  if (node.metadata?.isImage === true) return true;
  const path = typeof node.metadata?.filePath === "string" ? node.metadata.filePath : node.path ?? node.title;
  return IMAGE_EXT.has(extensionOf(path));
}

export function getImageRawUrl(bookId: string, node: WorkbenchResourceNode): string {
  const path = typeof node.metadata?.filePath === "string" ? node.metadata.filePath : node.path ?? node.title;
  return `/api/books/${encodeURIComponent(bookId)}/files/raw?path=${encodeURIComponent(path)}`;
}
