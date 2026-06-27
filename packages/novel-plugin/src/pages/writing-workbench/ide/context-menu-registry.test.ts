import { describe, expect, it } from "vitest";

import { getResourceContextMenuItems } from "./context-menu-registry";
import type { WorkbenchResourceNode } from "../useWorkbenchResources";

const caps = { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: false };
function node(overrides: Partial<WorkbenchResourceNode>): WorkbenchResourceNode {
  return { id: "n1", kind: "file", title: "n1", capabilities: caps, metadata: { filePath: "story/n1.md", isFile: true }, ...overrides };
}

describe("context menu registry", () => {
  it("shows chapter-only actions only for metadata.isChapter resources", () => {
    const chapter = getResourceContextMenuItems(node({ kind: "chapter", metadata: { filePath: "chapters/0001_a.md", isChapter: true, isFile: true } })).map(i => i.id);
    const plain = getResourceContextMenuItems(node({ kind: "file", metadata: { filePath: "story/world.md", isFile: true } })).map(i => i.id);
    const dir = getResourceContextMenuItems(node({ kind: "group", capabilities: { ...caps, open: false, readonly: true, edit: false }, metadata: { filePath: "story", isDirectory: true } })).map(i => i.id);

    expect(chapter).toContain("generate-variant");
    expect(chapter).toContain("scene-spec");
    expect(chapter).toContain("copy-path");
    expect(plain).not.toContain("generate-variant");
    expect(plain).not.toContain("scene-spec");
    expect(plain).toEqual(expect.arrayContaining(["open-side", "rename", "delete", "copy-path", "copy", "cut"]));
    expect(dir).toEqual(expect.arrayContaining(["create-file", "create-folder", "open-side", "delete", "paste"]));
  });
});
