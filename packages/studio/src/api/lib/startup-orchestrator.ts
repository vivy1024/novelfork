import { rebuildSearchIndex, type SearchIndexRebuildState, type SearchIndexRebuildSummary } from "./search-index-rebuild.js";
import type { StartupDiagnostic, StartupDiagnosticKind } from "./startup-diagnostics.js";

export interface StartupOrchestratorState extends SearchIndexRebuildState {
  ensureRuntimeState(bookId: string, fallbackChapter?: number): Promise<void>;
}

export type StartupOrchestratorRecoveryStatus = "success" | "skipped" | "failed";
export type StartupStaticMode = "embedded" | "filesystem" | "missing";

export type StartupOrchestratorFailurePhase =
  | "project-bootstrap"
  | "migration"
  | "search-index"
  | "static-delivery"
  | "compile-smoke"
  | StartupDiagnosticKind;

export interface StartupOrchestratorFailure {
  readonly bookId?: string;
  readonly phase: StartupOrchestratorFailurePhase;
  readonly message: string;
}

export interface StartupFailureDecisionAction {
  readonly kind: "repair-runtime-state" | "rebuild-search-index" | "rerun-startup-recovery" | "manual-check";
  readonly label: string;
  readonly endpoint?: string;
  readonly method?: "POST";
  readonly payload?: Readonly<Record<string, string>>;
}

export interface StartupFailureDecision {
  readonly id: string;
  readonly phase: StartupOrchestratorFailure["phase"];
  readonly severity: "error" | "warning";
  readonly title: string;
  readonly description: string;
  readonly action: StartupFailureDecisionAction;
}

export interface StartupOrchestratorRecoveryAction {
  readonly kind: "project-bootstrap" | "runtime-state" | "search-index" | "static-delivery" | "compile-smoke" | StartupDiagnosticKind;
  readonly scope: "book" | "library";
  readonly status: StartupOrchestratorRecoveryStatus;
  readonly reason: string;
  readonly note?: string;
  readonly bookId?: string;
}

export interface StartupOrchestratorOptions {
  readonly projectBootstrap?: {
    readonly status: StartupOrchestratorRecoveryStatus;
    readonly reason: string;
    readonly note?: string;
  };
  readonly staticDelivery?: {
    readonly mode: StartupStaticMode;
    readonly hasIndexHtml: boolean;
    readonly status?: StartupOrchestratorRecoveryStatus;
    readonly reason: string;
    readonly note?: string;
  };
  readonly compileSmoke?: {
    readonly status: StartupOrchestratorRecoveryStatus;
    readonly reason: string;
    readonly note?: string;
  };
  readonly diagnostics?: readonly StartupDiagnostic[];
}

export interface StartupOrchestratorDeliverySummary {
  readonly staticMode: StartupStaticMode;
  readonly indexHtmlReady: boolean;
  readonly compileSmokeStatus: StartupOrchestratorRecoveryStatus | "unknown";
  readonly compileCommand: string;
  readonly expectedArtifactPath: string;
  readonly embeddedAssetsReady: boolean;
  readonly singleFileReady: boolean;
  readonly excludedDeliveryScopes: readonly string[];
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
  readonly delivery: StartupOrchestratorDeliverySummary;
  readonly recoveryReport: StartupOrchestratorRecoveryReport;
}

