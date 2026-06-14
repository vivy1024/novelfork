export type WritingResourceType = "chapter" | "candidate" | "draft";
export type WritingResourceStatus = "draft" | "candidate" | "accepted" | "rejected" | "archived";

/**
 * 应用层统一资源类型。
 * 数据库保留 "candidate" 兼容旧数据，但应用层统一视为 "draft"。
 * type 不再有业务含义，status 是唯一的生命周期标记。
 */
export type NormalizedResourceKind = "chapter" | "draft";

/** 把数据库中的 type 统一为应用层 kind */
export function normalizeResourceType(type: WritingResourceType): NormalizedResourceKind {
  return type === "chapter" ? "chapter" : "draft";
}

/** 判断 source 是否为 AI 生成 */
export function isAiGenerated(source: string | null): boolean {
  if (!source) return false;
  return source.startsWith("pipeline.") || source.startsWith("session-tool:");
}

export type WritingResource = {
  readonly id: string;
  readonly bookId: string;
  readonly type: WritingResourceType;
  readonly status: WritingResourceStatus;
  readonly title: string;
  readonly content: string;
  readonly chapterNumber: number | null;
  readonly wordCount: number;
  readonly parentId: string | null;
  readonly version: number;
  readonly source: string | null;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly acceptedAt: number | null;
  readonly deletedAt: number | null;
};

export type WritingResourceRow = {
  readonly id: string;
  readonly book_id: string;
  readonly type: WritingResourceType;
  readonly status: WritingResourceStatus;
  readonly title: string;
  readonly content: string;
  readonly chapter_number: number | null;
  readonly word_count: number;
  readonly parent_id: string | null;
  readonly version: number;
  readonly source: string | null;
  readonly metadata_json: string | null;
  readonly created_at: number;
  readonly updated_at: number;
  readonly accepted_at: number | null;
  readonly deleted_at: number | null;
};

export type CreateWritingResourceInput = {
  readonly id: string;
  readonly bookId: string;
  readonly type: WritingResourceType;
  readonly status: WritingResourceStatus;
  readonly title: string;
  readonly content: string;
  readonly chapterNumber?: number | null;
  readonly parentId?: string | null;
  readonly version?: number;
  readonly source?: string | null;
  readonly metadata?: Record<string, unknown>;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly acceptedAt?: number | null;
};

export type UpdateWritingResourceInput = Partial<{
  readonly type: WritingResourceType;
  readonly status: WritingResourceStatus;
  readonly title: string;
  readonly content: string;
  readonly chapterNumber: number | null;
  readonly wordCount: number;
  readonly parentId: string | null;
  readonly version: number;
  readonly source: string | null;
  readonly metadata: Record<string, unknown>;
  readonly updatedAt: number;
  readonly acceptedAt: number | null;
  readonly deletedAt: number | null;
}>;

export type ListWritingResourcesFilter = {
  readonly type?: WritingResourceType;
  readonly status?: WritingResourceStatus;
  readonly chapterNumber?: number;
  readonly includeDeleted?: boolean;
};

export function countChineseWords(content: string): number {
  const normalized = content.replace(/\s+/g, "").trim();
  return normalized.length;
}
