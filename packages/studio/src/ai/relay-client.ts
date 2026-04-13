/**
 * RelayAIClient — sends snapshots to relay server /api/ai/* endpoints.
 * Used in Tauri desktop mode. Prepares snapshot locally, sends to relay,
 * receives result, applies mutations back to local storage.
 */

import type {
  AIClient,
  AuditResult,
  ReviseResult,
  DetectResult,
  DetectAllResult,
} from "./client.js";
import type { ClientStorageAdapter } from "../storage/adapter.js";

interface RelayConfig {
  readonly relayUrl: string;
  readonly getAuthHeaders: () => Promise<Record<string, string>>;
  readonly getLLMConfig: () => Promise<RelayLLMConfig>;
  readonly storage: ClientStorageAdapter;
}

interface RelayLLMConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly provider?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly stream?: boolean;
  readonly modelOverrides?: Record<string, string>;
  readonly thinkingBudget?: number;
  readonly apiFormat?: "chat" | "responses";
  readonly extra?: Record<string, unknown>;
  readonly headers?: Record<string, string>;
}

interface SnapshotChapter {
  readonly num: number;
  readonly title: string;
  readonly content: string;
  readonly status?: string;
  readonly wordCount?: number;
}

async function relayFetch<T>(
  url: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export class RelayAIClient implements AIClient {
  private readonly relayUrl: string;
  private readonly getAuthHeaders: () => Promise<Record<string, string>>;
  private readonly getLLMConfig: () => Promise<RelayLLMConfig>;
  private readonly storage: ClientStorageAdapter;

  constructor(config: RelayConfig) {
    this.relayUrl = config.relayUrl.replace(/\/$/, "");
    this.getAuthHeaders = config.getAuthHeaders;
    this.getLLMConfig = config.getLLMConfig;
    this.storage = config.storage;
  }

  private async buildSnapshot(bookId: string): Promise<Record<string, unknown>> {
    const bookData = await this.storage.loadBook(bookId);
    const chapters: SnapshotChapter[] = [];
    for (const ch of bookData.chapters) {
      try {
        const detail = await this.storage.loadChapter(bookId, ch.number);
        chapters.push({
          num: ch.number,
          title: ch.title,
          content: detail.content,
          status: ch.status,
          wordCount: ch.wordCount,
        });
      } catch { /* skip unreadable */ }
    }

    const truthFiles: Record<string, string> = {};
    const truthList = await this.storage.listTruthFiles(bookId);
    for (const tf of truthList) {
      const detail = await this.storage.loadTruthFile(bookId, tf.name);
      if (detail.content) truthFiles[tf.name] = detail.content;
    }

    return {
      bookId,
      bookConfig: bookData.book,
      chapters,
      chapterIndex: bookData.chapters,
      truthFiles,
    };
  }

  async writeNext(bookId: string, opts?: { wordCount?: number }): Promise<{ status: string; bookId: string }> {
    const [snapshot, llm, headers] = await Promise.all([
      this.buildSnapshot(bookId),
      this.getLLMConfig(),
      this.getAuthHeaders(),
    ]);
    const res = await relayFetch<{ ok: boolean; result: unknown }>(
      `${this.relayUrl}/api/ai/write-next`,
      { snapshot, llm, wordCount: opts?.wordCount },
      headers,
    );
    return { status: "completed", bookId, ...res };
  }

  async draft(bookId: string, opts?: { wordCount?: number; context?: string }): Promise<{ status: string; bookId: string }> {
    const [snapshot, llm, headers] = await Promise.all([
      this.buildSnapshot(bookId),
      this.getLLMConfig(),
      this.getAuthHeaders(),
    ]);
    const res = await relayFetch<{ ok: boolean; result: unknown }>(
      `${this.relayUrl}/api/ai/draft`,
      { snapshot, llm, wordCount: opts?.wordCount, context: opts?.context },
      headers,
    );
    return { status: "completed", bookId, ...res };
  }

  async audit(bookId: string, chapter: number): Promise<AuditResult> {
    const [snapshot, llm, headers] = await Promise.all([
      this.buildSnapshot(bookId),
      this.getLLMConfig(),
      this.getAuthHeaders(),
    ]);
    return relayFetch<AuditResult>(
      `${this.relayUrl}/api/ai/audit`,
      { snapshot, llm, chapterNum: chapter },
      headers,
    );
  }

  async revise(bookId: string, chapter: number, mode: string, brief?: string): Promise<ReviseResult> {
    const [snapshot, llm, headers] = await Promise.all([
      this.buildSnapshot(bookId),
      this.getLLMConfig(),
      this.getAuthHeaders(),
    ]);
    return relayFetch<ReviseResult>(
      `${this.relayUrl}/api/ai/revise`,
      { snapshot, llm, chapterNum: chapter, mode, brief },
      headers,
    );
  }
  async rewrite(bookId: string, chapter: number, brief?: string): Promise<{ status: string }> {
    // Rewrite = rollback + write-next. In relay mode, just call write-next with brief.
    const [snapshot, llm, headers] = await Promise.all([
      this.buildSnapshot(bookId),
      this.getLLMConfig(),
      this.getAuthHeaders(),
    ]);
    await relayFetch(
      `${this.relayUrl}/api/ai/write-next`,
      { snapshot, llm, brief },
      headers,
    );
    return { status: "completed" };
  }

  async resync(bookId: string, chapter: number, brief?: string): Promise<unknown> {
    // Resync requires PipelineRunner with full projectRoot — delegate to revise
    return this.revise(bookId, chapter, "spot-fix", brief);
  }

  async detect(_bookId: string, _chapter: number): Promise<DetectResult> {
    // In relay mode, detect needs chapter content sent directly
    const detail = await this.storage.loadChapter(_bookId, _chapter);
    const headers = await this.getAuthHeaders();
    const result = await relayFetch<Record<string, unknown>>(
      `${this.relayUrl}/api/ai/detect`,
      { content: detail.content },
      headers,
    );
    return { chapterNumber: _chapter, ...result } as DetectResult;
  }

  async detectAll(bookId: string): Promise<DetectAllResult> {
    const bookData = await this.storage.loadBook(bookId);
    const results: DetectResult[] = [];
    for (const ch of bookData.chapters) {
      try {
        const r = await this.detect(bookId, ch.number);
        results.push(r);
      } catch { /* skip */ }
    }
    return { bookId, results };
  }

  async styleAnalyze(text: string, sourceName: string): Promise<unknown> {
    const headers = await this.getAuthHeaders();
    return relayFetch(
      `${this.relayUrl}/api/ai/style`,
      { text, sourceName },
      headers,
    );
  }

  async styleImport(bookId: string, text: string, sourceName: string): Promise<unknown> {
    // Style import requires PipelineRunner — not available in pure relay mode
    return this.styleAnalyze(text, sourceName);
  }
}
