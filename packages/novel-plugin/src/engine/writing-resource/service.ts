import { randomUUID } from "node:crypto";

import type { StorageDatabase } from "@vivy1024/novelfork-core";
import { createWritingResourceFileStore, type WritingResourceFileStore } from "./file-store.js";
import { chapterWordCount, type ChapterVolumeDirectoryResolver } from "./chapter-layout.js";
import { createWritingResourceRepository, type WritingResourceRepository } from "./repository.js";
import type {
  CreateWritingResourceInput,
  ListWritingResourcesFilter,
  UpdateWritingResourceInput,
  WritingResource,
  WritingResourceStatus,
} from "./types.js";
import { persistNarrativeEvents } from "../narrative-memory/events.js";
import { applyNarrativeEvents, type ApplyNarrativeEventsResult } from "../narrative-memory/reducer.js";
import { NarrativeEventSchema } from "../narrative-memory/types.js";
import { recordChapterCompletion } from "../tools/writing-log.js";

export type WritingResourceService = {
  readonly list: (bookId: string, filter?: ListWritingResourcesFilter) => Promise<WritingResource[]>;
  readonly getById: (bookId: string, id: string) => Promise<WritingResource | null>;
  readonly create: (bookId: string, input: CreateServiceInput) => Promise<WritingResource>;
  readonly update: (bookId: string, id: string, input: UpdateWritingResourceInput) => Promise<WritingResource>;
  readonly transition: (bookId: string, id: string, action: WritingResourceTransitionAction) => Promise<WritingResource>;
  readonly softDelete: (bookId: string, id: string) => Promise<WritingResource>;
  readonly getHistory: (bookId: string, id: string) => Promise<WritingResource[]>;
  readonly findAcceptedChapter: (bookId: string, chapterNumber: number) => Promise<WritingResource | null>;
};

export type CreateServiceInput = Omit<CreateWritingResourceInput, "id" | "bookId" | "createdAt" | "updatedAt"> & {
  readonly id?: string;
  readonly createdAt?: number;
  readonly updatedAt?: number;
};

export type WritingResourceTransitionAction =
  | { readonly action: "accept"; readonly chapterNumber: number; readonly mode: "replace" | "merge" | "new" }
  | { readonly action: "reject" }
  | { readonly action: "archive" }
  | { readonly action: "to-draft" }
  | { readonly action: "to-candidate" }
  | { readonly action: "restore" };

const VALID_TRANSITIONS: Record<WritingResourceStatus, readonly WritingResourceTransitionAction["action"][]> = {
  draft: ["accept", "to-candidate"],
  candidate: ["accept", "reject", "archive", "to-draft"],
  accepted: [],
  rejected: ["to-draft"],
  archived: ["restore"],
};

/**
 * Hybrid resource service used by the Runtime domain adapter.
 *
 * - Existing writing_resource rows remain readable and writable in place.
 * - Books that already use v3 chapter files continue to use those files.
 * - Lists merge both stores without migrating, resetting, or fabricating data.
 */
