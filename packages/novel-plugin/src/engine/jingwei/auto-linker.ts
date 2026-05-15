/**
 * 自动链接引擎 — 扫描章节文本中出现的经纬条目标题和别名
 */
import { getStorageDatabase } from "@vivy1024/novelfork-core/storage";
import { createStoryJingweiEntryRepository } from "./repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "./repositories/section-repo.js";

export interface LinkResult {
  entryId: string;
  title: string;
  matchedText: string;
}

/**
 * 扫描 content 中出现的条目标题和别名，返回匹配到的条目列表
 */
export async function linkChapterToEntries(
  bookId: string,
  _chapterNumber: number,
  content: string,
): Promise<LinkResult[]> {
  const storage = getStorageDatabase();
  const entryRepo = createStoryJingweiEntryRepository(storage);
  const sectionRepo = createStoryJingweiSectionRepository(storage);

  // 获取所有启用 AI 的 sections，提取 id 列表
  const sections = await sectionRepo.listEnabledForAi(bookId);
  const sectionIds = sections.map((s) => s.id);
  if (sectionIds.length === 0) return [];

  // 获取所有 participatesInAi=true 的条目
  const entries = await entryRepo.listForAi(bookId, sectionIds);
  const normalizedContent = content.toLowerCase();
  const results: LinkResult[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    const candidates = [entry.title, ...entry.aliases];
    for (const candidate of candidates) {
      if (!candidate?.trim()) continue;
      if (normalizedContent.includes(candidate.toLowerCase())) {
        results.push({ entryId: entry.id, title: entry.title, matchedText: candidate });
        seen.add(entry.id);
        break;
      }
    }
  }

  return results;
}
