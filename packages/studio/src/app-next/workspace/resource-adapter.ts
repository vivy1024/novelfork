import type {
  BibleEntryResource,
  BibleResourceCounts,
  BookDetail,
  ChapterSummary,
  DraftResource,
  GeneratedChapterCandidate,
  MaterialResource,
  PublishReportResource,
  TextFileResource,
  WorkspaceResourceSnapshot,
} from "../../shared/contracts";
import { normalizeBookStatus, normalizeCandidateStatus, normalizeChapterStatus, normalizeBibleEntryStatus } from "../../../../core/src/models/status";

export type StudioResourceKind =
  | "book"
  | "volume"
  | "chapter"
  | "generated-chapter"
  | "draft"
  | "outline"
  | "bible"
  | "bible-category"
  | "bible-entry"
  | "story-file"
  | "truth-file"
  | "material"
  | "publish-report"
  | "group";

export interface StudioResourceEmptyState {
  readonly title: string;
  readonly description: string;
  readonly actionLabel: string;
  readonly action: "create-chapter" | "generate-next" | "create-bible-entry" | "import-chapter" | "edit-outline";
}

export interface StudioResourceNode {
  readonly id: string;
  readonly kind: StudioResourceKind;
  readonly title: string;
  readonly subtitle?: string;
  readonly status?: string;
  readonly badge?: string;
  readonly count?: number;
  readonly metadata?: Record<string, unknown>;
  readonly emptyState?: StudioResourceEmptyState;
  readonly children?: readonly StudioResourceNode[];
}

export type StudioResourceTreeInput = WorkspaceResourceSnapshot;

const BIBLE_CATEGORIES: ReadonlyArray<{
  readonly key: keyof BibleResourceCounts;
  readonly title: string;
}> = [
  { key: "characters", title: "人物" },
  { key: "locations", title: "地点" },
  { key: "factions", title: "势力" },
  { key: "items", title: "物品" },
  { key: "foreshadowing", title: "伏笔" },
  { key: "worldRules", title: "世界规则" },
];

