/**
 * Manage causal chains — events that need resolution.
 */

export type CausalChainStatus = "open" | "progressing" | "resolved" | "abandoned";
export type CausalChainUrgency = "low" | "medium" | "high" | "overdue";

export interface CausalChain {
  id: string;
  bookId: string;
  triggerChapter: number;
  triggerEvent: string;
  expectedResolution?: string;
  status: CausalChainStatus;
  lastProgressChapter?: number;
  urgency: CausalChainUrgency;
}

/**
 * Update urgency levels based on current chapter.
 * Called after each chapter is written.
 */
export async function updateCausalChainUrgency(bookId: string, currentChapter: number): Promise<number> {
  const { getStorageDatabase } = await import("@vivy1024/novelfork-core/storage");
  const storage = getStorageDatabase();

  const chains = storage.sqlite.prepare(
    "SELECT id, trigger_chapter, last_progress_chapter FROM jingwei_causal_chains WHERE book_id = ? AND status IN ('open', 'progressing')"
  ).all(bookId) as Array<{ id: string; trigger_chapter: number; last_progress_chapter: number | null }>;

  let updated = 0;
  for (const chain of chains) {
    const lastActive = chain.last_progress_chapter ?? chain.trigger_chapter;
    const gap = currentChapter - lastActive;

    let newUrgency: CausalChainUrgency;
    if (gap >= 100) newUrgency = "overdue";
    else if (gap >= 50) newUrgency = "high";
    else if (gap >= 20) newUrgency = "medium";
    else newUrgency = "low";

    storage.sqlite.prepare("UPDATE jingwei_causal_chains SET urgency = ? WHERE id = ?").run(newUrgency, chain.id);
    updated++;
  }

  return updated;
}

/**
 * Create a new causal chain from a chapter event.
 */
export async function createCausalChain(bookId: string, triggerChapter: number, triggerEvent: string, expectedResolution?: string): Promise<string> {
  const { getStorageDatabase } = await import("@vivy1024/novelfork-core/storage");
  const storage = getStorageDatabase();
  const id = `chain-${bookId}-${Date.now()}`;
  storage.sqlite.prepare(
    "INSERT INTO jingwei_causal_chains (id, book_id, trigger_chapter, trigger_event, expected_resolution, status, urgency, created_at) VALUES (?, ?, ?, ?, ?, 'open', 'low', ?)"
  ).run(id, bookId, triggerChapter, triggerEvent, expectedResolution ?? null, Date.now());
  return id;
}

/**
 * Mark a causal chain as progressed or resolved.
 */
export async function progressCausalChain(chainId: string, chapterNumber: number, status?: CausalChainStatus): Promise<void> {
  const { getStorageDatabase } = await import("@vivy1024/novelfork-core/storage");
  const storage = getStorageDatabase();
  if (status === "resolved" || status === "abandoned") {
    storage.sqlite.prepare("UPDATE jingwei_causal_chains SET status = ?, last_progress_chapter = ? WHERE id = ?").run(status, chapterNumber, chainId);
  } else {
    storage.sqlite.prepare("UPDATE jingwei_causal_chains SET status = 'progressing', last_progress_chapter = ? WHERE id = ?").run(chapterNumber, chainId);
  }
}
