import type {
  JingweiPriorityTier,
  JingweiReadCategory,
  JingweiVisibilityRule,
} from "../types.js";
import { resolveJingweiReadCategory, isJingweiReadCategory } from "./category-map.js";

export interface JingweiImportChunk {
  readonly title: string;
  readonly contentMd: string;
  readonly category?: string;
  readonly aliases?: readonly string[];
  readonly tags?: readonly string[];
  readonly visibility?: "global" | "tracked" | "nested";
  readonly priorityTier?: JingweiPriorityTier;
  readonly relatedEntryIds?: readonly string[];
}

export interface JingweiImportCandidate {
  readonly title: string;
  readonly contentMd: string;
  readonly summaryMd: string;
  readonly category: JingweiReadCategory;
  readonly aliases: string[];
  readonly tags: string[];
  readonly visibilityRule: JingweiVisibilityRule;
  readonly priorityTier: JingweiPriorityTier;
  readonly relatedEntryIds: string[];
  readonly originalTokens: number;
  readonly summaryTokens: number;
}

export interface JingweiImportReport {
  readonly totalChunks: number;
  readonly createdCount: number;
  readonly updatedCount: number;
  readonly byCategory: Array<{ category: string; count: number }>;
  readonly unclassified: Array<{ title: string; reason: string }>;
  readonly duplicates: Array<{ title: string; existingEntryId: string }>;
  readonly summarizedLongEntries: Array<{ title: string; originalTokens: number; summaryTokens: number }>;
  readonly warnings: string[];
}

function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length * 0.6);
}

function excerptForSummary(text: string, maxChars = 240): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

function inferCategory(chunk: JingweiImportChunk): JingweiReadCategory {
  if (chunk.category && isJingweiReadCategory(chunk.category)) {
    return chunk.category;
  }

  const text = `${chunk.title} ${chunk.contentMd.slice(0, 500)} ${(chunk.tags ?? []).join(" ")}`.toLowerCase();

  if (/前提|premise|logline|核心卖点|主线承诺/.test(text)) return "premise";
  if (/世界观|world.?model|世界规则|力量体系|修炼体系|境界划分/.test(text)) return "world-model";
  if (/角色|人物|character|主角|配角|反派/.test(text)) return "characters";
  if (/关系|relationship|情感|师徒|仇敌/.test(text)) return "relationships";
  if (/势力|faction|宗门|组织|阵营|帮派/.test(text)) return "factions";
  if (/地点|location|geography|地图|场景|区域/.test(text)) return "locations";
  if (/能力|power|cultivation|功法|等级|丹药|灵材/.test(text)) return "power-system";
  if (/时间线|timeline|历史|纪年|大事件/.test(text)) return "timeline";
  if (/章节摘要|chapter.?summary|第\d+章/.test(text)) return "chapter-summaries";
  if (/伏笔|foreshadow|hook|悬念|线索/.test(text)) return "foreshadowing";
  if (/矛盾|conflict|冲突|对抗|stakes/.test(text)) return "conflicts";
  if (/道具|prop|item|物品|资源|法宝/.test(text)) return "props";
  if (/规则|rule|taboo|禁忌|文风|风格/.test(text)) return "rules";

  return "unclassified";
}

function inferPriorityTier(category: JingweiReadCategory, chunk: JingweiImportChunk): JingweiPriorityTier {
  if (chunk.priorityTier && chunk.priorityTier !== "auto") return chunk.priorityTier;
  if (category === "premise" || category === "world-model") return "core";
  if (category === "characters" || category === "foreshadowing" || category === "conflicts") return "relevant";
  if (category === "reference" || category === "unclassified") return "reference";
  return "auto";
}

function inferVisibility(category: JingweiReadCategory, chunk: JingweiImportChunk): JingweiVisibilityRule {
  if (chunk.visibility) return { type: chunk.visibility };
  if (category === "premise" || category === "world-model" || category === "rules") return { type: "global" };
  if (category === "chapter-summaries") return { type: "global" };
  return { type: "tracked" };
}

function inferAliases(chunk: JingweiImportChunk): string[] {
  if (chunk.aliases && chunk.aliases.length > 0) return [...chunk.aliases];

  const titleMatch = chunk.title.match(/[（(](.+?)[）)]/);
  if (titleMatch) {
    return titleMatch[1]!.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function inferTags(chunk: JingweiImportChunk, category: JingweiReadCategory): string[] {
  const tags = chunk.tags ? [...chunk.tags] : [];
  if (!tags.includes(category) && category !== "unclassified") {
    tags.push(category);
  }
  return tags;
}

export function classifyImportChunks(chunks: readonly JingweiImportChunk[]): JingweiImportCandidate[] {
  return chunks.map((chunk) => {
    const category = inferCategory(chunk);
    const priorityTier = inferPriorityTier(category, chunk);
    const visibilityRule = inferVisibility(category, chunk);
    const aliases = inferAliases(chunk);
    const tags = inferTags(chunk, category);
    const originalTokens = estimateTokens(chunk.contentMd);
    const summaryMd = excerptForSummary(chunk.contentMd);
    const summaryTokens = estimateTokens(summaryMd);

    return {
      title: chunk.title,
      contentMd: chunk.contentMd,
      summaryMd,
      category,
      aliases,
      tags,
      visibilityRule,
      priorityTier,
      relatedEntryIds: chunk.relatedEntryIds ? [...chunk.relatedEntryIds] : [],
      originalTokens,
      summaryTokens,
    };
  });
}

export function buildImportReport(
  candidates: readonly JingweiImportCandidate[],
  existingTitles: ReadonlySet<string>,
): JingweiImportReport {
  const byCategory = new Map<string, number>();
  const unclassified: JingweiImportReport["unclassified"] = [];
  const duplicates: JingweiImportReport["duplicates"] = [];
  const summarizedLongEntries: JingweiImportReport["summarizedLongEntries"] = [];
  const warnings: string[] = [];
  let createdCount = 0;
  let updatedCount = 0;

  for (const candidate of candidates) {
    byCategory.set(candidate.category, (byCategory.get(candidate.category) ?? 0) + 1);

    if (candidate.category === "unclassified") {
      unclassified.push({ title: candidate.title, reason: "无法自动归类，需人工确认" });
    }

    if (existingTitles.has(candidate.title)) {
      duplicates.push({ title: candidate.title, existingEntryId: "" });
      updatedCount += 1;
    } else {
      createdCount += 1;
    }

    if (candidate.originalTokens > 300 && candidate.summaryTokens < candidate.originalTokens) {
      summarizedLongEntries.push({
        title: candidate.title,
        originalTokens: candidate.originalTokens,
        summaryTokens: candidate.summaryTokens,
      });
    }
  }

  if (unclassified.length > 0) {
    warnings.push(`${unclassified.length} 条内容无法自动分类，已归入 unclassified。`);
  }
  if (duplicates.length > 0) {
    warnings.push(`${duplicates.length} 条与已有条目标题重复，将执行更新。`);
  }
  if (summarizedLongEntries.length > 0) {
    warnings.push(`${summarizedLongEntries.length} 条内容过长，已自动生成短摘要。`);
  }

  return {
    totalChunks: candidates.length,
    createdCount,
    updatedCount,
    byCategory: [...byCategory.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    unclassified,
    duplicates,
    summarizedLongEntries,
    warnings,
  };
}
