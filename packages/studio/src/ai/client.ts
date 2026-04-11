/**
 * Client-side AI operation abstraction — decouples React from transport.
 * HttpAIClient calls /api/books/:id/* endpoints; relay client (Phase 3)
 * will send snapshots to /api/ai/* instead.
 */

export interface AuditResult {
  readonly passed: boolean;
  readonly issues?: ReadonlyArray<unknown>;
}

export interface ReviseResult {
  readonly chapterNumber?: number;
  readonly [key: string]: unknown;
}

export interface DetectResult {
  readonly chapterNumber: number;
  readonly score?: number;
  readonly [key: string]: unknown;
}

export interface DetectAllResult {
  readonly bookId: string;
  readonly results: ReadonlyArray<DetectResult>;
}

export interface AIClient {
  writeNext(bookId: string, opts?: { wordCount?: number }): Promise<{ status: string; bookId: string }>;
  draft(bookId: string, opts?: { wordCount?: number; context?: string }): Promise<{ status: string; bookId: string }>;
  audit(bookId: string, chapter: number): Promise<AuditResult>;
  revise(bookId: string, chapter: number, mode: string, brief?: string): Promise<ReviseResult>;
  rewrite(bookId: string, chapter: number, brief?: string): Promise<{ status: string }>;
  resync(bookId: string, chapter: number, brief?: string): Promise<unknown>;
  detect(bookId: string, chapter: number): Promise<DetectResult>;
  detectAll(bookId: string): Promise<DetectAllResult>;
  styleAnalyze(text: string, sourceName: string): Promise<unknown>;
  styleImport(bookId: string, text: string, sourceName: string): Promise<unknown>;
}
