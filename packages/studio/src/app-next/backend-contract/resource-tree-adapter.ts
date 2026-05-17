import type { NarrativeLineSnapshot } from "../../shared/agent-native-workspace";
import type {
  BookDetailResponse,
  ChapterSummary,
  DraftResource,
  GeneratedChapterCandidate,
} from "../../shared/contracts";
import type { ContractResult } from "./contract-client";
import { normalizeCapability, type BackendCapability } from "./capability-status";
import type { createResourceClient } from "./resource-client";

export type ResourceDomainClient = ReturnType<typeof createResourceClient>;

export type ContractResourceKind =
  | "book"
  | "group"
  | "chapter"
  | "candidate"
  | "draft"
  | "story"
  | "jingwei"
  | "jingwei-section"
  | "jingwei-entry"
  | "narrative-line"
  | "unsupported";

export interface ContractResourceCapabilities {
  read?: BackendCapability;
  edit?: BackendCapability;
  delete?: BackendCapability;
  apply?: BackendCapability;
  unsupported?: BackendCapability;
}

export interface ContractResourceNode {
  id: string;
  kind: ContractResourceKind;
  title: string;
  path?: string;
  content?: string | null;
  capabilities: ContractResourceCapabilities;
  metadata?: Record<string, unknown>;
  children?: ContractResourceNode[];
}

export interface ContractResourceTreeLoadResult {
  ok: true;
  tree: ContractResourceNode[];
  errors: ContractResourceNode[];
}

type CandidateListResponse = { candidates: readonly GeneratedChapterCandidate[] };
type DraftListResponse = { drafts: readonly DraftResource[] };
type StoryFileListResponse = { files: readonly StoryListFile[] };
type JingweiFileListResponse = { files: readonly StoryListFile[] };
type NarrativeLineResponse = { snapshot: NarrativeLineSnapshot };

interface StoryListFile {
  readonly name: string;
  readonly label?: string;
  readonly size?: number;
  readonly preview?: string;
  readonly category?: string;
}

const GROUP_CAPABILITY = { read: normalizeCapability({ id: "resource.group", status: "current" }) };
const CURRENT_READ = (id: string) => normalizeCapability({ id, status: "current" });
const CURRENT_EDIT = (id: string) => normalizeCapability({ id, status: "current" });
const CURRENT_DELETE = (id: string) => normalizeCapability({ id, status: "current" });
const CURRENT_APPLY = (id: string) => normalizeCapability({ id, status: "current" });
const UNSUPPORTED = (id: string, metadata?: Record<string, unknown>) => normalizeCapability({ id, status: "unsupported", metadata });

function group(id: string, title: string, children: ContractResourceNode[]): ContractResourceNode {
  return { id, kind: "group", title, capabilities: GROUP_CAPABILITY, children };
}

function unsupportedNode(id: string, title: string, error: unknown): ContractResourceNode {
  return {
    id: `unsupported:${id}`,
    kind: "unsupported",
    title,
    capabilities: { unsupported: UNSUPPORTED(id, { error }) },
    metadata: { error },
  };
}

async function optional<T>(
  errors: ContractResourceNode[],
  id: string,
  title: string,
  load: () => Promise<ContractResult<T>>,
): Promise<T | null> {
  const result = await load();
  if (result.ok) return result.data;
  errors.push(unsupportedNode(id, title, result.error ?? result.raw ?? result.code ?? result.cause));
  return null;
}

