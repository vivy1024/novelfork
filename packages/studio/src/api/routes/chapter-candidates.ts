import { Hono } from "hono";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createCandidateDestructiveService } from "../lib/candidate-destructive-service.js";
import { getStorageDatabase } from "@vivy1024/novelfork-core";
import { createWritingResourceService, migrateWritingResourcesFromFiles } from "@vivy1024/novelfork-novel-plugin/engine";

export type ChapterCandidateStatus = "candidate" | "accepted" | "rejected" | "archived";
export type ChapterCandidateAcceptAction = "merge" | "replace" | "draft";

interface ChapterCandidateRecord {
  readonly id: string;
  readonly bookId: string;
  readonly targetChapterId?: string;
  readonly title: string;
  readonly source: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: ChapterCandidateStatus;
  readonly contentFileName: string;
  readonly metadata?: Record<string, unknown>;
  readonly acceptedAction?: ChapterCandidateAcceptAction;
  readonly draftId?: string;
}

export interface ChapterCandidate extends Omit<ChapterCandidateRecord, "contentFileName"> {
  readonly content: string | null;
  readonly contentError?: string;
}

export interface DraftCandidateRecord {
  readonly id: string;
  readonly bookId: string;
  readonly title: string;
  readonly sourceCandidateId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly wordCount: number;
  readonly fileName: string;
  readonly metadata?: Record<string, unknown>;
}

export interface DraftCandidate extends DraftCandidateRecord {
  readonly content: string;
}

interface CreateCandidateBody {
  readonly targetChapterId?: string;
  readonly title?: string;
  readonly content?: string;
  readonly source?: string;
  readonly metadata?: Record<string, unknown>;
}

interface CreateDraftBody {
  readonly title?: string;
  readonly content?: string;
  readonly metadata?: Record<string, unknown>;
}

interface UpdateDraftBody {
  readonly title?: string;
  readonly content?: string;
}

interface ChapterCandidatesRouterOptions {
  readonly now?: () => Date;
  readonly createId?: () => string;
}

const CANDIDATES_DIR = "generated-candidates";
const DRAFTS_DIR = "drafts";
const INDEX_FILE = "index.json";

