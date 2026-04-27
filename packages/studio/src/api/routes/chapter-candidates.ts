import { Hono } from "hono";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

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
  readonly acceptedAction?: ChapterCandidateAcceptAction;
  readonly draftId?: string;
}

export interface ChapterCandidate extends Omit<ChapterCandidateRecord, "contentFileName"> {
  readonly content: string;
}

export interface DraftCandidateRecord {
  readonly id: string;
  readonly bookId: string;
  readonly title: string;
  readonly sourceCandidateId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly wordCount: number;
  readonly fileName: string;
}

interface CreateCandidateBody {
  readonly targetChapterId?: string;
  readonly title?: string;
  readonly content?: string;
  readonly source?: string;
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

  app.get("/api/books/:id/candidates", async (c) => {
    const bookId = c.req.param("id");
    const bookDir = join(root, "books", bookId);
    const candidates = await loadCandidates(bookDir);
    return c.json({ candidates: await hydrateCandidates(bookDir, candidates) });
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
    };

    const candidates = await loadCandidates(bookDir);
    await saveCandidateContent(bookDir, contentFileName, body.content);
    await saveCandidates(bookDir, [...candidates, record]);

    return c.json({ candidate: toCandidate(record, body.content) });
  });

  app.post("/api/books/:id/candidates/:candidateId/accept", async (c) => {
    const bookId = c.req.param("id");
    const candidateId = c.req.param("candidateId");
    const bookDir = join(root, "books", bookId);
    const body = await c.req.json<{ action?: ChapterCandidateAcceptAction }>().catch(() => ({ action: undefined }));
    const action = body.action;
    if (action !== "merge" && action !== "replace" && action !== "draft") {
      return c.json({ error: "Accept action must be merge, replace, or draft" }, 400);
    }

    const candidates = await loadCandidates(bookDir);
    const record = findCandidate(candidates, candidateId);
    if (!record) return c.json({ error: "Candidate not found" }, 404);
    const content = await loadCandidateContent(bookDir, record.contentFileName);
    const timestamp = now().toISOString();

    let draft: DraftCandidateRecord | undefined;
    if (action === "draft") {
      draft = await saveDraftCandidate(bookDir, record, content, timestamp);
    } else {
      await writeAcceptedContentToFormalChapter(bookDir, record, content, action);
    }

    const updated: ChapterCandidateRecord = {
      ...record,
      updatedAt: timestamp,
      status: "accepted",
      acceptedAction: action,
      ...(draft ? { draftId: draft.id } : {}),
    };
    await saveCandidates(bookDir, replaceCandidate(candidates, updated));

    return c.json({ candidate: toCandidate(updated, content), ...(draft ? { draft } : {}) });
  });

  app.post("/api/books/:id/candidates/:candidateId/reject", async (c) => {
    return c.json(await updateCandidateStatus(root, c.req.param("id"), c.req.param("candidateId"), "rejected", now().toISOString()));
  });

  app.post("/api/books/:id/candidates/:candidateId/archive", async (c) => {
    return c.json(await updateCandidateStatus(root, c.req.param("id"), c.req.param("candidateId"), "archived", now().toISOString()));
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
  return Promise.all(candidates.map(async (candidate) => toCandidate(candidate, await loadCandidateContent(bookDir, candidate.contentFileName))));
}

function toCandidate(record: ChapterCandidateRecord, content: string): ChapterCandidate {
  const { contentFileName: _contentFileName, ...candidate } = record;
  return { ...candidate, content };
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
  const content = await loadCandidateContent(bookDir, record.contentFileName);
  const updated = { ...record, status, updatedAt };
  await saveCandidates(bookDir, replaceCandidate(candidates, updated));
  return { candidate: toCandidate(updated, content) };
}

async function saveDraftCandidate(bookDir: string, record: ChapterCandidateRecord, content: string, timestamp: string): Promise<DraftCandidateRecord> {
  const draftId = `draft-${record.id}`;
  const fileName = `${draftId}.md`;
  const draft: DraftCandidateRecord = {
    id: draftId,
    bookId: record.bookId,
    title: record.title,
    sourceCandidateId: record.id,
    createdAt: timestamp,
    updatedAt: timestamp,
    wordCount: countWords(content),
    fileName,
  };
  const draftsDir = join(bookDir, DRAFTS_DIR);
  await mkdir(draftsDir, { recursive: true });
  await writeFile(join(draftsDir, fileName), content, "utf-8");
  const drafts = await loadDrafts(bookDir);
  await writeFile(join(draftsDir, INDEX_FILE), JSON.stringify([...drafts.filter((item) => item.id !== draftId), draft], null, 2), "utf-8");
  return draft;
}

async function loadDrafts(bookDir: string): Promise<DraftCandidateRecord[]> {
  try {
    const raw = await readFile(join(bookDir, DRAFTS_DIR, INDEX_FILE), "utf-8");
    return JSON.parse(raw) as DraftCandidateRecord[];
  } catch {
    return [];
  }
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

function countWords(content: string): number {
  return content.replace(/\s+/g, "").length;
}
