import type { StorageDatabase } from "../../storage/db.js";
import { createBibleChapterSummaryRepository } from "../../bible/repositories/chapter-summary-repo.js";
import { runFilter } from "../engine/index.js";
import { createFilterReportRepository } from "../repositories/filter-report-repo.js";
import { summarizeHitCounts } from "../engine/index.js";
import type { FilterReport } from "../types.js";

export interface ScanChapterAndStoreFilterReportInput {
  bookId: string;
  chapterNumber: number;
  text: string;
  reportId?: string;
  scannedAt?: Date;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export async function scanChapterAndStoreFilterReport(storage: StorageDatabase, input: ScanChapterAndStoreFilterReportInput): Promise<FilterReport> {
  const summaryRepo = createBibleChapterSummaryRepository(storage);
  const summary = await summaryRepo.getByChapter(input.bookId, input.chapterNumber);
  const metadata = parseJsonObject(summary?.metadataJson ?? "{}");
  const pgiUsed = Boolean(metadata.pgi_answers);
  const report = await runFilter(input.text, { bookId: input.bookId, pgiUsed });
  const reportId = input.reportId ?? crypto.randomUUID();
  const scannedAt = input.scannedAt ?? new Date();
  report.filterReportId = reportId;

  await createFilterReportRepository(storage).insert({
    id: reportId,
    bookId: input.bookId,
    chapterNumber: input.chapterNumber,
    aiTasteScore: report.aiTasteScore,
    level: report.level,
    hitCountsJson: JSON.stringify(summarizeHitCounts(report.hits)),
    zhuqueScore: report.zhuque?.score ?? null,
    zhuqueStatus: report.zhuque?.status ?? "not-configured",
    details: JSON.stringify(report),
    engineVersion: report.engineVersion,
    scannedAt,
  });

  if (summary) {
    metadata.filterReportId = reportId;
    await summaryRepo.update(input.bookId, summary.id, { metadataJson: JSON.stringify(metadata), updatedAt: scannedAt });
  }

  return report;
}
