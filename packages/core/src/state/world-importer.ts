/**
 * World Importer — batch extract structured world entries from Markdown files.
 *
 * Reads a directory of Markdown worldbuilding docs (e.g., 文字修仙's 60+ design files),
 * uses LLM to extract structured entities, and imports them into MemoryDB world_entries.
 *
 * Supports two modes:
 *   1. LLM-assisted: sends markdown to LLM for structured extraction
 *   2. Heuristic: parses ## headers as entries without LLM
 */

import { readFile, readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import type { MemoryDB, WorldEntry } from "../state/memory-db.js";

export interface ImportSource {
  readonly path: string;
  readonly dimension?: string;
}

export interface ImportResult {
  readonly file: string;
  readonly dimension: string;
  readonly entriesImported: number;
  readonly errors: ReadonlyArray<string>;
}

export interface WorldImportSummary {
  readonly totalFiles: number;
  readonly totalEntries: number;
  readonly results: ReadonlyArray<ImportResult>;
}

// --- Heuristic parser ---

interface ParsedSection {
  readonly name: string;
  readonly content: string;
  readonly keywords: ReadonlyArray<string>;
}

/**
 * Parse a Markdown file into sections based on ## headers.
 * Each ## header becomes an entry name, content until next header is the body.
 */
export function parseMarkdownSections(content: string): ReadonlyArray<ParsedSection> {
  const sections: ParsedSection[] = [];
  const lines = content.split("\n");
  let current: { name: string; lines: string[] } | null = null;

  for (const line of lines) {
    const headerMatch = line.match(/^#{2,3}\s+(.+)/);
    if (headerMatch) {
      if (current) {
        sections.push(buildSection(current));
      }
      current = { name: headerMatch[1]!.trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) {
    sections.push(buildSection(current));
  }
  return sections;
}

function buildSection(raw: { name: string; lines: string[] }): ParsedSection {
  const body = raw.lines.join("\n").trim();
  const keywords = extractKeywordsFromSection(raw.name, body);
  return { name: raw.name, content: body, keywords };
}

/**
 * Extract keywords from section name and body.
 * Picks Chinese terms (2-6 chars) and capitalized English words.
 */
function extractKeywordsFromSection(name: string, body: string): ReadonlyArray<string> {
  const kw = new Set<string>();
  // The section name itself is always a keyword
  kw.add(name);

  // Extract parenthetical aliases: "萧云（主角）" → "萧云", "主角"
  const aliasMatch = name.match(/^(.+?)[（(](.+?)[）)]$/);
  if (aliasMatch) {
    kw.add(aliasMatch[1]!.trim());
    kw.add(aliasMatch[2]!.trim());
  }

  // Extract Chinese terms from first 500 chars of body
  const sample = body.slice(0, 500);
  const chinesePattern = /[\u4e00-\u9fff]{2,4}/g;
  let count = 0;
  for (const match of sample.matchAll(chinesePattern)) {
    if (count >= 10) break;
    kw.add(match[0]);
    count++;
  }

  return [...kw];
}

/**
 * Infer dimension from filename or directory name.
 */
export function inferDimension(filePath: string): string {
  const name = basename(filePath, ".md").toLowerCase();
  const dimensionMap: Record<string, string> = {
    "characters": "characters", "角色": "characters", "人物": "characters",
    "factions": "factions", "势力": "factions", "门派": "factions", "组织": "factions",
    "items": "items", "道具": "items", "法宝": "items", "装备": "items",
    "timeline": "timeline", "时间线": "timeline", "大事记": "timeline",
    "geography": "geography", "地理": "geography", "地图": "geography", "地点": "geography",
    "physics": "physics", "规则": "physics", "体系": "physics", "修炼": "physics",
    "economy": "economy", "经济": "economy", "货币": "economy",
    "materials": "materials", "灵材": "materials", "材料": "materials", "配方": "materials",
  };

  for (const [key, dim] of Object.entries(dimensionMap)) {
    if (name.includes(key)) return dim;
  }
  return "characters"; // default dimension
}

/**
 * Import a single Markdown file into the world database (heuristic mode).
 */
export function importMarkdownFile(
  db: MemoryDB,
  content: string,
  dimension: string,
  fileName: string,
): ImportResult {
  const sections = parseMarkdownSections(content);
  const errors: string[] = [];
  let imported = 0;

  for (const section of sections) {
    if (section.content.length < 5) {
      errors.push(`Skipped "${section.name}": content too short`);
      continue;
    }
    try {
      db.addWorldEntry({
        dimension,
        name: section.name,
        keywords: section.keywords.join(","),
        content: section.content.slice(0, 2000),
        priority: 100,
        enabled: true,
        sourceChapter: null,
      });
      imported++;
    } catch (e) {
      errors.push(`Failed to import "${section.name}": ${e}`);
    }
  }

  return { file: fileName, dimension, entriesImported: imported, errors };
}

/**
 * Batch import all Markdown files from a directory.
 */
export async function importWorldbuildingDirectory(
  db: MemoryDB,
  dirPath: string,
  options?: { readonly defaultDimension?: string },
): Promise<WorldImportSummary> {
  const files = await readdir(dirPath);
  const mdFiles = files.filter((f) => f.endsWith(".md"));
  const results: ImportResult[] = [];
  let totalEntries = 0;

  for (const file of mdFiles) {
    const content = await readFile(join(dirPath, file), "utf-8");
    const dimension = options?.defaultDimension ?? inferDimension(file);
    const result = importMarkdownFile(db, content, dimension, file);
    results.push(result);
    totalEntries += result.entriesImported;
  }

  return { totalFiles: mdFiles.length, totalEntries, results };
}
