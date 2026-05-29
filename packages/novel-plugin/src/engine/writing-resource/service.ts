import { randomUUID } from "node:crypto";
import type { StorageDatabase } from "@vivy1024/novelfork-core";
import { createWritingResourceRepository, type WritingResourceRepository } from "./repository.js";
import type {
  CreateWritingResourceInput,
  ListWritingResourcesFilter,
  UpdateWritingResourceInput,
  WritingResource,
  WritingResourceStatus,
  WritingResourceType,
} from "./types.js";

export type WritingResourceService = {
  readonly list: (bookId: string, filter?: ListWritingResourcesFilter) => WritingResource[];
  readonly getById: (id: string) => WritingResource | null;
  readonly create: (input: CreateServiceInput) => WritingResource;
  readonly update: (id: string, input: UpdateWritingResourceInput) => WritingResource;
  readonly transition: (id: string, action: WritingResourceTransitionAction) => WritingResource;
  readonly softDelete: (id: string) => WritingResource;
  readonly getHistory: (id: string) => WritingResource[];
};

export type CreateServiceInput = Omit<CreateWritingResourceInput, "id" | "createdAt" | "updatedAt"> & {
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

export function createWritingResourceService(input: { readonly storage: StorageDatabase; readonly now?: () => number; readonly repository?: WritingResourceRepository }): WritingResourceService {
  const repository = input.repository ?? createWritingResourceRepository(input.storage);
  const now = input.now ?? (() => Date.now());

  return {
    list: repository.list,
    getById: repository.getById,

    create(resource) {
      return repository.create({
        ...resource,
        id: resource.id ?? `wr-${randomUUID()}`,
        createdAt: resource.createdAt ?? now(),
        updatedAt: resource.updatedAt ?? now(),
      });
    },

    update(id, patch) {
      const updated = repository.update(id, { ...patch, updatedAt: patch.updatedAt ?? now() });
      if (!updated) throw new Error(`Writing resource not found: ${id}`);
      return updated;
    },

    transition(id, action) {
      const resource = repository.getById(id);
      if (!resource || resource.deletedAt !== null) throw new Error(`Writing resource not found: ${id}`);
      if (!VALID_TRANSITIONS[resource.status].includes(action.action)) {
        throw new Error(`Invalid writing resource transition: ${resource.status} -> ${action.action}`);
      }
      const timestamp = now();
      if (action.action === "accept") {
        return acceptResource(repository, resource, action.chapterNumber, action.mode, timestamp);
      }
      if (action.action === "to-draft") {
        const updated = repository.update(id, { type: "draft", status: "draft", updatedAt: timestamp });
        if (!updated) throw new Error(`Writing resource not found: ${id}`);
        return updated;
      }
      if (action.action === "to-candidate") {
        const updated = repository.update(id, { type: "candidate", status: "candidate", updatedAt: timestamp });
        if (!updated) throw new Error(`Writing resource not found: ${id}`);
        return updated;
      }
      if (action.action === "restore") {
        const updated = repository.update(id, { status: "candidate", updatedAt: timestamp });
        if (!updated) throw new Error(`Writing resource not found: ${id}`);
        return updated;
      }
      const targetStatus = action.action === "reject" ? "rejected" : "archived";
      const updated = repository.update(id, { status: targetStatus, updatedAt: timestamp });
      if (!updated) throw new Error(`Writing resource not found: ${id}`);
      return updated;
    },

    softDelete(id) {
      const deleted = repository.softDelete(id, now());
      if (!deleted) throw new Error(`Writing resource not found: ${id}`);
      return deleted;
    },

    getHistory: repository.getHistory,
  };
}

function acceptResource(
  repository: WritingResourceRepository,
  resource: WritingResource,
  chapterNumber: number,
  mode: "replace" | "merge" | "new",
  timestamp: number,
): WritingResource {
  if (!Number.isInteger(chapterNumber) || chapterNumber <= 0) {
    throw new Error("Accept action requires a positive integer chapterNumber.");
  }
  const existing = repository.findAcceptedChapter(resource.bookId, chapterNumber);
  if (mode === "new" && existing) {
    throw new Error(`Chapter ${chapterNumber} already exists.`);
  }

  let content = resource.content;
  let version = 1;
  let parentId = resource.parentId;
  if (existing) {
    if (mode === "merge") content = `${existing.content.trim()}\n\n${resource.content.trim()}`;
    version = existing.version + 1;
    parentId = existing.id;
    repository.update(existing.id, { status: "archived", updatedAt: timestamp });
  }

  const updated = repository.update(resource.id, {
    type: "chapter",
    status: "accepted",
    chapterNumber,
    content,
    parentId,
    version,
    updatedAt: timestamp,
    acceptedAt: timestamp,
  });
  if (!updated) throw new Error(`Writing resource not found: ${resource.id}`);

  // Auto-apply jingwei delta if present (from pipeline.generate_chapter)
  const jingweiDelta = (resource.metadata as Record<string, unknown> | undefined)?.jingweiDelta;
  if (jingweiDelta && typeof jingweiDelta === "object") {
    void applyJingweiDeltaOnAccept(resource.bookId, jingweiDelta as JingweiDeltaForAccept).catch(() => {
      // Non-fatal: jingwei sync failure should not block accept
    });
  }

  return updated;
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

  // Use raw SQL for simplicity — upsert by title within book
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
