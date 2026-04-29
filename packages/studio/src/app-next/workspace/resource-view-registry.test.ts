import { describe, expect, it } from "vitest";

import type { StudioResourceNode } from "./resource-adapter";
import { resolveWorkspaceNodeViewKind } from "./resource-view-registry";

function node(kind: StudioResourceNode["kind"]): StudioResourceNode {
  return {
    id: `${kind}:1`,
    kind,
    title: kind,
  };
}

describe("resolveWorkspaceNodeViewKind", () => {
  it("maps concrete resource nodes to explicit editor or viewer kinds", () => {
    expect(resolveWorkspaceNodeViewKind(node("chapter"))).toBe("chapter-editor");
    expect(resolveWorkspaceNodeViewKind(node("generated-chapter"))).toBe("candidate-editor");
    expect(resolveWorkspaceNodeViewKind(node("draft"))).toBe("draft-editor");
    expect(resolveWorkspaceNodeViewKind(node("outline"))).toBe("outline-editor");
    expect(resolveWorkspaceNodeViewKind(node("bible-category"))).toBe("bible-category-view");
    expect(resolveWorkspaceNodeViewKind(node("bible-entry"))).toBe("bible-entry-editor");
    expect(resolveWorkspaceNodeViewKind(node("story-file"))).toBe("markdown-viewer");
    expect(resolveWorkspaceNodeViewKind(node("truth-file"))).toBe("markdown-viewer");
    expect(resolveWorkspaceNodeViewKind(node("material"))).toBe("material-viewer");
    expect(resolveWorkspaceNodeViewKind(node("publish-report"))).toBe("publish-report-viewer");
  });

  it("routes structural nodes to transparent unsupported state instead of silent empty fallback", () => {
    expect(resolveWorkspaceNodeViewKind(node("book"))).toBe("unsupported");
    expect(resolveWorkspaceNodeViewKind(node("volume"))).toBe("unsupported");
    expect(resolveWorkspaceNodeViewKind(node("group"))).toBe("unsupported");
    expect(resolveWorkspaceNodeViewKind(node("bible"))).toBe("unsupported");
  });
});
