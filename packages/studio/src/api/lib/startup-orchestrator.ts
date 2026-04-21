import { rebuildSearchIndex, type SearchIndexRebuildState } from "./search-index-rebuild.js";

export interface StartupOrchestratorState extends SearchIndexRebuildState {
  ensureRuntimeState(bookId: string, fallbackChapter?: number): Promise<void>;
}

export interface StartupOrchestratorFailure {
  readonly bookId: string;
  readonly phase: "migration";
  readonly message: string;
}

export interface StartupOrchestratorSummary {
  readonly bookCount: number;
  readonly migratedBooks: number;
  readonly indexedDocuments: number;
  readonly skippedBooks: number;
  readonly failures: ReadonlyArray<StartupOrchestratorFailure>;
}

async function resolveFallbackChapter(state: Pick<SearchIndexRebuildState, "loadChapterIndex">, bookId: string): Promise<number> {
  try {
    const chapters = await state.loadChapterIndex(bookId);
    return chapters.reduce((max, chapter) => Math.max(max, Number.isInteger(chapter.number) ? chapter.number : 0), 0);
  } catch {
    return 0;
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * 启动期最小恢复编排：
 * 1. 按书执行 structured runtime state 补建 / 修复
 * 2. 重新构建内存搜索索引
 *
 * 这不是全量运维编排，也不是持久化索引恢复；它只负责把启动期必需的
 * 运行态收口到“可继续服务”的最小一致状态。
 */
export async function runStartupOrchestrator(state: StartupOrchestratorState): Promise<StartupOrchestratorSummary> {
  const bookIds = await state.listBooks();
  const failures: StartupOrchestratorFailure[] = [];
  let migratedBooks = 0;

  for (const bookId of bookIds) {
    try {
      const fallbackChapter = await resolveFallbackChapter(state, bookId);
      await state.ensureRuntimeState(bookId, fallbackChapter);
      migratedBooks += 1;
    } catch (error) {
      failures.push({
        bookId,
        phase: "migration",
        message: toErrorMessage(error),
      });
    }
  }

  const indexSummary = await rebuildSearchIndex(state);

  return {
    bookCount: bookIds.length,
    migratedBooks,
    indexedDocuments: indexSummary.indexedDocuments,
    skippedBooks: indexSummary.skippedBooks,
    failures,
  };
}
