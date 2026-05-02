import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { BookConfig, ChapterMeta, StateManager } from "@vivy1024/novelfork-core";

import { buildRuntimeModelPool } from "./runtime-model-pool.js";
import { ProviderRuntimeStore } from "./provider-runtime-store.js";

export type CockpitDataStatus = "available" | "empty" | "missing" | "unsupported";

export interface CockpitBookSummary {
  readonly id: string;
  readonly title: string;
  readonly genre?: string;
  readonly platform?: string;
  readonly status?: string;
}

export interface CockpitProgressSummary {
  readonly status: CockpitDataStatus;
  readonly chapterCount: number;
  readonly targetChapters: number | null;
  readonly totalWords: number;
  readonly approvedChapters: number;
  readonly failedChapters: number;
  readonly todayWords: number;
  readonly dailyTarget: number;
  readonly streak: number;
  readonly weeklyWords: number;
  readonly reason?: string;
}

export interface CockpitCurrentFocusSummary {
  readonly status: CockpitDataStatus;
  readonly content: string | null;
  readonly sourceFile?: string;
  readonly reason?: string;
}

export interface CockpitChapterSummaryItem {
  readonly number: number;
  readonly summary: string;
  readonly sourceFile: string;
}

export interface CockpitHookItem {
  readonly id: string;
  readonly text: string;
  readonly sourceChapter: number;
  readonly status: "open" | "payoff-due" | "expired-risk" | "resolved" | "frozen";
  readonly sourceFile: string;
  readonly sourceKind: "pending-hooks";
}

export interface CockpitCandidateItem {
  readonly id: string;
  readonly bookId: string;
  readonly title: string;
  readonly source: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly metadata?: Record<string, unknown>;
  readonly artifact: {
    readonly id: string;
    readonly kind: "candidate";
    readonly title: string;
    readonly resourceRef: { readonly kind: "candidate"; readonly id: string; readonly bookId: string; readonly title: string };
    readonly renderer: "candidate.created";
    readonly openInCanvas: true;
  };
}

export interface CockpitRiskCard {
  readonly id: string;
  readonly kind: "audit-failure" | "expired-hook" | "tone-drift";
  readonly title: string;
  readonly detail: string;
  readonly chapterNumber?: number;
  readonly navigateTo: string;
  readonly level: "warning" | "danger";
}

export interface CockpitListResult<T> {
  readonly status: CockpitDataStatus;
  readonly items: readonly T[];
  readonly reason?: string;
}

export interface CockpitModelStatus {
  readonly status: CockpitDataStatus;
  readonly hasUsableModel: boolean;
  readonly defaultProvider?: string;
  readonly defaultModel?: string;
  readonly supportsToolUse?: boolean;
  readonly reason?: string;
}

export interface CockpitSnapshot {
  readonly status: CockpitDataStatus;
  readonly book: CockpitBookSummary | null;
  readonly generatedAt: string;
  readonly progress: CockpitProgressSummary;
  readonly currentFocus: CockpitCurrentFocusSummary;
  readonly recentChapterSummaries: CockpitListResult<CockpitChapterSummaryItem>;
  readonly openHooks: CockpitListResult<CockpitHookItem>;
  readonly recentCandidates: CockpitListResult<CockpitCandidateItem>;
  readonly riskCards: CockpitListResult<CockpitRiskCard>;
  readonly modelStatus?: CockpitModelStatus;
}

export interface CockpitServiceOptions {
  readonly state: StateManager;
  readonly providerStore?: ProviderRuntimeStore;
  readonly now?: () => Date;
}

interface CandidateRecord {
  readonly id: string;
  readonly bookId?: string;
  readonly title?: string;
  readonly source?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly status?: string;
  readonly metadata?: Record<string, unknown>;
}

const DEFAULT_DAILY_TARGET = 3000;

export function createCockpitService(options: CockpitServiceOptions) {
  return new CockpitService(options);
}

export class CockpitService {
  private readonly state: StateManager;
  private readonly providerStore: ProviderRuntimeStore;
  private readonly now: () => Date;

  constructor(options: CockpitServiceOptions) {
    this.state = options.state;
    this.providerStore = options.providerStore ?? new ProviderRuntimeStore();
    this.now = options.now ?? (() => new Date());
  }