export async function resolveStartupFallbackChapter(
  state: Pick<SearchIndexRebuildState, "loadChapterIndex">,
  bookId: string,
): Promise<number> {
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

const DEFAULT_COMPILE_COMMAND = "pnpm bun:compile";
const DEFAULT_EXPECTED_ARTIFACT_PATH = "dist/novelfork";
const DEFAULT_EXCLUDED_DELIVERY_SCOPES = ["installer", "signing", "auto-update", "first-launch UX"] as const;

function pushOptionalAction(
  actions: StartupOrchestratorRecoveryAction[],
  failures: StartupOrchestratorFailure[],
  action: StartupOrchestratorRecoveryAction,
  phase: StartupOrchestratorFailurePhase,
): void {
  actions.push(action);
  if (action.status === "failed") {
    failures.push({
      phase,
      bookId: action.bookId,
      message: action.note ?? action.reason,
    });
  }
}

function buildStartupDeliverySummary(options: StartupOrchestratorOptions): StartupOrchestratorDeliverySummary {
  const staticMode = options.staticDelivery?.mode ?? "missing";
  const indexHtmlReady = options.staticDelivery?.hasIndexHtml ?? false;
  const compileSmokeStatus = options.compileSmoke?.status ?? "unknown";
  const embeddedAssetsReady = staticMode === "embedded" && indexHtmlReady;
  const singleFileReady = embeddedAssetsReady && compileSmokeStatus === "success";

  return {
    staticMode,
    indexHtmlReady,
    compileSmokeStatus,
    compileCommand: DEFAULT_COMPILE_COMMAND,
    expectedArtifactPath: DEFAULT_EXPECTED_ARTIFACT_PATH,
    embeddedAssetsReady,
    singleFileReady,
    excludedDeliveryScopes: DEFAULT_EXCLUDED_DELIVERY_SCOPES,
  };
}

export function buildStartupFailureDecisions(summary: Pick<StartupOrchestratorSummary, "failures" | "delivery">): StartupFailureDecision[] {
  return summary.failures.map((failure, index) => {
    const id = `${failure.phase}:${failure.bookId ?? "library"}:${index}`;

    switch (failure.phase) {
      case "migration":
        return {
          id,
          phase: failure.phase,
          severity: "error",
          title: failure.bookId ? `${failure.bookId} 运行态修复失败` : "运行态修复失败",
          description: failure.bookId
            ? "当前 runtime state 补建失败，先对该书重新执行 repair，再回放启动恢复结果。"
            : "当前运行态补建失败，建议重新执行启动恢复并核对最近一次 migration 结果。",
          action: failure.bookId
            ? {
                kind: "repair-runtime-state",
                label: "修复该书运行态",
                endpoint: "/api/admin/resources/recovery/runtime-state",
                method: "POST",
                payload: { bookId: failure.bookId },
              }
            : {
                kind: "rerun-startup-recovery",
                label: "重新执行启动恢复",
                endpoint: "/api/admin/resources/recovery",
                method: "POST",
              },
        };
      case "search-index":
        return {
          id,
          phase: failure.phase,
          severity: "error",
          title: "搜索索引重建失败",
          description: "当前内存搜索索引没有完成 rebuild，先单独重建搜索索引，再重新核对 startup summary。",
          action: {
            kind: "rebuild-search-index",
            label: "重建搜索索引",
            endpoint: "/api/admin/resources/recovery/search-index",
            method: "POST",
          },
        };
      case "project-bootstrap":
        return {
          id,
          phase: failure.phase,
          severity: "error",
          title: "项目初始化失败",
          description: "先确认 novelfork.json 与项目目录写权限，再重新执行启动恢复，避免 startup 继续停留在半初始化状态。",
          action: {
            kind: "manual-check",
            label: "检查项目配置与写权限",
          },
        };
      case "static-delivery":
        return {
          id,
          phase: failure.phase,
          severity: "error",
          title: "静态交付边界未闭环",
          description:
            summary.delivery.staticMode === "missing"
              ? "当前仍是 API-only 启动状态，先补齐前端静态资源或嵌入产物，再重新执行启动恢复。"
              : "静态资源入口缺失或损坏，先检查 index.html / embed assets，再重新执行启动恢复。",
          action: {
            kind: "manual-check",
            label: summary.delivery.staticMode === "missing" ? "补齐静态资源产物" : "检查静态资源入口",
          },
        };
      case "compile-smoke":
        return {
          id,
          phase: failure.phase,
          severity: "error",
          title: "compile smoke 未通过",
          description: "先手动执行 pnpm bun:compile 并确认 index.html 可用，再重新执行启动恢复验证交付链。",
          action: {
            kind: "manual-check",
            label: "手动执行 pnpm bun:compile",
          },
        };
      default:
        return {
          id,
          phase: failure.phase,
          severity: "warning",
          title: "启动恢复需要人工介入",
          description: failure.message,
          action: {
            kind: "manual-check",
            label: "查看启动日志",
          },
        };
    }
  });
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
export async function runStartupOrchestrator(
  state: StartupOrchestratorState,
  options: StartupOrchestratorOptions = {},
): Promise<StartupOrchestratorSummary> {
  const startedAt = new Date();
  const bookIds = await state.listBooks();
  const failures: StartupOrchestratorFailure[] = [];
  const actions: StartupOrchestratorRecoveryAction[] = [];
  let migratedBooks = 0;
  let indexSummary: SearchIndexRebuildSummary | null = null;

  if (options.projectBootstrap) {
    pushOptionalAction(
      actions,
      failures,
      {
        kind: "project-bootstrap",
        scope: "library",
        status: options.projectBootstrap.status,
        reason: options.projectBootstrap.reason,
        note: options.projectBootstrap.note,
      },
      "project-bootstrap",
    );
  }

  for (const bookId of bookIds) {
    try {
      const fallbackChapter = await resolveStartupFallbackChapter(state, bookId);
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

  if (options.staticDelivery) {
    pushOptionalAction(
      actions,
      failures,
      {
        kind: "static-delivery",
        scope: "library",
        status: options.staticDelivery.status ?? (options.staticDelivery.hasIndexHtml ? "success" : "failed"),
        reason: options.staticDelivery.reason,
        note: options.staticDelivery.note ?? `mode=${options.staticDelivery.mode}, indexHtml=${options.staticDelivery.hasIndexHtml}`,
      },
      "static-delivery",
    );
  }

  if (options.compileSmoke) {
    pushOptionalAction(
      actions,
      failures,
      {
        kind: "compile-smoke",
        scope: "library",
        status: options.compileSmoke.status,
        reason: options.compileSmoke.reason,
        note: options.compileSmoke.note,
      },
      "compile-smoke",
    );
  }

  for (const diagnostic of options.diagnostics ?? []) {
    pushOptionalAction(
      actions,
      failures,
      {
        kind: diagnostic.kind,
        scope: "library",
        status: diagnostic.status,
        reason: diagnostic.reason,
        note: diagnostic.note,
      },
      diagnostic.kind,
    );
  }

  const finishedAt = new Date();
  const counts = summarizeActions(actions);
  const delivery = buildStartupDeliverySummary(options);

  return {
    bookCount: bookIds.length,
    migratedBooks,
    indexedDocuments: indexSummary?.indexedDocuments ?? 0,
    skippedBooks: indexSummary?.skippedBooks ?? 0,
    failures,
    delivery,
    recoveryReport: {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      actions,
      counts,
    },
  };
}