export function createChapterCandidatesRouter(root: string, options: ChapterCandidatesRouterOptions = {}): Hono {
  const app = new Hono();
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? (() => randomUUID());
  const destructiveService = createCandidateDestructiveService({ root });
  const resourceService = () => createWritingResourceService({ storage: getStorageDatabase(), now: () => now().getTime() });
  let migrationPromise: Promise<unknown> | null = null;
  const ensureMigrated = () => {
    migrationPromise ??= migrateWritingResourcesFromFiles({ root, service: resourceService(), now: () => now().getTime() }).catch((error: unknown) => {
      console.warn("[writing-resource] file migration failed", error);
    });
    return migrationPromise;
  };

  app.get("/api/books/:id/candidates", async (c) => {
    await ensureMigrated();
    const bookId = c.req.param("id");
    const candidates = resourceService().list(bookId, { type: "candidate" }).map((resource) => ({
      id: resource.id,
      bookId: resource.bookId,
      targetChapterId: resource.chapterNumber ? String(resource.chapterNumber) : undefined,
      title: resource.title,
      source: resource.source ?? "writing-resource",
      createdAt: new Date(resource.createdAt).toISOString(),
      updatedAt: new Date(resource.updatedAt).toISOString(),
      status: resource.status,
      metadata: resource.metadata,
      content: resource.content,
    }));
    return c.json({ candidates });
  });

  app.get("/api/books/:id/drafts", async (c) => {
    await ensureMigrated();
    const bookId = c.req.param("id");
    const drafts = resourceService().list(bookId, { type: "draft" }).map((resource) => ({
      id: resource.id,
      bookId: resource.bookId,
      title: resource.title,
      createdAt: new Date(resource.createdAt).toISOString(),
      updatedAt: new Date(resource.updatedAt).toISOString(),
      wordCount: resource.wordCount,
      fileName: `${resource.id}.md`,
      metadata: resource.metadata,
      content: resource.content,
    }));
    return c.json({ drafts });
  });

  app.get("/api/books/:id/drafts/:draftId", async (c) => {
    const bookId = c.req.param("id");
    const draft = resourceService().getById(c.req.param("draftId"));
    if (!draft || draft.bookId !== bookId || draft.type !== "draft" || draft.deletedAt !== null) return c.json({ error: "Draft not found" }, 404);
    return c.json({ draft: {
      id: draft.id,
      bookId: draft.bookId,
      title: draft.title,
      createdAt: new Date(draft.createdAt).toISOString(),
      updatedAt: new Date(draft.updatedAt).toISOString(),
      wordCount: draft.wordCount,
      fileName: `${draft.id}.md`,
      metadata: draft.metadata,
      content: draft.content,
    } });
  });

  app.post("/api/books/:id/drafts", async (c) => {
    const bookId = c.req.param("id");
    const body: CreateDraftBody = await c.req.json<CreateDraftBody>().catch(() => ({}));
    if (!body.title?.trim()) return c.json({ error: "Draft title is required" }, 400);
    if (typeof body.content !== "string") return c.json({ error: "Draft content is required" }, 400);
    const draft = resourceService().create({
      id: buildDraftId(createId()),
      bookId,
      type: "draft",
      status: "draft",
      title: body.title.trim(),
      content: body.content,
      source: "api:drafts",
      metadata: hasMetadata(body.metadata) ? body.metadata : {},
    });
    return c.json({ draft }, 201);
  });

  app.put("/api/books/:id/drafts/:draftId", async (c) => {
    const bookId = c.req.param("id");
    const draftId = c.req.param("draftId");
    const service = resourceService();
    const existing = service.getById(draftId);
    if (!existing || existing.bookId !== bookId || existing.type !== "draft") return c.json({ error: "Draft not found" }, 404);
    const body: UpdateDraftBody = await c.req.json<UpdateDraftBody>().catch(() => ({}));
    const draft = service.update(existing.id, {
      ...(body.title?.trim() ? { title: body.title.trim() } : {}),
      ...(typeof body.content === "string" ? { content: body.content } : {}),
    });
    return c.json({ draft });
  });

  app.post("/api/books/:id/candidates", async (c) => {
    const bookId = c.req.param("id");
    const bookDir = join(root, "books", bookId);
    await ensureBookDir(bookDir);

    const body = await c.req.json<CreateCandidateBody>();
    if (!body.title?.trim()) return c.json({ error: "Candidate title is required" }, 400);
    if (typeof body.content !== "string" || body.content.length === 0) return c.json({ error: "Candidate content is required" }, 400);
    if (!body.source?.trim()) return c.json({ error: "Candidate source is required" }, 400);

    const timestamp = now().toISOString();
    const id = createId();
    const contentFileName = `${id}.md`;
    const record: ChapterCandidateRecord = {
      id,
      bookId,
      ...(body.targetChapterId ? { targetChapterId: body.targetChapterId } : {}),
      title: body.title.trim(),
      source: body.source.trim(),
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "candidate",
      contentFileName,
      ...(hasMetadata(body.metadata) ? { metadata: body.metadata } : {}),
    };

    const candidates = await loadCandidates(bookDir);
    await saveCandidateContent(bookDir, contentFileName, body.content);
    await saveCandidates(bookDir, [...candidates, record]);

    return c.json({ candidate: toCandidate(record, body.content) });
  });

  app.post("/api/books/:id/candidates/:candidateId/accept", async (c) => {
    const bookId = c.req.param("id");
    const candidateId = c.req.param("candidateId");
    const body = await c.req.json<{ action?: ChapterCandidateAcceptAction; chapterNumber?: number }>().catch(() => ({ action: undefined }));
    const action = body.action;
    const service = resourceService();
    const record = service.getById(candidateId);
    if (!record || record.bookId !== bookId || record.type !== "candidate") return c.json({ error: "Candidate not found" }, 404);
    if (action === "draft") {
      const draft = service.transition(candidateId, { action: "to-draft" });
      return c.json({ draft, candidate: draft });
    }
    if (action !== "merge" && action !== "replace") return c.json({ error: "Accept action must be merge, replace, or draft" }, 400);
    const chapterNumber = body.chapterNumber ?? record.chapterNumber ?? Number(record.metadata.targetChapterId ?? 0);
    if (!chapterNumber) return c.json({ error: "chapterNumber is required" }, 400);
    const candidate = service.transition(candidateId, { action: "accept", chapterNumber, mode: action });
    return c.json({ candidate });
  });

  app.post("/api/books/:id/candidates/:candidateId/reject", (c) => {
    const service = resourceService();
    const current = service.getById(c.req.param("candidateId"));
    if (!current || current.bookId !== c.req.param("id")) return c.json({ error: "Candidate not found" }, 404);
    return c.json({ candidate: service.transition(current.id, { action: "reject" }) });
  });

  app.post("/api/books/:id/candidates/:candidateId/archive", (c) => {
    const service = resourceService();
    const current = service.getById(c.req.param("candidateId"));
    if (!current || current.bookId !== c.req.param("id")) return c.json({ error: "Candidate not found" }, 404);
    return c.json({ candidate: service.transition(current.id, { action: "archive" }) });
  });

  app.delete("/api/books/:id/drafts/:draftId", (c) => {
    const service = resourceService();
    const current = service.getById(c.req.param("draftId"));
    if (!current || current.bookId !== c.req.param("id")) return c.json({ error: "Draft not found" }, 404);
    service.softDelete(current.id);
    return c.json({ ok: true, draftId: current.id });
  });

  app.delete("/api/books/:id/candidates/:candidateId", (c) => {
    const service = resourceService();
    const current = service.getById(c.req.param("candidateId"));
    if (!current || current.bookId !== c.req.param("id")) return c.json({ error: "Candidate not found" }, 404);
    service.softDelete(current.id);
    return c.json({ ok: true, candidateId: current.id });
  });

  return app;
}