export function createWritingResourceService(input: {
  readonly storage: StorageDatabase;
  readonly now?: () => number;
  readonly resolveBookDir?: (bookId: string) => string;
  readonly resolveChapterVolumeDirectory?: ChapterVolumeDirectoryResolver;
  readonly repository?: WritingResourceRepository;
}): WritingResourceService {
  const now = input.now ?? (() => Date.now());
  const repository = input.repository ?? createWritingResourceRepository(input.storage);
  const fileStore = input.resolveBookDir
    ? createWritingResourceFileStore(input.resolveBookDir, {
        resolveChapterVolumeDirectory: input.resolveChapterVolumeDirectory,
      })
    : undefined;

  async function recordAcceptedChapterDelta(
    bookId: string,
    previous: WritingResource | null,
    current: WritingResource,
  ): Promise<void> {
    if (current.type !== "chapter" || current.status !== "accepted" || !current.chapterNumber) return;
    const hasBook = input.storage.sqlite.prepare("SELECT 1 AS present FROM book WHERE id = ?").get(bookId);
    if (!hasBook) return;
    const wordCount = Math.max(0, current.wordCount - (previous?.wordCount ?? 0));
    if (wordCount <= 0) return;
    const completedAt = new Date(current.updatedAt).toISOString();
    await recordChapterCompletion(input.storage, {
      bookId,
      chapterNumber: current.chapterNumber,
      wordCount,
      completedAt,
      date: completedAt.slice(0, 10),
    });
  }

  async function list(bookId: string, filter: ListWritingResourcesFilter = {}): Promise<WritingResource[]> {
    const databaseResources = repository.list(bookId, filter);
    const formalDatabaseResources = fileStore
      ? await Promise.all(databaseResources.map((resource) => materializeAcceptedChapter(bookId, resource)))
      : databaseResources;
    const fileResources = fileStore
      ? await fileStore.list(bookId, filter).catch(() => [])
      : [];
    return mergeResources(formalDatabaseResources, fileResources, filter);
  }

  async function materializeAcceptedChapter(
    bookId: string,
    resource: WritingResource,
  ): Promise<WritingResource> {
    if (!fileStore || resource.type !== "chapter" || resource.status !== "accepted" || !resource.chapterNumber) {
      return resource;
    }
    const existing = await fileStore.findAcceptedChapter(bookId, resource.chapterNumber).catch(() => null);
    if (existing) return existing;
    return fileStore.create(bookId, {
      ...resource,
      id: `chapter:${resource.chapterNumber}`,
      chapterNumber: resource.chapterNumber,
      status: "accepted",
      type: "chapter",
    });
  }

  async function getById(bookId: string, id: string): Promise<WritingResource | null> {
    const databaseResource = repository.getById(bookId, id);
    if (databaseResource) return materializeAcceptedChapter(bookId, databaseResource);
    return fileStore ? fileStore.getById(bookId, id) : null;
  }

  async function findAcceptedChapter(bookId: string, chapterNumber: number): Promise<WritingResource | null> {
    const fileResource = fileStore
      ? await fileStore.findAcceptedChapter(bookId, chapterNumber).catch(() => null)
      : null;
    if (fileResource) return fileResource;
    const databaseResource = repository.findAcceptedChapter(bookId, chapterNumber);
    return databaseResource ? materializeAcceptedChapter(bookId, databaseResource) : null;
  }

  return {
    list,
    getById,
    findAcceptedChapter,

    async create(bookId, resource) {
      const chapterNumber = resource.chapterNumber ?? await nextChapterNumber(list, bookId);
      // 正式章节文件是唯一权威源；SQLite writing_resource 只保留草稿/历史资源。
      const useDatabase = !fileStore
        || resource.type !== "chapter"
        || resource.status !== "accepted";
      const timestamp = resource.updatedAt ?? now();
      const requestedId = resource.id?.trim();
      const id = useDatabase
        ? requestedId && !repository.hasId(requestedId) ? requestedId : `wr-${randomUUID()}`
        : requestedId || `chapter:${chapterNumber}`;
      const prepared: CreateWritingResourceInput = {
        ...resource,
        id,
        bookId,
        chapterNumber,
        createdAt: resource.createdAt ?? timestamp,
        updatedAt: timestamp,
        acceptedAt: resource.acceptedAt ?? (resource.status === "accepted" ? timestamp : null),
      };
      const previous = prepared.type === "chapter" && prepared.status === "accepted" && prepared.chapterNumber
        ? await findAcceptedChapter(bookId, prepared.chapterNumber)
        : null;
      const created = useDatabase
        ? repository.create(prepared)
        : await fileStore!.create(bookId, prepared);
      await recordAcceptedChapterDelta(bookId, previous, created);
      return created;
    },

    async update(bookId, id, patch) {
      const databaseResource = repository.getById(bookId, id);
      if (databaseResource?.type === "chapter" && databaseResource.status === "accepted" && fileStore) {
        const formal = await materializeAcceptedChapter(bookId, databaseResource);
        const updated = await fileStore.update(bookId, formal.id, { ...patch, updatedAt: patch.updatedAt ?? now() });
        if (updated) {
          await recordAcceptedChapterDelta(bookId, formal, updated);
          return updated;
        }
        throw new Error(`Formal chapter file not found: ${formal.id}`);
      }
      if (databaseResource) {
        const updated = repository.update(bookId, id, { ...patch, updatedAt: patch.updatedAt ?? now() });
        if (!updated) throw new Error(`Writing resource not found: ${id}`);
        await recordAcceptedChapterDelta(bookId, databaseResource, updated);
        return updated;
      }
      if (fileStore) {
        const previous = await fileStore.getById(bookId, id);
        const updated = await fileStore.update(bookId, id, { ...patch, updatedAt: patch.updatedAt ?? now() });
        if (updated) {
          await recordAcceptedChapterDelta(bookId, previous, updated);
          return updated;
        }
      }
      throw new Error(`Writing resource not found: ${id}`);
    },

    async transition(bookId, id, action) {
      const resource = repository.getById(bookId, id);
      if (!resource || resource.deletedAt !== null) throw new Error(`Writing resource not found: ${id}`);
      if (!VALID_TRANSITIONS[resource.status].includes(action.action)) {
        throw new Error(`Invalid writing resource transition: ${resource.status} -> ${action.action}`);
      }
      const timestamp = now();
      if (action.action === "accept") {
        if (!Number.isInteger(action.chapterNumber) || action.chapterNumber <= 0) {
          throw new Error("Accept action requires a positive integer chapterNumber.");
        }
        const existing = await findAcceptedChapter(bookId, action.chapterNumber);
        if (action.mode === "new" && existing) {
          throw new Error(`Chapter ${action.chapterNumber} already exists.`);
        }

        let content = resource.content;
        let version = 1;
        let parentId = resource.parentId;
        if (existing) {
          if (action.mode === "merge") content = `${existing.content.trim()}\n\n${resource.content.trim()}`;
          version = existing.version + 1;
          parentId = existing.id;
          if (repository.getById(bookId, existing.id)) {
            repository.update(bookId, existing.id, { status: "archived", updatedAt: timestamp });
          } else if (fileStore) {
            await fileStore.softDelete(bookId, existing.id);
          }
        }

        const accepted = repository.update(bookId, id, {
          type: "chapter",
          status: "accepted",
          chapterNumber: action.chapterNumber,
          content,
          wordCount: chapterWordCount(content),
          parentId,
          version,
          updatedAt: timestamp,
          acceptedAt: timestamp,
        });
        if (!accepted) throw new Error(`Writing resource not found: ${id}`);
        await recordAcceptedChapterDelta(bookId, existing, accepted);
        return accepted;
      }
      if (action.action === "to-draft") {
        const updated = repository.update(bookId, id, { type: "draft", status: "draft", updatedAt: timestamp });
        if (!updated) throw new Error(`Writing resource not found: ${id}`);
        return updated;
      }
      if (action.action === "to-candidate") {
        const updated = repository.update(bookId, id, { type: "candidate", status: "candidate", updatedAt: timestamp });
        if (!updated) throw new Error(`Writing resource not found: ${id}`);
        return updated;
      }
      if (action.action === "restore") {
        const updated = repository.update(bookId, id, { type: "candidate", status: "candidate", updatedAt: timestamp });
        if (!updated) throw new Error(`Writing resource not found: ${id}`);
        return updated;
      }
      const targetStatus = action.action === "reject" ? "rejected" : "archived";
      const updated = repository.update(bookId, id, { status: targetStatus, updatedAt: timestamp });
      if (!updated) throw new Error(`Writing resource not found: ${id}`);
      return updated;
    },

    async softDelete(bookId, id) {
      if (repository.getById(bookId, id)) {
        const deleted = repository.softDelete(bookId, id, now());
        if (!deleted) throw new Error(`Writing resource not found: ${id}`);
        return deleted;
      }
      if (fileStore) {
        const deleted = await fileStore.softDelete(bookId, id);
        if (deleted) return deleted;
      }
      throw new Error(`Writing resource not found: ${id}`);
    },

    async getHistory(bookId, id) {
      if (repository.getById(bookId, id)) return repository.getHistory(bookId, id);
      return fileStore ? fileStore.getHistory(bookId, id) : [];
    },
  };
}

