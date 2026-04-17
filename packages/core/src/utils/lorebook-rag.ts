/**
 * Lorebook RAG (Retrieval-Augmented Generation)
 * 基于 NER 实体抽取的关键词匹配检索，支持优先级排序和 token 预算控制
 */

import type { Entity } from "./ner-extractor.js";
import type { MemoryDB, WorldEntry } from "../state/memory-db.js";

export interface LorebookEntry {
  readonly id?: number;
  readonly dimension: string;
  readonly name: string;
  readonly keywords: string;
  readonly content: string;
  readonly priority: number;
  readonly enabled: boolean;
  readonly sourceChapter: number | null;
}

export interface RetrievalOptions {
  readonly tokenBudget: number; // 最多 2000 tokens
  readonly minPriority?: number; // 最低优先级过滤
}

/**
 * 估算文本的 token 数量
 * 简单规则：中文字符 * 2 + 英文单词 * 1
 */
function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
  return chineseChars * 2 + englishWords;
}

/**
 * 从实体列表提取关键词
 */
function extractKeywords(entities: ReadonlyArray<Entity>): ReadonlyArray<string> {
  return entities.map((e) => e.text);
}

/**
 * 检索 Lorebook 词条
 *
 * 流程：
 * 1. 从 entities 提取关键词
 * 2. 查询 world_entries 表（enabled = 1）
 * 3. 按 priority DESC 排序
 * 4. 按 token 预算裁剪
 *
 * @param entities NER 提取的实体列表
 * @param memoryDb 内存数据库实例
 * @param options 检索选项（token 预算、最低优先级）
 * @returns 匹配的词条列表（按优先级降序）
 */
export async function retrieveLorebookEntries(
  entities: ReadonlyArray<Entity>,
  memoryDb: MemoryDB,
  options: RetrievalOptions,
): Promise<ReadonlyArray<LorebookEntry>> {
  // 1. 提取关键词
  const keywords = extractKeywords(entities);
  if (keywords.length === 0) {
    return [];
  }

  // 2. 查询匹配的词条
  const matchedEntries = memoryDb.findEntriesByKeywords(keywords);

  // 3. 过滤最低优先级
  const filtered = options.minPriority !== undefined
    ? matchedEntries.filter((e) => e.priority >= options.minPriority!)
    : matchedEntries;

  // 4. 按优先级降序排序（已在 MemoryDB 中排序，但这里确保）
  const sorted = [...filtered].sort((a, b) => b.priority - a.priority);

  // 5. 按 token 预算裁剪
  const result: WorldEntry[] = [];
  let totalTokens = 0;

  for (const entry of sorted) {
    const entryTokens = estimateTokens(entry.content);
    if (totalTokens + entryTokens <= options.tokenBudget) {
      result.push(entry);
      totalTokens += entryTokens;
    } else {
      // 预算用尽，停止添加
      break;
    }
  }

  return result;
}

/**
 * 格式化词条为上下文字符串
 * 用于注入到 LLM prompt 中
 */
export function formatLorebookContext(entries: ReadonlyArray<LorebookEntry>): string {
  if (entries.length === 0) {
    return "";
  }

  const sections = entries.map((entry) => {
    return `## ${entry.name} (${entry.dimension})\n${entry.content}`;
  });

  return `# 世界设定\n\n${sections.join("\n\n")}`;
}