export function buildStudioResourceTree(input: StudioResourceTreeInput): readonly StudioResourceNode[] {
  const {
    book,
    chapters,
    generatedChapters = [],
    drafts = [],
    bibleCounts = {},
    bibleEntries = [],
    storyFiles = [],
    truthFiles = [],
    materials = [],
    publishReports = [],
  } = input;
  const formalChapterNodes = chapters.map((chapter) => toChapterNode(book.id, chapter));
  const generatedNodes = generatedChapters.map(toGeneratedChapterNode);
  const draftNodes = drafts.map(toDraftNode);
  const totalWords = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  const draftWordCount = drafts.reduce((sum, draft) => sum + draft.wordCount, 0);
  const bibleCategoryNodes = BIBLE_CATEGORIES.map(({ key, title }) => {
    const entryNodes = bibleEntries
      .filter((entry) => entry.category === key)
      .map((entry) => toBibleEntryNode(book.id, entry));
    const count = entryNodes.length > 0 ? entryNodes.length : bibleCounts[key] ?? 0;

    return {
      id: `bible:${String(key)}`,
      kind: "bible-category" as const,
      title,
      count,
      badge: count > 0 ? `${count} 条` : undefined,
      metadata: { bookId: book.id, category: key },
      children: entryNodes,
    };
  });

  const formalGroup = groupNode({
    id: "group:formal-chapters",
    title: "已有章节",
    children: formalChapterNodes,
    badge: `${totalWords} 字`,
    emptyState: {
      title: "还没有正式章节",
      description: "创建第一章或导入已有稿件后，正式章节会出现在这里。",
      actionLabel: "创建章节",
      action: "create-chapter",
    },
  });

  const volumeNode: StudioResourceNode = {
    id: `volume:${book.id}:default`,
    kind: "volume",
    title: "默认卷",
    count: formalChapterNodes.length,
    children: [formalGroup],
  };

  const generatedGroup = groupNode({
    id: "group:generated-chapters",
    title: "生成章节",
    children: generatedNodes,
    badge: `${generatedNodes.length} 个`,
    emptyState: {
      title: "还没有 AI 候选稿",
      description: "生成下一章会先进入候选区，不会覆盖正式章节。",
      actionLabel: "生成下一章",
      action: "generate-next",
    },
  });

  const draftsGroup = groupNode({
    id: "group:drafts",
    title: "草稿",
    children: draftNodes,
    badge: `${draftWordCount} 字`,
    emptyState: {
      title: "草稿箱为空",
      description: "导入章节或另存片段后，未定稿内容会留在这里。",
      actionLabel: "导入章节",
      action: "import-chapter",
    },
  });

  const outlineNode: StudioResourceNode = {
    id: "outline:root",
    kind: "outline",
    title: "大纲",
    subtitle: "复用现有 truth / outline 文件入口",
    metadata: { bookId: book.id, fileName: "volume_outline.md" },
    emptyState: {
      title: "暂无大纲",
      description: "打开大纲编辑器后，可以创建默认 Markdown 大纲并保存到 truth 文件。",
      actionLabel: "打开大纲编辑器",
      action: "edit-outline",
    },
  };

  const bibleGroup = groupNode({
    id: "group:bible",
    title: "经纬 / 资料库",
    children: bibleCategoryNodes,
    emptyState: {
      title: "经纬资料未建立",
      description: "创建人物、地点、势力、物品、伏笔或世界规则。",
      actionLabel: "创建经纬条目",
      action: "create-bible-entry",
    },
    forceEmptyWhenEveryChildCountIsZero: true,
  });

  const storyFilesGroup = groupNode({
    id: "group:story-files",
    title: "故事文件",
    children: storyFiles.map((file) => toStoryFileNode(book.id, file)),
  });

  const truthFilesGroup = groupNode({
    id: "group:truth-files",
    title: "真相文件",
    children: truthFiles.map((file) => toTruthFileNode(book.id, file)),
  });

  const materialsGroup = groupNode({
    id: "group:materials",
    title: "素材",
    children: materials.map((material) => toMaterialNode(book.id, material)),
    badge: `${materials.length} 个`,
  });

  const publishReportsGroup = groupNode({
    id: "group:publish-reports",
    title: "发布报告",
    children: publishReports.map(toPublishReportNode),
    badge: `${publishReports.length} 份`,
  });

  return [
    {
      id: `book:${book.id}`,
      kind: "book",
      title: book.title,
      subtitle: `${book.genre} · ${book.platform}`,
      status: normalizeBookStatus(book.status),
      badge: `${totalWords} 字`,
      count: chapters.length,
      metadata: {
        bookId: book.id,
        totalWords,
        updatedAt: book.updatedAt,
      },
      children: [volumeNode, generatedGroup, draftsGroup, outlineNode, bibleGroup, storyFilesGroup, truthFilesGroup, materialsGroup, publishReportsGroup],
    },
  ];
}

function groupNode({
  id,
  title,
  children,
  badge,
  emptyState,
  forceEmptyWhenEveryChildCountIsZero = false,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: readonly StudioResourceNode[];
  readonly badge?: string;
  readonly emptyState?: StudioResourceEmptyState;
  readonly forceEmptyWhenEveryChildCountIsZero?: boolean;
}): StudioResourceNode {
  const hasChildren = children.length > 0;
  const everyChildCountIsZero = hasChildren && children.every((child) => (child.count ?? 0) === 0);

  const shouldShowEmptyState = Boolean(emptyState) && (!hasChildren || (forceEmptyWhenEveryChildCountIsZero && everyChildCountIsZero));

  return {
    id,
    kind: "group",
    title,
    badge,
    count: children.length,
    children,
    emptyState: shouldShowEmptyState ? emptyState : undefined,
  };
}