export async function loadResourceTreeFromContract(
  resource: ResourceDomainClient,
  bookId: string,
): Promise<ContractResourceTreeLoadResult> {
  const errors: ContractResourceNode[] = [];
  const bookResult = await resource.getBook<BookDetailResponse>(bookId);
  if (!bookResult.ok) {
    return {
      ok: true,
      tree: [unsupportedNode("books.detail", "书籍详情加载失败", bookResult.error ?? bookResult.raw ?? bookResult.code ?? bookResult.cause)],
      errors: [unsupportedNode("books.detail", "书籍详情加载失败", bookResult.error ?? bookResult.raw ?? bookResult.code ?? bookResult.cause)],
    };
  }

  const candidates = await optional<CandidateListResponse>(errors, "candidates.list", "候选稿加载失败", () => resource.listCandidates<CandidateListResponse>(bookId));
  const drafts = await optional<DraftListResponse>(errors, "drafts.list", "草稿加载失败", () => resource.listDrafts<DraftListResponse>(bookId));
  const storyFiles = await optional<StoryFileListResponse>(errors, "story-files.list", "大纲与设定文件加载失败", () => resource.listStoryFiles<StoryFileListResponse>(bookId));
  const jingweiFiles = await optional<JingweiFileListResponse>(errors, "jingwei-files.list", "经纬资料加载失败", () => resource.listJingweiFiles<JingweiFileListResponse>(bookId));

  const narrative = await optional<NarrativeLineResponse>(errors, "narrative-line.read", "叙事线加载失败", () => resource.getNarrativeLine<NarrativeLineResponse>(bookId));

  const book = bookResult.data.book;

  // Deduplicate: jingwei files are a subset of story files (same directory).
  // Show jingwei files only in the "经纬资料" group; exclude them from "大纲与设定".
  const jingweiFileNames = new Set(jingweiFiles?.files.map((f) => f.name) ?? []);
  // Also exclude internal data files that should never appear in the resource tree
  const INTERNAL_FILES = new Set(["jingwei_sections.json", "jingwei_entries.json", "style_profile.json", ".write.lock"]);
  const nonJingweiStoryFiles = storyFiles?.files.filter((f) => !jingweiFileNames.has(f.name) && !INTERNAL_FILES.has(f.name)) ?? [];

  const tree: ContractResourceNode[] = [
    {
      id: `book:${book.id}`,
      kind: "book",
      title: book.title,
      capabilities: {
        read: CURRENT_READ("books.detail"),
        edit: CURRENT_EDIT("books.update"),
        delete: CURRENT_DELETE("books.delete"),
        apply: UNSUPPORTED("books.apply"),
      },
      metadata: { book, nextChapter: bookResult.data.nextChapter },
      children: [
        group("group:chapters", "章节", bookResult.data.chapters.map((chapter) => toChapterNode(book.id, chapter))),
        group("group:candidates", "候选稿", [
          ...(candidates?.candidates.map(toCandidateNode) ?? []),
          ...errors.filter((node) => node.id === "unsupported:candidates.list"),
        ]),
        group("group:drafts", "草稿", drafts?.drafts.map(toDraftNode) ?? []),
        group("group:story-files", "大纲与设定", nonJingweiStoryFiles.map((file) => toStoryFileNode(book.id, file))),
        jingweiPanelEntryNode(jingweiFiles),
        group("group:hooks", "伏笔", buildHooksGroup(jingweiFiles)),
        group("group:narrative-line", "叙事线", narrative?.snapshot.nodes.length && bookResult.data.chapters.length > 0 ? [toNarrativeLineNode(book.id, narrative.snapshot)] : []),
      ],
    },
  ];

  return { ok: true, tree, errors };
}

function toChapterNode(bookId: string, chapter: ChapterSummary): ContractResourceNode {
  return {
    id: `chapter:${bookId}:${chapter.number}`,
    kind: "chapter",
    title: chapter.title || `第 ${chapter.number} 章`,
    capabilities: {
      read: CURRENT_READ("chapters.detail"),
      edit: CURRENT_EDIT("chapters.save"),
      delete: CURRENT_DELETE("chapters.delete"),
      apply: UNSUPPORTED("chapters.apply"),
    },
    metadata: { bookId, chapterNumber: chapter.number, status: chapter.status, fileName: chapter.fileName, source: "list-preview" },
  };
}

/**
 * 经纬资料组 — 包含经纬文件列表作为子节点，用户可直接点击查看内容。
 */
function jingweiPanelEntryNode(jingweiFiles: JingweiFileListResponse | null | undefined): ContractResourceNode {
  const children: ContractResourceNode[] = (jingweiFiles?.files ?? [])
    .filter((f) => f.name !== "pending_hooks.md" && f.size > 10) // 排除伏笔文件（单独展示）和空文件
    .map((f) => ({
      id: `jingwei-file:${f.name}`,
      kind: "jingwei-entry" as const,
      title: f.label || f.name.replace(/\.md$/, ""),
      capabilities: {
        read: CURRENT_READ("jingwei-files.read"),
        edit: CURRENT_EDIT("jingwei-files.write"),
        delete: UNSUPPORTED("jingwei-files.delete"),
        apply: UNSUPPORTED("jingwei-files.apply"),
      },
      metadata: { fileName: f.name, category: f.category, preview: f.preview },
    }));

  return {
    id: "jingwei-panel-entry",
    kind: "jingwei",
    title: "经纬资料",
    capabilities: {
      read: CURRENT_READ("jingwei.panel"),
      edit: UNSUPPORTED("jingwei.panel.edit"),
      delete: UNSUPPORTED("jingwei.panel.delete"),
      apply: UNSUPPORTED("jingwei.panel.apply"),
    },
    metadata: { action: "open-jingwei-panel" },
    children: children.length > 0 ? children : undefined,
  };
}

