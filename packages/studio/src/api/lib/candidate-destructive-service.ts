import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CANDIDATES_DIR = "generated-candidates";
const DRAFTS_DIR = "drafts";
const INDEX_FILE = "index.json";

interface ChapterCandidateRecord {
  readonly id: string;
  readonly contentFileName: string;
  readonly [key: string]: unknown;
}

interface DraftCandidateRecord {
  readonly id: string;
  readonly fileName: string;
  readonly [key: string]: unknown;
}

export interface CandidateDestructiveServiceOptions {
  readonly root: string;
}

async function loadIndex<T>(dir: string): Promise<T[]> {
  try {
    const raw = await readFile(join(dir, INDEX_FILE), "utf-8");
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
}

async function saveIndex<T>(dir: string, records: readonly T[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, INDEX_FILE), JSON.stringify(records, null, 2), "utf-8");
}

export function createCandidateDestructiveService(options: CandidateDestructiveServiceOptions) {
  const bookDir = (bookId: string) => join(options.root, "books", bookId);

  return {
    async deleteDraft(bookId: string, draftId: string) {
      const draftsDir = join(bookDir(bookId), DRAFTS_DIR);
      const drafts = await loadIndex<DraftCandidateRecord>(draftsDir);
      const existing = drafts.find((draft) => draft.id === draftId);
      if (!existing) return { error: "Draft not found" as const };
      await rm(join(draftsDir, existing.fileName)).catch(() => undefined);
      await saveIndex(draftsDir, drafts.filter((draft) => draft.id !== draftId));
      return { ok: true, draftId, mode: "hard-delete" as const };
    },

    async deleteCandidate(bookId: string, candidateId: string) {
      const candidatesDir = join(bookDir(bookId), CANDIDATES_DIR);
      const candidates = await loadIndex<ChapterCandidateRecord>(candidatesDir);
      const existing = candidates.find((candidate) => candidate.id === candidateId);
      if (!existing) return { error: "Candidate not found" as const };
      await rm(join(candidatesDir, existing.contentFileName)).catch(() => undefined);
      await saveIndex(candidatesDir, candidates.filter((candidate) => candidate.id !== candidateId));
      return { ok: true, candidateId, mode: "hard-delete" as const };
    },
  };
}
