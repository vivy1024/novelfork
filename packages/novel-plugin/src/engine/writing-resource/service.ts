import { randomUUID } from "node:crypto";
import type { StorageDatabase } from "@vivy1024/novelfork-core";
import { createWritingResourceRepository, type WritingResourceRepository } from "./repository.js";
import { createWritingResourceFileStore, type WritingResourceFileStore } from "./file-store.js";
import type {
  CreateWritingResourceInput,
  ListWritingResourcesFilter,
  UpdateWritingResourceInput,
  WritingResource,
  WritingResourceStatus,
  WritingResourceType,
} from "./types.js";

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

export function createWritingResourceService(input: {
  readonly storage: StorageDatabase;
  readonly now?: () => number;
  readonly resolveBookDir?: (bookId: string) => string;
}): WritingResourceService {
  const now = input.now ?? (() => Date.now());
  const fileStore = input.resolveBookDir
    ? createWritingResourceFileStore(input.resolveBookDir)
    : null;

  if (!fileStore) {
    throw new Error("WritingResourceService requires resolveBookDir for file-based storage.");
  }

  return {
    list: (bookId, filter) => fileStore.list(bookId, filter),
    getById: (bookId, id) => fileStore.getById(bookId, id),
    findAcceptedChapter: (bookId, num) => fileStore.findAcceptedChapter(bookId, num),
    getHistory: (bookId, id) => fileStore.getHistory(bookId, id),

    async create(bookId, resource) {
      return fileStore.create(bookId, {
        ...resource,
        id: resource.id ?? `draft-${randomUUID()}`,
        createdAt: resource.createdAt ?? now(),
        updatedAt: resource.updatedAt ?? now(),
      });
    },

    async update(bookId, id, patch) {
      const updated = await fileStore.update(bookId, id, { ...patch, updatedAt: patch.updatedAt ?? now() });
      if (!updated) throw new Error(`Writing resource not found: ${id}`);
      return updated;
    },

    async transition(bookId, id, action) {
      const resource = await fileStore.getById(bookId, id);
      if (!resource || resource.deletedAt !== null) throw new Error(`Writing resource not found: ${id}`);
      if (!VALID_TRANSITIONS[resource.status].includes(action.action)) {
        throw new Error(`Invalid writing resource transition: ${resource.status} -> ${action.action}`);
      }
      const timestamp = now();
      if (action.action === "accept") {
        return acceptFileResource(fileStore, bookId, resource, action.chapterNumber, action.mode, timestamp);
      }
      if (action.action === "to-draft") {
        const updated = await fileStore.update(bookId, id, { status: "draft", updatedAt: timestamp });
        if (!updated) throw new Error(`Writing resource not found: ${id}`);
        return updated;
      }
      if (action.action === "to-candidate") {
        const updated = await fileStore.update(bookId, id, { status: "candidate", updatedAt: timestamp });
        if (!updated) throw new Error(`Writing resource not found: ${id}`);
        return updated;
      }
      if (action.action === "restore") {
        const updated = await fileStore.update(bookId, id, { status: "candidate", updatedAt: timestamp });
        if (!updated) throw new Error(`Writing resource not found: ${id}`);
        return updated;
      }
      const targetStatus = action.action === "reject" ? "rejected" : "archived";
      const updated = await fileStore.update(bookId, id, { status: targetStatus, updatedAt: timestamp });
      if (!updated) throw new Error(`Writing resource not found: ${id}`);
      return updated;
    },

    async softDelete(bookId, id) {
      const deleted = await fileStore.softDelete(bookId, id);
      if (!deleted) throw new Error(`Writing resource not found: ${id}`);
      return deleted;
    },
  };
}

async function acceptFileResource(
  fileStore: WritingResourceFileStore,
  bookId: string,
  resource: WritingResource,
  chapterNumber: number,
  mode: "replace" | "merge" | "new",
  timestamp: number,
): Promise<WritingResource> {
  if (!Number.isInteger(chapterNumber) || chapterNumber <= 0) {
    throw new Error("Accept action requires a positive integer chapterNumber.");
  }
  const existing = await fileStore.findAcceptedChapter(bookId, chapterNumber);
  if (mode === "new" && existing) {
    throw new Error(`Chapter ${chapterNumber} already exists.`);
  }

  let content = resource.content;
  if (existing) {
    if (mode === "merge") content = `${existing.content.trim()}\n\n${resource.content.trim()}`;
    // archive old chapter
    await fileStore.softDelete(bookId, existing.id);
  }

  // Create accepted chapter file
  const accepted = await fileStore.create(bookId, {
    type: "chapter",
    status: "accepted",
    title: resource.title,
    content,
    chapterNumber,
    source: resource.source,
    metadata: resource.metadata,
    createdAt: resource.createdAt,
    updatedAt: timestamp,
    acceptedAt: timestamp,
  });

  // Remove original draft
  if (!resource.id.startsWith("chapter:")) {
    await fileStore.softDelete(bookId, resource.id);
  }

  // Auto-apply jingwei delta if present
  const jingweiDelta = (resource.metadata as Record<string, unknown> | undefined)?.jingweiDelta;
  if (jingweiDelta && typeof jingweiDelta === "object") {
    void applyJingweiDeltaOnAccept(bookId, jingweiDelta as JingweiDeltaForAccept).catch(() => {});
  }

  return accepted;
}

interface JingweiDeltaForAccept {
  readonly created?: ReadonlyArray<{ title: string; category: string; contentMd: string }>;
  readonly updated?: ReadonlyArray<{ title: string; category: string; contentMd: string }>;
}

async function applyJingweiDeltaOnAccept(bookId: string, delta: JingweiDeltaForAccept): Promise<void> {
  const { getStorageDatabase } = await import("@vivy1024/novelfork-core");
  const storage = getStorageDatabase();
  const entries = [...(delta.created ?? []), ...(delta.updated ?? [])];
  if (entries.length === 0) return;
  for (const entry of entries) {
    if (!entry.title?.trim() || !entry.contentMd?.trim()) continue;
    const existing = storage.sqlite.prepare(
      `SELECT id FROM story_jingwei_entry WHERE book_id = ? AND title = ? AND deleted_at IS NULL LIMIT 1`
    ).get(bookId, entry.title) as { id: string } | undefined;
    if (existing) {
      storage.sqlite.prepare(
        `UPDATE story_jingwei_entry SET content_md = ?, category = ?, updated_at = ? WHERE id = ?`
      ).run(entry.contentMd, entry.category, new Date().toISOString(), existing.id);
    } else {
      const id = `jw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      storage.sqlite.prepare(
        `INSERT INTO story_jingwei_entry (id, book_id, section_id, title, content_md, category, participates_in_ai, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`
      ).run(id, bookId, "auto", entry.title, entry.contentMd, entry.category, new Date().toISOString(), new Date().toISOString());
    }
  }
}

export function assertWritingResourceType(value: string): WritingResourceType {
  if (value === "chapter" || value === "candidate" || value === "draft") return value;
  throw new Error(`Invalid writing resource type: ${value}`);
}