  async getSnapshot(input: { readonly bookId: string; readonly includeModelStatus?: boolean }): Promise<CockpitSnapshot> {
    const book = await this.loadBook(input.bookId);
    const generatedAt = this.now().toISOString();
    if (!book) {
      return {
        status: "missing",
        book: null,
        generatedAt,
        progress: missingProgress(),
        currentFocus: { status: "missing", content: null, reason: `Book ${input.bookId} not found` },
        recentChapterSummaries: { status: "missing", items: [], reason: `Book ${input.bookId} not found` },
        openHooks: { status: "missing", items: [], reason: `Book ${input.bookId} not found` },
        recentCandidates: { status: "missing", items: [], reason: `Book ${input.bookId} not found` },
        riskCards: { status: "missing", items: [], reason: `Book ${input.bookId} not found` },
        ...(input.includeModelStatus ? { modelStatus: await this.getModelStatus() } : {}),
      };
    }

    const [chapters, currentFocus, recentChapterSummaries, openHooks, recentCandidates] = await Promise.all([
      this.state.loadChapterIndex(input.bookId),
      this.readCurrentFocus(input.bookId),
      this.readChapterSummaries(input.bookId),
      this.listOpenHooks(input),
      this.listRecentCandidates(input),
    ]);
    const progress = buildProgress(book, chapters);
    const riskCards = buildRiskCards(chapters, openHooks.items);

    return {
      status: "available",
      book: {
        id: book.id,
        title: book.title,
        genre: book.genre,
        platform: book.platform,
        status: book.status,
      },
      generatedAt,
      progress,
      currentFocus,
      recentChapterSummaries,
      openHooks,
      recentCandidates,
      riskCards,
      ...(input.includeModelStatus ? { modelStatus: await this.getModelStatus() } : {}),
    };
  }

  async listOpenHooks(input: { readonly bookId: string; readonly limit?: number }): Promise<CockpitListResult<CockpitHookItem>> {
    const book = await this.loadBook(input.bookId);
    if (!book) {
      return { status: "missing", items: [], reason: `Book ${input.bookId} not found` };
    }
    const raw = await this.readStoryFile(input.bookId, "pending_hooks.md");
    if (!raw?.trim()) {
      return { status: "empty", items: [], reason: "pending_hooks.md 不存在或没有未回收伏笔。" };
    }

    const currentChapter = Math.max(0, ...(await this.state.loadChapterIndex(input.bookId)).map((chapter) => chapter.number));
    const items = parseOpenHooks(raw, currentChapter).slice(0, normalizeLimit(input.limit));
    return items.length > 0
      ? { status: "available", items }
      : { status: "empty", items: [], reason: "pending_hooks.md 不存在或没有未回收伏笔。" };
  }

  async listRecentCandidates(input: { readonly bookId: string; readonly limit?: number }): Promise<CockpitListResult<CockpitCandidateItem>> {
    const book = await this.loadBook(input.bookId);
    if (!book) {
      return { status: "missing", items: [], reason: `Book ${input.bookId} not found` };
    }

    const records = await this.loadCandidateRecords(input.bookId);
    const items = records
      .filter((candidate) => candidate.status === "candidate")
      .sort((left, right) => (right.updatedAt ?? right.createdAt ?? "").localeCompare(left.updatedAt ?? left.createdAt ?? ""))
      .slice(0, normalizeLimit(input.limit))
      .map((candidate) => toCandidateItem(input.bookId, candidate));

    return items.length > 0
      ? { status: "available", items }
      : { status: "empty", items: [], reason: "暂无候选稿。" };
  }

  private async loadBook(bookId: string): Promise<BookConfig | null> {
    try {
      return await this.state.loadBookConfig(bookId);
    } catch {
      return null;
    }
  }

  private async readStoryFile(bookId: string, fileName: string): Promise<string | null> {
    try {
      return await readFile(join(this.state.bookDir(bookId), "story", fileName), "utf-8");
    } catch {
      return null;
    }
  }

  private async readCurrentFocus(bookId: string): Promise<CockpitCurrentFocusSummary> {
    const content = await this.readStoryFile(bookId, "current_focus.md");
    if (!content?.trim()) {
      return { status: "missing", content: null, sourceFile: "current_focus.md", reason: "current_focus.md 不存在或为空。" };
    }
    return { status: "available", content, sourceFile: "current_focus.md" };
  }

  private async readChapterSummaries(bookId: string): Promise<CockpitListResult<CockpitChapterSummaryItem>> {
    const content = await this.readStoryFile(bookId, "chapter_summaries.md");
    if (!content?.trim()) {
      return { status: "empty", items: [], reason: "chapter_summaries.md 不存在或没有章节摘要。" };
    }
    const items = parseChapterSummaries(content).slice(-5);
    return items.length > 0
      ? { status: "available", items }
      : { status: "empty", items: [], reason: "chapter_summaries.md 不存在或没有章节摘要。" };
  }