async function nextChapterNumber(
  list: (bookId: string, filter?: ListWritingResourcesFilter) => Promise<WritingResource[]>,
  bookId: string,
): Promise<number> {
  const existing = await list(bookId, { type: "chapter" });
  return existing.reduce((max, entry) => Math.max(max, entry.chapterNumber ?? 0), 0) + 1;
}

function mergeResources(
  databaseResources: readonly WritingResource[],
  fileResources: readonly WritingResource[],
  filter: ListWritingResourcesFilter,
): WritingResource[] {
  const merged = new Map<string, WritingResource>();
  for (const resource of [...databaseResources, ...fileResources]) {
    const key = resource.status === "accepted" && resource.type === "chapter" && resource.deletedAt === null && resource.chapterNumber
      ? `accepted-chapter:${resource.chapterNumber}`
      : `resource:${resource.id}`;
    const existing = merged.get(key);
    if (!existing || resource.updatedAt > existing.updatedAt) merged.set(key, resource);
  }
  return Array.from(merged.values())
    .filter((resource) => filter.includeDeleted || resource.deletedAt === null)
    .filter((resource) => !filter.type || resource.type === filter.type)
    .filter((resource) => !filter.status || resource.status === filter.status)
    .filter((resource) => typeof filter.chapterNumber !== "number" || resource.chapterNumber === filter.chapterNumber)
    .sort((left, right) => (left.chapterNumber ?? 999999) - (right.chapterNumber ?? 999999) || right.updatedAt - left.updatedAt);
}

export async function applyNarrativeEventsForChapterResult(
  storage: StorageDatabase,
  bookId: string,
  metadata: Record<string, unknown> | undefined,
): Promise<ApplyNarrativeEventsResult | undefined> {
  const rawEvents = metadata?.narrativeEvents;
  if (!Array.isArray(rawEvents)) return undefined;
  const parsed = NarrativeEventSchema.array().safeParse(rawEvents);
  if (!parsed.success || parsed.data.length === 0) return undefined;
  let persisted = parsed.data;
  try {
    persisted = persistNarrativeEvents(storage, parsed.data);
  } catch {
    // 事件日志写入失败（例如重复 ID）不阻断正式章节写入；reducer 仍按事件 ID 幂等处理。
    persisted = parsed.data;
  }
  return applyNarrativeEvents(storage, bookId, persisted);
}
