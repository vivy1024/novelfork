import { fetchJson } from "@/hooks/use-api";

const KNOWLEDGE_API = "/api/knowledge";

export type KnowledgeFormat = "markdown" | "text" | "json";
export type KnowledgeEntryStatus = "active" | "archived";

export interface KnowledgeCollection {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly projectId: string | null;
  readonly ownerUserId?: string | null;
  readonly defaultLevel?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface KnowledgeEntrySummary {
  readonly id: string;
  readonly collectionId: string;
  readonly title: string;
  readonly slug: string;
  readonly currentRevisionId?: string | null;
  readonly tags: readonly string[];
  readonly status: KnowledgeEntryStatus;
  readonly snippet?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface KnowledgeEntry extends KnowledgeEntrySummary {
  readonly currentContent: string;
  readonly keywords: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>> | null;
}

export interface CreateKnowledgeCollectionInput {
  readonly name: string;
  readonly slug?: string;
  readonly description?: string;
  readonly projectId?: string;
}

export interface CreateKnowledgeEntryInput {
  readonly collectionId: string;
  readonly title: string;
  readonly slug?: string;
  readonly content?: string;
  readonly format?: KnowledgeFormat;
  readonly tags?: readonly string[];
  readonly keywords?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly changeNote?: string;
}

export interface UpdateKnowledgeEntryInput {
  readonly title?: string;
  readonly tags?: readonly string[];
  readonly keywords?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly status?: KnowledgeEntryStatus;
}

export interface AddKnowledgeRevisionInput {
  readonly content: string;
  readonly format?: KnowledgeFormat;
  readonly changeNote?: string;
}

interface RawKnowledgeEntry extends Omit<KnowledgeEntrySummary, "tags"> {
  readonly tags?: unknown;
  readonly tagsJson?: unknown;
  readonly currentContent?: unknown;
  readonly keywordsJson?: unknown;
  readonly metadataJson?: unknown;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}

function normalizeSummary(raw: RawKnowledgeEntry): KnowledgeEntrySummary {
  return {
    id: raw.id,
    collectionId: raw.collectionId,
    title: raw.title,
    slug: raw.slug,
    currentRevisionId: raw.currentRevisionId,
    tags: stringArray(raw.tags ?? raw.tagsJson),
    status: raw.status,
    snippet: raw.snippet,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function normalizeEntry(raw: RawKnowledgeEntry): KnowledgeEntry {
  const summary = normalizeSummary(raw);
  const metadata = raw.metadataJson;
  return {
    ...summary,
    currentContent: typeof raw.currentContent === "string" ? raw.currentContent : "",
    keywords: stringArray(raw.keywordsJson),
    metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? metadata as Record<string, unknown>
      : null,
  };
}

function jsonRequest(method: "POST" | "PATCH", body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export async function listKnowledgeCollections(): Promise<KnowledgeCollection[]> {
  return fetchJson<KnowledgeCollection[]>(`${KNOWLEDGE_API}/collections`);
}

export async function listKnowledgeEntries(filters: {
  readonly collectionId?: string;
  readonly query?: string;
} = {}): Promise<KnowledgeEntrySummary[]> {
  const search = new URLSearchParams();
  if (filters.collectionId) search.set("collectionId", filters.collectionId);
  if (filters.query?.trim()) search.set("q", filters.query.trim());
  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  const rows = await fetchJson<RawKnowledgeEntry[]>(`${KNOWLEDGE_API}/entries${suffix}`);
  return rows.map(normalizeSummary);
}

export async function getKnowledgeEntry(entryId: string): Promise<KnowledgeEntry> {
  const row = await fetchJson<RawKnowledgeEntry>(
    `${KNOWLEDGE_API}/entries/${encodeURIComponent(entryId)}`,
  );
  return normalizeEntry(row);
}

export async function createKnowledgeCollection(
  input: CreateKnowledgeCollectionInput,
): Promise<KnowledgeCollection> {
  return fetchJson<KnowledgeCollection>(
    `${KNOWLEDGE_API}/collections`,
    jsonRequest("POST", input),
  );
}

export async function createKnowledgeEntry(
  input: CreateKnowledgeEntryInput,
): Promise<KnowledgeEntry> {
  const row = await fetchJson<RawKnowledgeEntry>(
    `${KNOWLEDGE_API}/entries`,
    jsonRequest("POST", input),
  );
  return normalizeEntry(row);
}

export async function updateKnowledgeEntry(
  entryId: string,
  input: UpdateKnowledgeEntryInput,
): Promise<KnowledgeEntry> {
  const row = await fetchJson<RawKnowledgeEntry>(
    `${KNOWLEDGE_API}/entries/${encodeURIComponent(entryId)}`,
    jsonRequest("PATCH", input),
  );
  return normalizeEntry(row);
}

export async function addKnowledgeRevision(
  entryId: string,
  input: AddKnowledgeRevisionInput,
): Promise<{ readonly entryId: string; readonly revisionId: string; readonly version: number }> {
  return fetchJson(
    `${KNOWLEDGE_API}/entries/${encodeURIComponent(entryId)}/revisions`,
    jsonRequest("POST", input),
  );
}

export async function deleteKnowledgeEntry(entryId: string): Promise<{ readonly ok: true }> {
  return fetchJson(
    `${KNOWLEDGE_API}/entries/${encodeURIComponent(entryId)}`,
    { method: "DELETE" },
  );
}