function toChapterNode(bookId: string, chapter: ChapterSummary): StudioResourceNode {
  return {
    id: `chapter:${bookId}:${chapter.number}`,
    kind: "chapter",
    title: chapter.title,
    subtitle: `第 ${chapter.number} 章 · ${chapter.wordCount} 字`,
    status: normalizeChapterStatus(chapter.status),
    count: chapter.wordCount,
    metadata: {
      bookId,
      chapterNumber: chapter.number,
      auditIssueCount: chapter.auditIssueCount,
      updatedAt: chapter.updatedAt,
      fileName: chapter.fileName,
    },
  };
}

function toGeneratedChapterNode(candidate: GeneratedChapterCandidate): StudioResourceNode {
  return {
    id: `generated:${candidate.id}`,
    kind: "generated-chapter",
    title: candidate.title,
    subtitle: candidate.targetChapterId ? `目标章节 ${candidate.targetChapterId}` : "未指定目标章节",
    status: normalizeCandidateStatus(candidate.status),
    badge: candidate.source,
    metadata: {
      bookId: candidate.bookId,
      candidateId: candidate.id,
      targetChapterId: candidate.targetChapterId,
      createdAt: candidate.createdAt,
      content: candidate.content,
      contentError: candidate.contentError,
      aiMetadata: candidate.metadata,
    },
  };
}

function toDraftNode(draft: DraftResource): StudioResourceNode {
  return {
    id: `draft:${draft.id}`,
    kind: "draft",
    title: draft.title,
    subtitle: draft.wordCount ? `${draft.wordCount} 字` : "未统计字数",
    count: draft.wordCount,
    metadata: {
      bookId: draft.bookId,
      draftId: draft.id,
      updatedAt: draft.updatedAt,
      aiMetadata: draft.metadata,
    },
  };
}

function toBibleEntryNode(bookId: string, entry: BibleEntryResource): StudioResourceNode {
  return {
    id: `bible-entry:${entry.category}:${entry.id}`,
    kind: "bible-entry",
    title: entry.title,
    subtitle: entry.summary,
    status: normalizeBibleEntryStatus(entry.status),
    metadata: {
      bookId,
      category: entry.category,
      entryId: entry.id,
    },
  };
}

function toStoryFileNode(bookId: string, file: TextFileResource): StudioResourceNode {
  return {
    id: `story-file:${file.id}`,
    kind: "story-file",
    title: "label" in file && typeof (file as { label?: string }).label === "string" ? (file as { label: string }).label : file.title,
    subtitle: file.path,
    metadata: {
      bookId,
      path: file.path,
      fileType: file.fileType ?? "markdown",
    },
  };
}

function toTruthFileNode(bookId: string, file: TextFileResource): StudioResourceNode {
  return {
    id: `truth-file:${file.id}`,
    kind: "truth-file",
    title: "label" in file && typeof (file as { label?: string }).label === "string" ? (file as { label: string }).label : file.title,
    subtitle: file.path,
    metadata: {
      bookId,
      path: file.path,
      fileType: file.fileType ?? "markdown",
    },
  };
}

function toMaterialNode(bookId: string, material: MaterialResource): StudioResourceNode {
  return {
    id: `material:${material.id}`,
    kind: "material",
    title: material.title,
    subtitle: material.source,
    metadata: {
      bookId,
      source: material.source,
      updatedAt: material.updatedAt,
      path: material.path,
      fileType: material.fileType ?? "text",
      content: material.content,
    },
  };
}

function toPublishReportNode(report: PublishReportResource): StudioResourceNode {
  return {
    id: `publish-report:${report.id}`,
    kind: "publish-report",
    title: report.title,
    subtitle: report.channel,
    status: report.status,
    metadata: {
      channel: report.channel,
      updatedAt: report.updatedAt,
      content: report.content,
    },
  };
}
