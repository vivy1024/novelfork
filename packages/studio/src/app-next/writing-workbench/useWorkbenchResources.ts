import { useMemo } from "react";

import type { WorkspaceResourceSnapshot } from "../../shared/contracts";

export type WorkbenchResourceKind =
  | "book"
  | "group"
  | "chapter"
  | "candidate"
  | "draft"
  | "story"
  | "truth"
  | "bible-entry"
  | "storyline"
  | "unsupported";

export interface WorkbenchResourceCapabilities {
  open: boolean;
  readonly: boolean;
  unsupported: boolean;
  edit: boolean;
  delete: boolean;
  apply: boolean;
}

export interface WorkbenchResourceNode {
  id: string;
  kind: WorkbenchResourceKind;
  title: string;
  content?: string;
  path?: string;
  capabilities: WorkbenchResourceCapabilities;
  children?: WorkbenchResourceNode[];
}

const READONLY: WorkbenchResourceCapabilities = { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false };
const EDITABLE: WorkbenchResourceCapabilities = { open: true, readonly: false, unsupported: false, edit: true, delete: false, apply: false };
const MUTABLE: WorkbenchResourceCapabilities = { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: false };
const CANDIDATE: WorkbenchResourceCapabilities = { open: true, readonly: false, unsupported: false, edit: true, delete: true, apply: true };

function group(id: string, title: string, children: WorkbenchResourceNode[]): WorkbenchResourceNode {
  return {
    id,
    kind: "group",
    title,
    capabilities: { open: false, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
    children,
  };
}

export function buildWorkbenchResourceTree(snapshot: WorkspaceResourceSnapshot): WorkbenchResourceNode[] {
  const bookId = snapshot.book.id;
  const chapters = snapshot.chapters.map((chapter) => ({
    id: `chapter:${bookId}:${chapter.number}`,
    kind: "chapter" as const,
    title: chapter.title || `第 ${chapter.number} 章`,
    capabilities: EDITABLE,
  }));
  const candidates = (snapshot.generatedChapters ?? []).map((candidate) => ({
    id: `candidate:${candidate.id}`,
    kind: "candidate" as const,
    title: candidate.title,
    content: candidate.content ?? undefined,
    capabilities: CANDIDATE,
  }));
  const drafts = (snapshot.drafts ?? []).map((draft) => ({
    id: `draft:${draft.id}`,
    kind: "draft" as const,
    title: draft.title,
    content: draft.content,
    capabilities: MUTABLE,
  }));
  const storyFiles = (snapshot.storyFiles ?? []).map((file) => ({
    id: `story-file:${file.id}`,
    kind: "story" as const,
    title: file.title,
    path: file.path,
    capabilities: READONLY,
  }));
  const truthFiles = (snapshot.truthFiles ?? []).map((file) => ({
    id: `truth-file:${file.id}`,
    kind: "truth" as const,
    title: file.title,
    path: file.path,
    capabilities: READONLY,
  }));
  const bibleEntries = (snapshot.bibleEntries ?? []).map((entry) => ({
    id: `bible-entry:${entry.category}:${entry.id}`,
    kind: "bible-entry" as const,
    title: entry.title,
    content: entry.summary,
    capabilities: READONLY,
  }));

  return [
    {
      id: `book:${bookId}`,
      kind: "book",
      title: snapshot.book.title,
      capabilities: { open: true, readonly: true, unsupported: false, edit: false, delete: false, apply: false },
      children: [
        group("group:chapters", "章节", chapters),
        group("group:candidates", "候选稿", candidates),
        group("group:drafts", "草稿", drafts),
        group("group:story", "Story 文件", storyFiles),
        group("group:truth", "Truth 文件", truthFiles),
        group("group:bible", "经纬资料", bibleEntries),
        group("group:storyline", "叙事线", [
          { id: "storyline:foreshadowing", kind: "storyline", title: "伏笔线", capabilities: READONLY },
          { id: "storyline:conflicts", kind: "storyline", title: "冲突线", capabilities: READONLY },
        ]),
      ],
    },
  ];
}

export function flattenWorkbenchResourceTree(nodes: readonly WorkbenchResourceNode[]): Map<string, WorkbenchResourceNode> {
  const result = new Map<string, WorkbenchResourceNode>();
  const walk = (node: WorkbenchResourceNode) => {
    result.set(node.id, node);
    node.children?.forEach(walk);
  };
  nodes.forEach(walk);
  return result;
}

export function useWorkbenchResources(snapshot: WorkspaceResourceSnapshot) {
  return useMemo(() => {
    const tree = buildWorkbenchResourceTree(snapshot);
    const resourceMap = flattenWorkbenchResourceTree(tree);
    const openableNodes = Array.from(resourceMap.values()).filter((node) => node.capabilities.open);

    return { tree, resourceMap, openableNodes };
  }, [snapshot]);
}