function buildHooksGroup(jingweiFiles: JingweiFileListResponse | null | undefined): ContractResourceNode[] {
  // Show pending_hooks.md as a readable node in the hooks group if it exists and has content
  const hooksFile = jingweiFiles?.files.find((f) => f.name === "pending_hooks.md");
  if (!hooksFile || (hooksFile.size ?? 0) < 10) return [];
  return [{
    id: "hook:pending-hooks",
    kind: "jingwei",
    title: "待处理伏笔",
    path: "pending_hooks.md",
    capabilities: {
      read: CURRENT_READ("jingwei-files.read"),
      edit: CURRENT_EDIT("jingwei-files.write"),
      delete: UNSUPPORTED("jingwei-files.delete"),
      apply: UNSUPPORTED("jingwei-files.apply"),
    },
    metadata: { fileName: "pending_hooks.md", size: hooksFile.size, preview: hooksFile.preview },
  }];
}

function toCandidateNode(candidate: GeneratedChapterCandidate): ContractResourceNode {
  return {
    id: `candidate:${candidate.id}`,
    kind: "candidate",
    title: candidate.title,
    content: candidate.content ?? null,
    capabilities: {
      read: CURRENT_READ("candidates.list"),
      edit: UNSUPPORTED("candidates.edit"),
      delete: CURRENT_DELETE("candidates.delete"),
      apply: CURRENT_APPLY("candidates.accept"),
    },
    metadata: { bookId: candidate.bookId, candidateId: candidate.id, targetChapterId: candidate.targetChapterId, source: candidate.source, status: candidate.status },
  };
}

function toDraftNode(draft: DraftResource): ContractResourceNode {
  return {
    id: `draft:${draft.id}`,
    kind: "draft",
    title: draft.title,
    content: draft.content,
    capabilities: {
      read: CURRENT_READ("drafts.detail"),
      edit: CURRENT_EDIT("drafts.save"),
      delete: CURRENT_DELETE("drafts.delete"),
      apply: UNSUPPORTED("drafts.apply"),
    },
    metadata: { bookId: draft.bookId, draftId: draft.id, updatedAt: draft.updatedAt, wordCount: draft.wordCount },
  };
}

function toStoryFileNode(bookId: string, file: StoryListFile): ContractResourceNode {
  return {
    id: `story-file:${file.name}`,
    kind: "story",
    title: file.label ?? file.name,
    path: `story/${file.name}`,
    content: file.preview,
    capabilities: {
      read: CURRENT_READ("story-files.detail"),
      edit: UNSUPPORTED("story-files.edit"),
      delete: CURRENT_DELETE("story-files.delete"),
      apply: UNSUPPORTED("story-files.apply"),
    },
    metadata: { bookId, fileName: file.name, size: file.size, source: "preview" },
  };
}

function toNarrativeLineNode(bookId: string, snapshot: NarrativeLineSnapshot): ContractResourceNode {
  return {
    id: `narrative-line:${bookId}`,
    kind: "narrative-line",
    title: "叙事线快照",
    capabilities: {
      read: CURRENT_READ("narrative-line.read"),
      edit: UNSUPPORTED("narrative-line.edit"),
      delete: UNSUPPORTED("narrative-line.delete"),
      apply: UNSUPPORTED("narrative-line.apply"),
    },
    metadata: { snapshot },
  };
}

export function flattenContractResourceTree(nodes: readonly ContractResourceNode[]): Map<string, ContractResourceNode> {
  const result = new Map<string, ContractResourceNode>();
  const walk = (node: ContractResourceNode) => {
    result.set(node.id, node);
    node.children?.forEach(walk);
  };
  nodes.forEach(walk);
  return result;
}
