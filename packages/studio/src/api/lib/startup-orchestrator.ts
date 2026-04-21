import { rebuildSearchIndex, type SearchIndexRebuildState, type SearchIndexRebuildSummary } from "./search-index-rebuild.js";

export interface StartupOrchestratorState extends SearchIndexRebuildState {
  ensureRuntimeState(bookId: string, fallbackChapter?: number): Promise<void>;
}

export interface StartupOrchestratorFailure {
  readonly bookId?: string;
  readonly phase: "migration" | "search-index";
  readonly message: string;
}

export type StartupOrchestratorRecoveryStatus = "success" | "skipped" | "failed";

export interface StartupOrchestratorRecoveryAction {
  readonly kind: "runtime-state" | "search-index";
  readonly scope: "book" | "library";
  readonly status: StartupOrchestratorRecoveryStatus;
  readonly reason: string;
  readonly note?: string;
  readonly bookId?: string;
}

export interface StartupOrchestratorRecoveryReport {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly actions: ReadonlyArray<StartupOrchestratorRecoveryAction>;
  readonly counts: {
    readonly success: number;
    readonly skipped: number;
    readonly failed: number;
  };
}

export interface StartupOrchestratorSummary {
  readonly bookCount: number;
  readonly migratedBooks: number;
  readonly indexedDocuments: number;
  readonly skippedBooks: number;
  readonly failures: ReadonlyArray<StartupOrchestratorFailure>;
  readonly recoveryReport: StartupOrchestratorRecoveryReport;
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

function summarizeActions(actions: ReadonlyArray<StartupOrchestratorRecoveryAction>) {
  return actions.reduce(
    (counts, action) => {
      counts[action.status] += 1;
      return counts;
    },
    { success: 0, skipped: 0, failed: 0 },
  );
}

/**
 * 启动期最小恢复编排：
 * 1. 按书执行 structured runtime state 补建 / 修复
 * 2. 重新构建内存搜索索引
 * 3. 输出结构化恢复报告，便于后续启动日志和文档同步
 *
 * 这不是全量运维编排，也不是持久化索引恢复；它只负责把启动期必需的
 * 运行态收口到“可继续服务”的最小一致状态。
 */
export async function runStartupOrchestrator(state: StartupOrchestratorState): Promise<StartupOrchestratorSummary> {
  const startedAt = new Date();
  const bookIds = await state.listBooks();
  const failures: StartupOrchestratorFailure[] = [];
  const actions: StartupOrchestratorRecoveryAction[] = [];
  let migratedBooks = 0;
  let indexSummary: SearchIndexRebuildSummary | null = null;

  for (const bookId of bookIds) {
    try {
      const fallbackChapter = await resolveFallbackChapter(state, bookId);
      await state.ensureRuntimeState(bookId, fallbackChapter);
      migratedBooks += 1;
      actions.push({
        kind: "runtime-state",
        scope: "book",
        bookId,
        status: "success",
        reason: "运行态已补建",
        note: `fallbackChapter=${fallbackChapter}`,
      });
    } catch (error) {
      const message = toErrorMessage(error);
      failures.push({
        bookId,
        phase: "migration",
        message,
      });
      actions.push({
        kind: "runtime-state",
        scope: "book",
        bookId,
        status: "failed",
        reason: "运行态补建失败",
        note: message,
      });
    }
  }

  try {
    indexSummary = await rebuildSearchIndex(state);
    actions.push({
      kind: "search-index",
      scope: "library",
      status: "success",
      reason: "内存搜索索引已重建",
      note: `bookCount=${indexSummary.bookCount}, indexedDocuments=${indexSummary.indexedDocuments}, skippedBooks=${indexSummary.skippedBooks}`,
    });
    if (indexSummary.skippedBooks > 0) {
      actions.push({
        kind: "search-index",
        scope: "library",
        status: "skipped",
        reason: "部分书籍在索引重建中被跳过",
        note: `skippedBooks=${indexSummary.skippedBooks}`,
      });
    }
  } catch (error) {
    const message = toErrorMessage(error);
    failures.push({
      phase: "search-index",
      message,
    });
    actions.push({
      kind: "search-index",
      scope: "library",
      status: "failed",
      reason: "内存搜索索引重建失败",
      note: message,
    });
  }

  const finishedAt = new Date();
  const counts = summarizeActions(actions);

  return {
    bookCount: bookIds.length,
    migratedBooks,
    indexedDocuments: indexSummary?.indexedDocuments ?? 0,
    skippedBooks: indexSummary?.skippedBooks ?? 0,
    failures,
    recoveryReport: {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      actions,
      counts,
    },
  };
}
