import { describe, expect, it } from "vitest";

import { getImageRawUrl, isImageResourceNode } from "./image-resource";
import type { WorkbenchResourceNode } from "../useWorkbenchResources";

const caps = { open: true, readonly: true, unsupported: false, edit: false, delete: true, apply: false };

function node(overrides: Partial<WorkbenchResourceNode>): WorkbenchResourceNode {
  return { id: "file:story/map.png", kind: "file", title: "map.png", path: "story/map.png", capabilities: caps, metadata: { filePath: "story/map.png", isImage: true }, ...overrides };
}

describe("image resource helpers", () => {
  it("recognizes image file nodes and builds encoded raw urls", () => {
    expect(isImageResourceNode(node({ title: "map.png" }))).toBe(true);
    expect(isImageResourceNode(node({ title: "world.md", metadata: { filePath: "story/world.md" } }))).toBe(false);
    expect(getImageRawUrl("book-1", node({ path: "story/世界 地图.png", metadata: { filePath: "story/世界 地图.png", isImage: true } }))).toBe("/api/books/book-1/files/raw?path=story%2F%E4%B8%96%E7%95%8C%20%E5%9C%B0%E5%9B%BE.png");
  });
});