async function ensureBookDir(bookDir: string): Promise<void> {
  try {
    await access(bookDir);
  } catch {
    await mkdir(bookDir, { recursive: true });
  }
}

async function loadCandidates(bookDir: string): Promise<ChapterCandidateRecord[]> {
  try {
    const raw = await readFile(join(bookDir, CANDIDATES_DIR, INDEX_FILE), "utf-8");
    return JSON.parse(raw) as ChapterCandidateRecord[];
  } catch {
    return [];
  }
}

async function saveCandidates(bookDir: string, candidates: readonly ChapterCandidateRecord[]): Promise<void> {
  const dir = join(bookDir, CANDIDATES_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, INDEX_FILE), JSON.stringify(candidates, null, 2), "utf-8");
}

async function saveCandidateContent(bookDir: string, fileName: string, content: string): Promise<void> {
  const dir = join(bookDir, CANDIDATES_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, fileName), content, "utf-8");
}

async function loadCandidateContent(bookDir: string, fileName: string): Promise<string> {
  return readFile(join(bookDir, CANDIDATES_DIR, fileName), "utf-8");
}

async function hydrateCandidates(bookDir: string, candidates: readonly ChapterCandidateRecord[]): Promise<ChapterCandidate[]> {
  return Promise.all(candidates.map(async (candidate) => {
    try {
      return toCandidate(candidate, await loadCandidateContent(bookDir, candidate.contentFileName));
    } catch {
      return toCandidate(candidate, null, `候选稿正文缺失：${candidate.contentFileName}`);
    }
  }));
}

function toCandidate(record: ChapterCandidateRecord, content: string | null, contentError?: string): ChapterCandidate {
  const { contentFileName: _contentFileName, ...candidate } = record;
  return { ...candidate, content, ...(contentError ? { contentError } : {}) };
}

function findCandidate(candidates: readonly ChapterCandidateRecord[], candidateId: string): ChapterCandidateRecord | undefined {
  return candidates.find((candidate) => candidate.id === candidateId);
}

function replaceCandidate(candidates: readonly ChapterCandidateRecord[], updated: ChapterCandidateRecord): ChapterCandidateRecord[] {
  return candidates.map((candidate) => candidate.id === updated.id ? updated : candidate);
}

async function updateCandidateStatus(root: string, bookId: string, candidateId: string, status: ChapterCandidateStatus, updatedAt: string) {
  const bookDir = join(root, "books", bookId);
  const candidates = await loadCandidates(bookDir);
  const record = findCandidate(candidates, candidateId);
  if (!record) return { error: "Candidate not found" };
  const updated = { ...record, status, updatedAt };
  await saveCandidates(bookDir, replaceCandidate(candidates, updated));
  try {
    return { candidate: toCandidate(updated, await loadCandidateContent(bookDir, record.contentFileName)) };
  } catch {
    return { candidate: toCandidate(updated, null, `候选稿正文缺失：${record.contentFileName}`) };
  }
}

