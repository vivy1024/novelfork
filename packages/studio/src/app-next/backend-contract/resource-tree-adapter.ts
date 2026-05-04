import type { NarrativeLineSnapshot } from "../../shared/agent-native-workspace";
import type {
  BookDetailResponse,
  ChapterSummary,
  DraftResource,
  GeneratedChapterCandidate,
  TextFileResource,
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
  | "truth"
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
type TruthFileListResponse = { files: readonly StoryListFile[] };
type JingweiSectionsResponse = { sections: readonly JingweiSectionRecord[] };
type JingweiEntriesResponse = { entries: readonly JingweiEntryRecord[] };
type NarrativeLineResponse = { snapshot: NarrativeLineSnapshot };

interface StoryListFile {
  readonly name: string;
  readonly label?: string;
  readonly size?: number;
  readonly preview?: string;
}

interface JingweiSectionRecord {
  readonly id: string;
  readonly key?: string;
  readonly name?: string;
  readonly title?: string;
  readonly enabled?: boolean;
  readonly showInSidebar?: boolean;
}

interface JingweiEntryRecord {
  readonly id: string;
  readonly sectionId?: string;
  readonly title?: string;
  readonly contentMd?: string;
  readonly updatedAt?: string;
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
  const storyFiles = await optional<StoryFileListResponse>(errors, "story-files.list", "Story 文件加载失败", () => resource.listStoryFiles<StoryFileListResponse>(bookId));
  const truthFiles = await optional<TruthFileListResponse>(errors, "truth-files.list", "Truth 文件加载失败", () => resource.listTruthFiles<TruthFileListResponse>(bookId));
  const jingweiSections = await optional<JingweiSectionsResponse>(errors, "jingwei.sections", "经纬分区加载失败", () => resource.listJingweiSections<JingweiSectionsResponse>(bookId));
  const jingweiEntries = await optional<JingweiEntriesResponse>(errors, "jingwei.entries", "经纬条目加载失败", () => resource.listJingweiEntries<JingweiEntriesResponse>(bookId));
  const narrative = await optional<NarrativeLineResponse>(errors, "narrative-line.read", "叙事线加载失败", () => resource.getNarrativeLine<NarrativeLineResponse>(bookId));

  const book = bookResult.data.book;
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
        group("group:story-files", "Story 文件", storyFiles?.files.map((file) => toStoryFileNode(book.id, file)) ?? []),
        group("group:truth-files", "Truth 文件", truthFiles?.files.map((file) => toTruthFileNode(book.id, file)) ?? []),
        group("group:jingwei", "经纬资料", [
          ...(jingweiSections?.sections.map(toJingweiSectionNode) ?? []),
          ...(jingweiEntries?.entries.map(toJingweiEntryNode) ?? []),
        ]),
        group("group:narrative-line", "叙事线", narrative ? [toNarrativeLineNode(book.id, narrative.snapshot)] : []),
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
    metadata: { bookId, chapterNumber: chapter.number, status: chapter.status, fileName: chapter.fileName },
  };
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
    metadata: { bookId, fileName: file.name, size: file.size },
  };
}

function toTruthFileNode(bookId: string, file: StoryListFile): ContractResourceNode {
  return {
    id: `truth-file:${file.name}`,
    kind: "truth",
    title: file.label ?? file.name,
    path: `story/${file.name}`,
    content: file.preview,
    capabilities: {
      read: CURRENT_READ("truth-files.detail"),
      edit: CURRENT_EDIT("truth-files.save"),
      delete: CURRENT_DELETE("truth-files.delete"),
      apply: UNSUPPORTED("truth-files.apply"),
    },
    metadata: { bookId, fileName: file.name, size: file.size },
  };
}

function toJingweiSectionNode(section: JingweiSectionRecord): ContractResourceNode {
  return {
    id: `jingwei-section:${section.id}`,
    kind: "jingwei-section",
    title: section.name ?? section.title ?? section.key ?? section.id,
    capabilities: {
      read: CURRENT_READ("jingwei.sections"),
      edit: CURRENT_EDIT("jingwei.sections.update"),
      delete: CURRENT_DELETE("jingwei.sections.delete"),
      apply: UNSUPPORTED("jingwei.sections.apply"),
    },
    metadata: { section },
  };
}

function toJingweiEntryNode(entry: JingweiEntryRecord): ContractResourceNode {
  return {
    id: `jingwei-entry:${entry.id}`,
    kind: "jingwei-entry",
    title: entry.title ?? entry.id,
    content: entry.contentMd,
    capabilities: {
      read: CURRENT_READ("jingwei.entries"),
      edit: CURRENT_EDIT("jingwei.entries.update"),
      delete: CURRENT_DELETE("jingwei.entries.delete"),
      apply: UNSUPPORTED("jingwei.entries.apply"),
    },
    metadata: { entryId: entry.id, sectionId: entry.sectionId, updatedAt: entry.updatedAt },
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
