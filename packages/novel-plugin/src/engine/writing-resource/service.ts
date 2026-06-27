import type { StorageDatabase } from "@vivy1024/novelfork-core";
import { createWritingResourceFileStore, type WritingResourceFileStore } from "./file-store.js";
import type {
  CreateWritingResourceInput,
  ListWritingResourcesFilter,
  UpdateWritingResourceInput,
  WritingResource,
} from "./types.js";
import { persistNarrativeEvents } from "../narrative-memory/events.js";
import { applyNarrativeEvents, type ApplyNarrativeEventsResult } from "../narrative-memory/reducer.js";
import { NarrativeEventSchema } from "../narrative-memory/types.js";

export type WritingResourceService = {
  readonly list: (bookId: string, filter?: ListWritingResourcesFilter) => Promise<WritingResource[]>;
  readonly getById: (bookId: string, id: string) => Promise<WritingResource | null>;
  readonly create: (bookId: string, input: CreateServiceInput) => Promise<WritingResource>;
  readonly update: (bookId: string, id: string, input: UpdateWritingResourceInput) => Promise<WritingResource>;
  readonly softDelete: (bookId: string, id: string) => Promise<WritingResource>;
  readonly getHistory: (bookId: string, id: string) => Promise<WritingResource[]>;
  readonly findAcceptedChapter: (bookId: string, chapterNumber: number) => Promise<WritingResource | null>;
};

export type CreateServiceInput = Omit<CreateWritingResourceInput, "id" | "bookId" | "createdAt" | "updatedAt"> & {
  readonly id?: string;
  readonly createdAt?: number;
  readonly updatedAt?: number;
};


export function createWritingResourceService(input: {
  readonly storage: StorageDatabase;
  readonly now?: () => number;
  readonly resolveBookDir?: (bookId: string) => string;
}): WritingResourceService {
  const now = input.now ?? (() => Date.now());
  if (!input.resolveBookDir) {
    throw new Error("resolveBookDir is required: formal chapters are stored on the file system.");
  }
  const store = createFileSystemResourceStore(createWritingResourceFileStore(input.resolveBookDir));

  return {
    list: (bookId, filter) => store.list(bookId, filter),
    getById: (bookId, id) => store.getById(bookId, id),
    findAcceptedChapter: (bookId, num) => store.findAcceptedChapter(bookId, num),
    getHistory: (bookId, id) => store.getHistory(bookId, id),

    async create(bookId, resource) {
      const prepared = await prepareCreateInput(bookId, resource, store, now);
      return store.create(bookId, prepared);
    },

    async update(bookId, id, patch) {
      const updated = await store.update(bookId, id, { ...patch, updatedAt: patch.updatedAt ?? now() });
      if (!updated) throw new Error(`Writing resource not found: ${id}`);
      return updated;
    },


    async softDelete(bookId, id) {
      const deleted = await store.softDelete(bookId, id);
      if (!deleted) throw new Error(`Writing resource not found: ${id}`);
      return deleted;
    },
  };
}

type WritingResourceStore = {
  list(bookId: string, filter?: ListWritingResourcesFilter): Promise<WritingResource[]>;
  getById(bookId: string, id: string): Promise<WritingResource | null>;
  create(bookId: string, input: CreateWritingResourceInput): Promise<WritingResource>;
  update(bookId: string, id: string, input: UpdateWritingResourceInput): Promise<WritingResource | null>;
  softDelete(bookId: string, id: string): Promise<WritingResource | null>;
  findAcceptedChapter(bookId: string, chapterNumber: number): Promise<WritingResource | null>;
  getHistory(bookId: string, id: string): Promise<WritingResource[]>;
};

function createFileSystemResourceStore(fileStore: WritingResourceFileStore): WritingResourceStore {
  return {
    list: (bookId, filter) => fileStore.list(bookId, filter),
    getById: (bookId, id) => fileStore.getById(bookId, id),
    create: (bookId, input) => fileStore.create(bookId, input),
    update: (bookId, id, input) => fileStore.update(bookId, id, input),
    softDelete: (bookId, id) => fileStore.softDelete(bookId, id),
    findAcceptedChapter: (bookId, chapterNumber) => fileStore.findAcceptedChapter(bookId, chapterNumber),
    getHistory: (bookId, id) => fileStore.getHistory(bookId, id),
  };
}


async function prepareCreateInput(
  bookId: string,
  resource: CreateServiceInput,
  store: WritingResourceStore,
  now: () => number,
): Promise<CreateWritingResourceInput> {
  const chapterNumber = resource.chapterNumber ?? ((await nextChapterNumber(store, bookId)));
  return {
    ...resource,
    id: resource.id ?? `chapter:${chapterNumber}`,
    bookId,
    type: "chapter",
    status: "accepted",
    chapterNumber,
    createdAt: resource.createdAt ?? now(),
    updatedAt: resource.updatedAt ?? now(),
    acceptedAt: resource.acceptedAt ?? now(),
  };
}

async function nextChapterNumber(store: WritingResourceStore, bookId: string): Promise<number> {
  const existing = await store.list(bookId, { type: "chapter" });
  return existing.reduce((max, entry) => Math.max(max, entry.chapterNumber ?? 0), 0) + 1;
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
