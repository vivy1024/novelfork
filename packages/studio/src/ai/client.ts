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
  audit(bookId: string, chapter: number): Promise<AuditResult>;
  revise(bookId: string, chapter: number, mode: string, brief?: string): Promise<ReviseResult>;
  detect(bookId: string, chapter: number): Promise<DetectResult>;
  detectAll(bookId: string): Promise<DetectAllResult>;
  styleAnalyze(text: string, sourceName: string): Promise<unknown>;
  styleImport(bookId: string, text: string, sourceName: string): Promise<unknown>;
}