async function saveDraftCandidate(bookDir: string, record: ChapterCandidateRecord, content: string, timestamp: string): Promise<DraftCandidate> {
  const draftId = `draft-${record.id}`;
  const draft: DraftCandidateRecord = {
    id: draftId,
    bookId: record.bookId,
    title: record.title,
    sourceCandidateId: record.id,
    createdAt: timestamp,
    updatedAt: timestamp,
    wordCount: countWords(content),
    fileName: `${draftId}.md`,
    ...(record.metadata ? { metadata: { ...record.metadata, sourceCandidateId: record.id, acceptedAction: "draft" } } : {}),
  };
  await saveDraft(bookDir, draft, content);
  return toDraft(draft, content);
}

async function loadDrafts(bookDir: string): Promise<DraftCandidateRecord[]> {
  try {
    const raw = await readFile(join(bookDir, DRAFTS_DIR, INDEX_FILE), "utf-8");
    return JSON.parse(raw) as DraftCandidateRecord[];
  } catch {
    return [];
  }
}

async function saveDrafts(bookDir: string, drafts: readonly DraftCandidateRecord[]): Promise<void> {
  const draftsDir = join(bookDir, DRAFTS_DIR);
  await mkdir(draftsDir, { recursive: true });
  await writeFile(join(draftsDir, INDEX_FILE), JSON.stringify(drafts, null, 2), "utf-8");
}

async function saveDraft(bookDir: string, draft: DraftCandidateRecord, content: string): Promise<void> {
  const draftsDir = join(bookDir, DRAFTS_DIR);
  await mkdir(draftsDir, { recursive: true });
  await writeFile(join(draftsDir, draft.fileName), content, "utf-8");
  const drafts = await loadDrafts(bookDir);
  await saveDrafts(bookDir, [...drafts.filter((item) => item.id !== draft.id), draft]);
}

async function loadDraftContent(bookDir: string, fileName: string): Promise<string> {
  return readFile(join(bookDir, DRAFTS_DIR, fileName), "utf-8");
}

async function hydrateDraft(bookDir: string, draft: DraftCandidateRecord): Promise<DraftCandidate> {
  return toDraft(draft, await loadDraftContent(bookDir, draft.fileName));
}

async function hydrateDrafts(bookDir: string, drafts: readonly DraftCandidateRecord[]): Promise<DraftCandidate[]> {
  return Promise.all(drafts.map((draft) => hydrateDraft(bookDir, draft)));
}

function toDraft(record: DraftCandidateRecord, content: string): DraftCandidate {
  return { ...record, content };
}

function findDraft(drafts: readonly DraftCandidateRecord[], draftId: string): DraftCandidateRecord | undefined {
  return drafts.find((draft) => draft.id === draftId);
}

function buildDraftId(rawId: string): string {
  const safeId = rawId.replace(/[^A-Za-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return safeId.startsWith("draft-") ? safeId : `draft-${safeId || "untitled"}`;
}

async function writeAcceptedContentToFormalChapter(bookDir: string, record: ChapterCandidateRecord, content: string, action: "merge" | "replace"): Promise<void> {
  if (!record.targetChapterId) throw new Error("Candidate has no target chapter");
  const fileName = await findFormalChapterFile(bookDir, record.targetChapterId);
  if (!fileName) throw new Error(`Target chapter ${record.targetChapterId} not found`);
  const filePath = join(bookDir, "chapters", fileName);
  if (action === "replace") {
    await writeFile(filePath, content, "utf-8");
    return;
  }
  const existing = await readFile(filePath, "utf-8");
  await writeFile(filePath, `${existing}\n\n${content}`, "utf-8");
}

async function findFormalChapterFile(bookDir: string, targetChapterId: string): Promise<string | undefined> {
  const chapterNumber = Number.parseInt(targetChapterId, 10);
  if (!Number.isFinite(chapterNumber)) return undefined;
  const prefix = String(chapterNumber).padStart(4, "0");
  const files = await readdir(join(bookDir, "chapters"));
  return files.find((file) => file.startsWith(prefix) && file.endsWith(".md"));
}

function hasMetadata(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;
}

function countWords(content: string): number {
  return content.replace(/\s+/g, "").length;
}
