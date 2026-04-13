/**
 * Client-side storage abstraction — decouples React components from transport.
 * HttpStorageAdapter (web) calls /api/*; TauriStorageAdapter (Phase 3) uses invoke.
 */

export interface BookSummary {
  readonly id: string;
  readonly title: string;
  readonly genre: string;
  readonly status: string;
  readonly chapterWordCount: number;
  readonly targetChapters?: number;
  readonly chaptersWritten: number;
  readonly language?: string;
  readonly fanficMode?: string;
}

export interface BookData {
  readonly book: BookSummary;
  readonly chapters: ReadonlyArray<ChapterMeta>;
  readonly nextChapter: number;
}

export interface ChapterMeta {
  readonly number: number;
  readonly title: string;
  readonly status: string;
  readonly wordCount: number;
  readonly auditIssues?: ReadonlyArray<string>;
  readonly lengthWarnings?: ReadonlyArray<string>;
  readonly reviewNote?: string;
  readonly detectionScore?: number;
  readonly detectionProvider?: string;
  readonly lengthTelemetry?: {
    readonly target: number;
    readonly actual: number;
    readonly delta: number;
  };
  readonly tokenUsage?: {
    readonly prompt: number;
    readonly completion: number;
    readonly total: number;
  };
}

export interface ChapterDetail {
  readonly chapterNumber: number;
  readonly filename: string;
  readonly content: string;
}

export interface TruthFileEntry {
  readonly name: string;
  readonly size: number;
  readonly preview: string;
}

export interface TruthFileContent {
  readonly file: string;
  readonly content: string | null;
}

export interface CreateBookParams {
  readonly title: string;
  readonly genre: string;
  readonly language?: string;
  readonly platform?: string;
  readonly chapterWordCount?: number;
  readonly targetChapters?: number;
}

export interface BookUpdates {
  readonly chapterWordCount?: number;
  readonly targetChapters?: number;
  readonly status?: string;
  readonly language?: string;
}

export interface ProjectConfig {
  readonly name: string;
  readonly language: string;
  readonly languageExplicit: boolean;
  readonly model: string;
  readonly provider: string;
  readonly baseUrl: string;
  readonly stream?: boolean;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface ClientStorageAdapter {
  listBooks(): Promise<ReadonlyArray<BookSummary>>;
  loadBook(bookId: string): Promise<BookData>;
  createBook(params: CreateBookParams): Promise<{ status: string; bookId: string }>;
  updateBook(bookId: string, updates: BookUpdates): Promise<void>;
  deleteBook(bookId: string): Promise<void>;

  loadChapter(bookId: string, num: number): Promise<ChapterDetail>;
  saveChapter(bookId: string, num: number, content: string): Promise<void>;
  approveChapter(bookId: string, num: number): Promise<void>;
  rejectChapter(bookId: string, num: number): Promise<void>;

  listTruthFiles(bookId: string): Promise<ReadonlyArray<TruthFileEntry>>;
  loadTruthFile(bookId: string, file: string): Promise<TruthFileContent>;
  saveTruthFile(bookId: string, file: string, content: string): Promise<void>;

  loadProject(): Promise<ProjectConfig>;
  updateProject(updates: Record<string, unknown>): Promise<void>;
}
