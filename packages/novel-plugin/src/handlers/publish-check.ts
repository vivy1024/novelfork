/**
 * publish.check — 平台发布向自检（敏感词 / AI 率 / 格式 / 连续性）。
 *
 * 包装 engine/compliance 的 checkPublishReadiness；平台由书籍 platform 或显式入参解析。
 * 默认只报告；是否阻断保存由调用方（pipeline.write）按 profile 决定。
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { checkPublishReadiness, type PublishReadinessChapterInput } from "../engine/compliance/publish-readiness.js";
import type { PublishReadinessReport, SupportedPlatform } from "../engine/compliance/types.js";
import {
  checkPlatformChapterTarget,
  getPlatformProfile,
  isSupportedPlatform,
  resolvePublishPlatform,
  type PlatformProfile,
  type PlatformTargetCheck,
} from "../engine/platform/platform-profile.js";
import { handleChapterRead } from "./chapter-read.js";

export interface PublishCheckInput {
  readonly bookId: string;
  readonly bookRoot: string;
  /** 覆盖平台；缺省用 book.json platform 映射 */
  readonly platform?: string;
  /** 只查单章；缺省查全书已有章节 */
  readonly chapterNumber?: number;
  readonly fromChapter?: number;
  readonly toChapter?: number;
  /** 直接给正文（单章场景，避免重复读盘） */
  readonly content?: string;
  readonly aiTasteScore?: number;
  readonly storage?: StorageDatabase;
}

export interface PublishCheckResult {
  readonly ok: boolean;
  readonly bookId: string;
  readonly platform: SupportedPlatform;
  readonly platformLabel: string;
  readonly profile: PlatformProfile;
  readonly chapterTarget: PlatformTargetCheck | null;
  readonly report: PublishReadinessReport | null;
  readonly status: "ready" | "has-warnings" | "blocked" | "skipped";
  readonly blockCount: number;
  readonly warnCount: number;
  readonly suggestCount: number;
  readonly checkedChapters: number;
  readonly notes: readonly string[];
  readonly summary: string;
  readonly error?: string;
}

interface BookMeta {
  readonly platform?: unknown;
  readonly publishPlatform?: unknown;
  readonly title?: unknown;
  readonly chapterWordCount?: unknown;
}

async function readBookMeta(bookRoot: string): Promise<BookMeta> {
  try {
    const raw = await readFile(join(bookRoot, "book.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? parsed as BookMeta : {};
  } catch {
    return {};
  }
}

async function readChapterIndexNumbers(bookRoot: string): Promise<number[]> {
  try {
    const raw = await readFile(join(bookRoot, "chapters", "index.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed
        .map((entry) => Number((entry as { number?: unknown }).number))
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((left, right) => left - right)
      : [];
  } catch {
    return [];
  }
}

export async function handlePublishCheck(input: PublishCheckInput): Promise<PublishCheckResult> {
  const bookId = typeof input.bookId === "string" ? input.bookId.trim() : "";
  const meta = input.bookRoot ? await readBookMeta(input.bookRoot) : {};
  const platform: SupportedPlatform = isSupportedPlatform(input.platform)
    ? input.platform
    : resolvePublishPlatform(meta);
  const profile = getPlatformProfile(platform);

  const base = {
    bookId,
    platform,
    platformLabel: profile.label,
    profile,
    chapterTarget: null as PlatformTargetCheck | null,
    report: null as PublishReadinessReport | null,
    blockCount: 0,
    warnCount: 0,
    suggestCount: 0,
    checkedChapters: 0,
    notes: profile.notes,
  };

  if (!bookId) {
    return { ...base, ok: false, status: "skipped", summary: "缺少 bookId。", error: "missing-book-id" };
  }
  if (!input.bookRoot?.trim()) {
    return { ...base, ok: false, status: "skipped", summary: "缺少可信 bookRoot。", error: "missing-book-root" };
  }

  const chapterWordCount = Number(meta.chapterWordCount);
  const chapterTarget = Number.isFinite(chapterWordCount) && chapterWordCount > 0
    ? checkPlatformChapterTarget({ profile, chapterWordCount })
    : null;

  const chapters: PublishReadinessChapterInput[] = [];
  if (typeof input.chapterNumber === "number" && input.chapterNumber > 0 && typeof input.content === "string") {
    chapters.push({
      chapterNumber: Math.trunc(input.chapterNumber),
      title: `第${Math.trunc(input.chapterNumber)}章`,
      content: input.content,
      ...(typeof input.aiTasteScore === "number" ? { aiTasteScore: input.aiTasteScore } : {}),
    });
  } else {
    const all = await readChapterIndexNumbers(input.bookRoot);
    const single = typeof input.chapterNumber === "number" && input.chapterNumber > 0
      ? [Math.trunc(input.chapterNumber)]
      : all;
    const from = typeof input.fromChapter === "number" ? Math.trunc(input.fromChapter) : undefined;
    const to = typeof input.toChapter === "number" ? Math.trunc(input.toChapter) : undefined;
    const targets = single
      .filter((number) => (from === undefined || number >= from) && (to === undefined || number <= to))
      .slice(0, 300);

    for (const number of targets) {
      const read = await handleChapterRead(
        { bookId, chapterNumber: number },
        undefined,
        { bookRoot: input.bookRoot, storage: input.storage },
      );
      if (!read.ok || !read.data?.content?.trim()) continue;
      chapters.push({
        chapterNumber: number,
        title: `第${number}章`,
        content: read.data.content,
      });
    }
  }

  if (chapters.length === 0) {
    return {
      ...base,
      ok: true,
      chapterTarget,
      status: "skipped",
      summary: `${profile.label}：范围内没有可检查的正文。`,
    };
  }

  const report = checkPublishReadiness(bookId, platform, chapters, {
    ...(typeof meta.title === "string" ? { title: meta.title } : {}),
  });

  const status = report.status;
  const summaryParts = [
    `${profile.label} 发布自检：${status === "ready" ? "通过" : status === "has-warnings" ? "有提醒" : "存在阻断项"}`,
    `检查 ${chapters.length} 章`,
    `block ${report.totalBlockCount} / warn ${report.totalWarnCount} / suggest ${report.totalSuggestCount}`,
  ];
  if (chapterTarget?.message) summaryParts.push(chapterTarget.message);

  return {
    ok: true,
    bookId,
    platform,
    platformLabel: profile.label,
    profile,
    chapterTarget,
    report,
    status,
    blockCount: report.totalBlockCount,
    warnCount: report.totalWarnCount,
    suggestCount: report.totalSuggestCount,
    checkedChapters: chapters.length,
    notes: profile.notes,
    summary: summaryParts.join("；"),
  };
}