  private async loadCandidateRecords(bookId: string): Promise<CandidateRecord[]> {
    try {
      const raw = await readFile(join(this.state.bookDir(bookId), "generated-candidates", "index.json"), "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter(isCandidateRecord) : [];
    } catch {
      return [];
    }
  }

  private async getModelStatus(): Promise<CockpitModelStatus> {
    const pool = await buildRuntimeModelPool(this.providerStore);
    const first = pool[0];
    if (!first) {
      return { status: "missing", hasUsableModel: false, reason: "未配置可用模型。" };
    }
    return {
      status: "available",
      hasUsableModel: true,
      defaultProvider: first.providerId,
      defaultModel: first.modelId.slice(`${first.providerId}:`.length),
      supportsToolUse: first.capabilities.functionCalling,
    };
  }
}

function missingProgress(): CockpitProgressSummary {
  return {
    status: "missing",
    chapterCount: 0,
    targetChapters: null,
    totalWords: 0,
    approvedChapters: 0,
    failedChapters: 0,
    todayWords: 0,
    dailyTarget: DEFAULT_DAILY_TARGET,
    streak: 0,
    weeklyWords: 0,
  };
}

function buildProgress(book: BookConfig, chapters: readonly ChapterMeta[]): CockpitProgressSummary {
  return {
    status: chapters.length > 0 ? "available" : "empty",
    chapterCount: chapters.length,
    targetChapters: book.targetChapters ?? null,
    totalWords: chapters.reduce((sum, chapter) => sum + (chapter.wordCount ?? 0), 0),
    approvedChapters: chapters.filter((chapter) => chapter.status === "approved" || chapter.status === "published").length,
    failedChapters: chapters.filter((chapter) => chapter.status === "audit-failed" || chapter.status === "rejected").length,
    todayWords: 0,
    dailyTarget: book.chapterWordCount ?? DEFAULT_DAILY_TARGET,
    streak: 0,
    weeklyWords: 0,
    ...(chapters.length === 0 ? { reason: "暂无章节。" } : {}),
  };
}

function normalizeLimit(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 10;
}

function parseChapterSummaries(content: string): CockpitChapterSummaryItem[] {
  return content.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^-\s*第\s*(\d+)\s*章[：:](.+)$/);
    if (!match) return [];
    return [{ number: Number.parseInt(match[1]!, 10), summary: match[2]!.trim(), sourceFile: "chapter_summaries.md" }];
  });
}

function parseOpenHooks(content: string, currentChapter: number): CockpitHookItem[] {
  return content.split(/\r?\n/).flatMap((line, index) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- [ ]")) return [];
    const text = trimmed.replace(/^- \[ \]\s*/, "").trim();
    if (!text) return [];
    const chapterMatch = text.match(/第\s*(\d+)\s*章/);
    const sourceChapter = chapterMatch ? Number.parseInt(chapterMatch[1]!, 10) : 0;
    return [{
      id: `pending-hook-${index + 1}`,
      text,
      sourceChapter,
      status: computeHookRisk(sourceChapter, currentChapter),
      sourceFile: "pending_hooks.md",
      sourceKind: "pending-hooks" as const,
    }];
  });
}

function computeHookRisk(sourceChapter: number, currentChapter: number, threshold = 15): CockpitHookItem["status"] {
  if (sourceChapter <= 0) return "open";
  const gap = currentChapter - sourceChapter;
  if (gap > threshold) return "expired-risk";
  if (gap > threshold * 0.7) return "payoff-due";
  return "open";
}

function buildRiskCards(chapters: readonly ChapterMeta[], hooks: readonly CockpitHookItem[]): CockpitListResult<CockpitRiskCard> {
  const cards: CockpitRiskCard[] = [];
  for (const chapter of chapters) {
    const issueCount = chapter.auditIssues?.length ?? 0;
    if (chapter.status === "audit-failed" || issueCount > 0) {
      cards.push({
        id: `audit-failure-${chapter.number}`,
        kind: "audit-failure",
        title: `第${chapter.number}章存在审计问题`,
        detail: issueCount > 0 ? `${issueCount} 个审计问题待处理。` : "章节审计未通过。",
        chapterNumber: chapter.number,
        navigateTo: `chapter:${chapter.number}`,
        level: "danger",
      });
    }
  }
  for (const hook of hooks) {
    if (hook.status === "expired-risk") {
      cards.push({
        id: `expired-hook-${hook.id}`,
        kind: "expired-hook",
        title: "伏笔长期未回收",
        detail: hook.text,
        chapterNumber: hook.sourceChapter || undefined,
        navigateTo: "story:pending_hooks.md",
        level: "warning",
      });
    }
  }
  return cards.length > 0 ? { status: "available", items: cards } : { status: "empty", items: [], reason: "暂无驾驶舱风险。" };
}

function isCandidateRecord(value: unknown): value is CandidateRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as { id?: unknown }).id === "string";
}

function toCandidateItem(bookId: string, candidate: CandidateRecord): CockpitCandidateItem {
  const title = candidate.title || candidate.id;
  return {
    id: candidate.id,
    bookId,
    title,
    source: candidate.source ?? "unknown",
    status: candidate.status ?? "candidate",
    createdAt: candidate.createdAt ?? "",
    updatedAt: candidate.updatedAt ?? candidate.createdAt ?? "",
    ...(candidate.metadata ? { metadata: candidate.metadata } : {}),
    artifact: {
      id: `candidate:${bookId}:${candidate.id}`,
      kind: "candidate",
      title,
      resourceRef: { kind: "candidate", id: candidate.id, bookId, title },
      renderer: "candidate.created",
      openInCanvas: true,
    },
  };
}
