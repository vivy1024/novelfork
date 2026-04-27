import type { BookDetail, ChapterSummary } from "../../shared/contracts";

export type StudioResourceKind =
  | "book"
  | "volume"
  | "chapter"
  | "generated-chapter"
  | "draft"
  | "outline"
  | "bible"
  | "bible-category"
  | "group";

export interface StudioResourceEmptyState {
  readonly title: string;
  readonly description: string;
  readonly actionLabel: string;
  readonly action: "create-chapter" | "generate-next" | "create-bible-entry" | "import-chapter";
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

export interface GeneratedChapterCandidate {
  readonly id: string;
  readonly bookId: string;
  readonly targetChapterId?: string;
  readonly title: string;
  readonly source: string;
  readonly createdAt: string;
  readonly status: "candidate" | "accepted" | "rejected" | "archived";
}

export interface DraftResource {
  readonly id: string;
  readonly bookId: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly wordCount?: number;
}

export interface BibleResourceCounts {
  readonly characters?: number;
  readonly locations?: number;
  readonly factions?: number;
  readonly items?: number;
  readonly foreshadowing?: number;
  readonly worldRules?: number;
}

export interface StudioResourceTreeInput {
  readonly book: BookDetail;
  readonly chapters: readonly ChapterSummary[];
  readonly generatedChapters?: readonly GeneratedChapterCandidate[];
  readonly drafts?: readonly DraftResource[];
  readonly bibleCounts?: BibleResourceCounts;
}

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
  const { book, chapters, generatedChapters = [], drafts = [], bibleCounts = {} } = input;
  const formalChapterNodes = chapters.map((chapter) => toChapterNode(book.id, chapter));
  const generatedNodes = generatedChapters.map(toGeneratedChapterNode);
  const draftNodes = drafts.map(toDraftNode);
  const bibleCategoryNodes = BIBLE_CATEGORIES.map(({ key, title }) => ({
    id: `bible:${key}`,
    kind: "bible-category" as const,
    title,
    count: bibleCounts[key] ?? 0,
    metadata: { category: key },
  }));

  const formalGroup = groupNode({
    id: "group:formal-chapters",
    title: "已有章节",
    children: formalChapterNodes,
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
    emptyState: {
      title: "暂无大纲",
      description: "后续可从 truth 文件或章节规划导入大纲。",
      actionLabel: "创建经纬条目",
      action: "create-bible-entry",
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

  return [
    {
      id: `book:${book.id}`,
      kind: "book",
      title: book.title,
      subtitle: `${book.genre} · ${book.platform}`,
      status: book.status,
      count: book.chapterCount,
      metadata: {
        bookId: book.id,
        totalWords: book.totalWords,
        updatedAt: book.updatedAt,
      },
      children: [volumeNode, generatedGroup, draftsGroup, outlineNode, bibleGroup],
    },
  ];
}

function groupNode({
  id,
  title,
  children,
  emptyState,
  forceEmptyWhenEveryChildCountIsZero = false,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: readonly StudioResourceNode[];
  readonly emptyState: StudioResourceEmptyState;
  readonly forceEmptyWhenEveryChildCountIsZero?: boolean;
}): StudioResourceNode {
  const hasChildren = children.length > 0;
  const everyChildCountIsZero = hasChildren && children.every((child) => (child.count ?? 0) === 0);

  return {
    id,
    kind: "group",
    title,
    count: children.reduce((sum, child) => sum + (child.count ?? 1), 0),
    children,
    emptyState: !hasChildren || (forceEmptyWhenEveryChildCountIsZero && everyChildCountIsZero) ? emptyState : undefined,
  };
}

function toChapterNode(bookId: string, chapter: ChapterSummary): StudioResourceNode {
  return {
    id: `chapter:${bookId}:${chapter.number}`,
    kind: "chapter",
    title: chapter.title,
    subtitle: `第 ${chapter.number} 章 · ${chapter.wordCount} 字`,
    status: chapter.status,
    count: chapter.wordCount,
    metadata: {
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
    status: candidate.status,
    badge: candidate.source,
    metadata: {
      bookId: candidate.bookId,
      targetChapterId: candidate.targetChapterId,
      createdAt: candidate.createdAt,
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
      updatedAt: draft.updatedAt,
    },
  };
}
