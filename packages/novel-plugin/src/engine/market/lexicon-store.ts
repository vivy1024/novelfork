/**
 * 题材词库 — 让「分类匹配」可配置。
 *
 * ~/.novelfork/market/market-lexicon.json 格式：
 * { "aliases": { "标准类目": ["别名1", "别名2"], ... } }
 *
 * 匹配规则（recordMatchesContext 三段式）：
 *   1. 标准类目精确命中；
 *   2. 别名命中（自定义词库里的任一同义词）；
 *   3. 子串兜底（保留旧行为，但只在没有任何精确/别名命中时才用）。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { marketConfigDir, type MarketRankRegistryOptions } from "./rank-registry.js";

export interface MarketLexicon {
  readonly aliases: Readonly<Record<string, readonly string[]>>;
}

/** 平台词库默认项：与前端题材栅格保持同一口径，用户可以在此基础上加自己的别名。 */
export const DEFAULT_MARKET_LEXICON: MarketLexicon = {
  aliases: {
    都市: ["都市", "都市生活", "都市高武", "都市异能"],
    玄幻: ["玄幻", "玄幻小说", "异世大陆", "东方玄幻"],
    仙侠: ["仙侠", "修真", "修仙", "幻想修仙", "古典仙侠"],
    悬疑: ["悬疑", "悬疑惊悚", "诡秘悬疑", "侦探推理"],
    历史: ["历史", "历史小说", "架空历史", "秦汉三国", "两宋元明"],
    游戏: ["游戏", "游戏小说", "虚拟网游", "电子竞技", "游戏异界"],
    科幻: ["科幻", "科幻小说", "末世危机", "星际文明"],
    轻小说: ["轻小说", "轻小说·衍生同人", "青春日常"],
    短篇: ["短篇", "短篇小说", "短故事"],
    现言: ["现言", "现代言情"],
    古言: ["古言", "古代言情"],
    豪门: ["豪门总裁", "豪门世家"],
    幻想: ["幻想言情"],
  },
};

function lexiconFilePath(rootDir?: string): string {
  return join(marketConfigDir(rootDir), "market-lexicon.json");
}

export async function loadMarketLexicon(options: MarketRankRegistryOptions = {}): Promise<MarketLexicon> {
  try {
    const raw = JSON.parse(await readFile(lexiconFilePath(options.rootDir), "utf8")) as unknown;
    const aliases = (raw as { aliases?: unknown } | null)?.aliases;
    if (!aliases || typeof aliases !== "object") return DEFAULT_MARKET_LEXICON;
    const normalized: Record<string, string[]> = {};
    for (const [canonical, values] of Object.entries(aliases as Record<string, unknown>)) {
      if (!canonical.trim()) continue;
      const list = Array.isArray(values)
        ? values.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
        : [];
      normalized[canonical.trim()] = list.length > 0 ? [...new Set([canonical.trim(), ...list])] : [canonical.trim()];
    }
    return { aliases: normalized };
  } catch {
    return DEFAULT_MARKET_LEXICON;
  }
}

/** 用户 PUT 的 lexicon 与默认值合并后整表覆盖；前端应提交完整 aliases，避免清掉已有自定义类目。 */
export async function saveMarketLexicon(input: unknown, options: MarketRankRegistryOptions = {}): Promise<MarketLexicon> {
  const user = input && typeof input === "object" && typeof (input as { aliases?: unknown }).aliases === "object"
    ? input as { aliases: Record<string, unknown> }
    : { aliases: {} };
  const merged: Record<string, string[]> = {};
  for (const [canonical, defaultAliases] of Object.entries(DEFAULT_MARKET_LEXICON.aliases)) {
    merged[canonical] = [...new Set([canonical, ...defaultAliases])];
  }
  for (const [canonical, values] of Object.entries(user.aliases)) {
    if (!canonical.trim() || !Array.isArray(values)) continue;
    const key = canonical.trim();
    const userAliases = values.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean);
    // 用户提交了该类目就以提交列表为准（可删别名）；没提交的内置类目保持默认，避免一次 PUT 把词库清空。
    merged[key] = [...new Set([key, ...userAliases])];
  }
  const lexicon: MarketLexicon = { aliases: merged };
  const dir = marketConfigDir(options.rootDir);
  await mkdir(dir, { recursive: true });
  await writeFile(lexiconFilePath(options.rootDir), `${JSON.stringify(lexicon, null, 2)}\n`, "utf8");
  return lexicon;
}

/** 把用户输入的查询词展开成「精确集 + 别名集」两类。 */
export function expandQueryTerms(categories: readonly string[], lexicon: MarketLexicon): { exact: string[]; alias: string[] } {
  const exact = new Set<string>();
  const alias = new Set<string>();
  for (const category of categories) {
    const term = category.trim();
    if (!term) continue;
    exact.add(term);
    for (const aliases of Object.values(lexicon.aliases)) {
      if (aliases.includes(term)) {
        for (const sibling of aliases) alias.add(sibling);
      }
    }
  }
  for (const term of exact) alias.delete(term);
  return { exact: [...exact], alias: [...alias] };
}

export type CategoryMatchLevel = "exact" | "alias" | "fuzzy" | "none";

export function matchCategoryAgainstTerms(recordCategory: string, terms: readonly string[]): CategoryMatchLevel {
  const category = recordCategory.trim();
  if (!category || terms.length === 0) return "none";
  for (const term of terms) {
    if (category === term.trim()) return "exact";
  }
  for (const term of terms) {
    const t = term.trim();
    if (t && (category.includes(t) || t.includes(category))) return "fuzzy";
  }
  return "none";
}

export function recordMatchesContext(recordCategory: string, categories: readonly string[], lexicon: MarketLexicon): boolean {
  if (categories.length === 0) return true;
  const { exact, alias } = expandQueryTerms(categories, lexicon);
  if (matchCategoryAgainstTerms(recordCategory, exact) === "exact") return true;
  if (alias.length > 0 && matchCategoryAgainstTerms(recordCategory, alias) === "exact") return true;
  return matchCategoryAgainstTerms(recordCategory, [...exact, ...alias]) === "fuzzy";
}
