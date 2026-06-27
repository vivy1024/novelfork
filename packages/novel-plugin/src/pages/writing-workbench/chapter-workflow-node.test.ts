import { describe, expect, it } from "vitest";

import { isChapterWorkflowNode } from "./chapter-workflow-node";
import type { WorkbenchResourceNode } from "./useWorkbenchResources";

const baseCaps = { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: false };

function resource(overrides: Partial<WorkbenchResourceNode>): WorkbenchResourceNode {
  return {
    id: "resource-1",
    kind: "chapter",
    title: "资源",
    capabilities: baseCaps,
    ...overrides,
  };
}

describe("isChapterWorkflowNode", () => {
  it("enables chapter-only workflow only for metadata.isChapter resources", () => {
    expect(isChapterWorkflowNode(resource({ kind: "chapter", metadata: { isChapter: true } }))).toBe(true);
    expect(isChapterWorkflowNode(resource({ kind: "chapter", metadata: { isFile: true, filePath: "story/world.md" } }))).toBe(false);
    expect(isChapterWorkflowNode(resource({ kind: "file", metadata: { isFile: true, filePath: "story/world.md" } }))).toBe(false);
    expect(isChapterWorkflowNode(resource({ kind: "chapter", metadata: {} }))).toBe(false);
  });
});
