/**
 * HttpAIClient — calls existing /api/books/:id/* AI endpoints via fetch.
 * Used in standalone mode. Relay mode (Phase 3) will swap this out.
 */

import type {
  AIClient,
  AuditResult,
  ReviseResult,
  DetectResult,
  DetectAllResult,
} from "./client.js";
import { fetchJson, postApi } from "../hooks/use-api.js";

export class HttpAIClient implements AIClient {
  async writeNext(bookId: string, opts?: { wordCount?: number }): Promise<{ status: string; bookId: string }> {
    return postApi<{ status: string; bookId: string }>(`/books/${bookId}/write-next`, opts);
  }

  async draft(bookId: string, opts?: { wordCount?: number; context?: string }): Promise<{ status: string; bookId: string }> {
    return postApi<{ status: string; bookId: string }>(`/books/${bookId}/draft`, opts);
  }

  async audit(bookId: string, chapter: number): Promise<AuditResult> {
    return postApi<AuditResult>(`/books/${bookId}/audit/${chapter}`);
  }

  async revise(bookId: string, chapter: number, mode: string, brief?: string): Promise<ReviseResult> {
    return fetchJson<ReviseResult>(`/books/${bookId}/revise/${chapter}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, brief: brief || undefined }),
    });
  }

  async rewrite(bookId: string, chapter: number, brief?: string): Promise<{ status: string }> {
    return fetchJson<{ status: string }>(`/books/${bookId}/rewrite/${chapter}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief: brief || undefined }),
    });
  }

  async resync(bookId: string, chapter: number, brief?: string): Promise<unknown> {
    return fetchJson(`/books/${bookId}/resync/${chapter}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief: brief || undefined }),
    });
  }

  async detect(bookId: string, chapter: number): Promise<DetectResult> {
    return postApi<DetectResult>(`/books/${bookId}/detect/${chapter}`);
  }

  async detectAll(bookId: string): Promise<DetectAllResult> {
    return postApi<DetectAllResult>(`/books/${bookId}/detect-all`);
  }

  async styleAnalyze(text: string, sourceName: string): Promise<unknown> {
    return postApi("/style/analyze", { text, sourceName });
  }

  async styleImport(bookId: string, text: string, sourceName: string): Promise<unknown> {
    return postApi(`/books/${bookId}/style/import`, { text, sourceName });
  }
}
