import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, win32 } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { load as parseYaml } from "js-yaml";
import {
  BUNDLED_WRITING_SKILLS,
  type BundledWritingSkill,
} from "./bundled-skills.generated.js";
import {
  WRITING_SKILL_KINDS,
  type ParsedWritingSkill,
  type WritingSkillComplianceCheck,
  type WritingSkillKind,
  type WritingSkillProvenance,
  type WritingSkillSource,
} from "./types.js";

// 保留既有 loader 模块的类型导出，供调用方无需调整 import 路径。
export type { ParsedWritingSkill } from "./types.js";

const WRITING_SKILL_KINDS_SET: ReadonlySet<string> = new Set(WRITING_SKILL_KINDS);
const MAX_CHECK_PATTERN_LENGTH = 256;
const MAX_CHECK_OCCURRENCES = 10_000;

function resolveBuiltinWritingSkillsDir(): string {
  const moduleDir = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
  return join(moduleDir, "../../../../skills");
}

/** 内置 SKILL.md 的唯一磁盘根目录。 */
export const BUILTIN_WRITING_SKILLS_DIR = resolveBuiltinWritingSkillsDir();

/** 作者级 SKILL.md 目录；内置文件永远不会在这里被批量复制。 */
export function authorWritingSkillsDir(home = homedir()): string {
  return join(home, ".novelfork", "skills");
}

function isSafeWritingSkillSlug(value: string): boolean {
  return Boolean(value)
    && value === value.trim()
    && value !== "."
    && value !== ".."
    && !value.includes("\0")
    && !value.includes("/")
    && !value.includes("\\")
    && !value.includes(":")
    && !isAbsolute(value)
    && !win32.isAbsolute(value)
    && win32.basename(value) === value;
}

function skillFile(dir: string, slug: string): string | null {
  return isSafeWritingSkillSlug(slug) ? join(dir, slug, "SKILL.md") : null;
}

function requireSafeWritingSkillSlug(slug: string): void {
  if (!isSafeWritingSkillSlug(slug)) {
    throw new TypeError("Writing Skill slug 必须是单个安全目录名。");
  }
}

async function tryReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function tryReadFileSync(path: string | null): string | null {
  if (!path) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function listSkillSlugsSync(dir: string): ReadonlyArray<string> {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isSafeWritingSkillSlug(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): ReadonlyArray<string> | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
  return values.length > 0 ? values : undefined;
}

function asBoundedCount(value: unknown): number | undefined {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 0
    && value <= MAX_CHECK_OCCURRENCES
    ? value
    : undefined;
}

function parseProvenance(value: unknown): WritingSkillProvenance | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const repo = asString(record.repo);
  if (!repo) return undefined;
  return {
    repo,
    license: asString(record.license) || "UNSPECIFIED",
    ...(asString(record.upstreamPath) ? { upstreamPath: asString(record.upstreamPath) } : {}),
  };
}

function readProvenanceSync(dir: string, slug: string): WritingSkillProvenance | undefined {
  const raw = tryReadFileSync(
    isSafeWritingSkillSlug(slug) ? join(dir, slug, "_source.json") : null,
  );
  if (!raw) return undefined;
  try {
    return parseProvenance(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

/**
 * 仅接受无需回溯的模式，避免未来合规执行器把作者前置数据编译为高风险正则。
 * 当前解析器不会执行正则；不安全或无法编译的声明会被忽略而非降级执行。
 */
function isSafeCompliancePattern(pattern: string): boolean {
  if (!pattern || pattern.length > MAX_CHECK_PATTERN_LENGTH) return false;
  if (pattern.includes("(?") || /\\[1-9]/.test(pattern)) return false;
  if (/(?:\([^()]{0,128}[+*][^()]{0,128}\)|\[[^\]]{1,128}\])[+*{]/.test(pattern)) return false;
  if (/(?:[+*?]|\{\d+(?:,\d*)?\})\s*(?:[+*?]|\{)/.test(pattern)) return false;
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

function parseComplianceChecks(value: unknown): ReadonlyArray<WritingSkillComplianceCheck> | undefined {
  if (!Array.isArray(value)) return undefined;
  const checks: WritingSkillComplianceCheck[] = [];

  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const record = candidate as Record<string, unknown>;
    const type = asString(record.type);
    const id = asString(record.id);
    const message = asString(record.message);
    const severity = asString(record.severity) === "error" ? "error" as const : undefined;
    const common = {
      ...(id ? { id } : {}),
      ...(message ? { message } : {}),
      ...(severity ? { severity } : {}),
    };

    if (type === "required-terms") {
      const terms = asStringArray(record.terms);
      if (!terms) continue;
      const minOccurrences = asBoundedCount(record.minOccurrences);
      checks.push({
        type,
        terms,
        ...common,
        ...(minOccurrences !== undefined ? { minOccurrences } : {}),
      });
      continue;
    }

    if (type === "forbidden-terms") {
      const terms = asStringArray(record.terms);
      if (terms) checks.push({ type, terms, ...common });
      continue;
    }

    if (type === "pattern") {
      const pattern = asString(record.pattern);
      const flags = asString(record.flags);
      if (!isSafeCompliancePattern(pattern) || !["", "i", "m", "im"].includes(flags)) continue;
      const minMatches = asBoundedCount(record.minMatches);
      const maxMatches = asBoundedCount(record.maxMatches);
      if (minMatches !== undefined && maxMatches !== undefined && minMatches > maxMatches) continue;
      checks.push({
        type,
        pattern,
        ...common,
        ...(flags ? { flags: flags as "i" | "m" | "im" } : {}),
        ...(minMatches !== undefined ? { minMatches } : {}),
        ...(maxMatches !== undefined ? { maxMatches } : {}),
      });
    }
  }

  return checks.length > 0 ? checks : undefined;
}

/** 解析 `---` 包裹的 YAML frontmatter 与 Markdown 正文。 */
export function splitFrontmatter(raw: string): { data: unknown; body: string } | null {
  const normalized = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return null;
  const end = normalized.indexOf("\n---", 3);
  if (end < 0) return null;
  try {
    return {
      data: parseYaml(normalized.slice(4, end)),
      body: normalized.slice(end + 4).replace(/^\n/, ""),
    };
  } catch {
    return null;
  }
}

/** 将单份 SKILL.md 解析为瞬态 Writing Skill DTO。 */
export function parseWritingSkill(
  raw: string,
  slug: string,
  source: WritingSkillSource,
): ParsedWritingSkill | null {
  if (!isSafeWritingSkillSlug(slug)) return null;
  const parsed = splitFrontmatter(raw);
  if (!parsed || !parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) return null;
  const frontmatter = parsed.data as Record<string, unknown>;
  const name = asString(frontmatter.name);
  const description = asString(frontmatter.description);
  const body = parsed.body.trim();
  if (!name || !description || !body) return null;

  const rawKind = asString(frontmatter.kind);
  const kind: WritingSkillKind = WRITING_SKILL_KINDS_SET.has(rawKind)
    ? rawKind as WritingSkillKind
    : "workflow";
  const rawMode = asString(frontmatter.mode);
  const mode = rawMode === "always" || rawMode === "auto" ? rawMode : "manual";

  return {
    id: asString(frontmatter.id) || `writing-skill-${slug}`,
    slug,
    name,
    description,
    kind,
    body,
    source,
    mode,
    ...(asStringArray(frontmatter.compatibleGenres) ? { compatibleGenres: asStringArray(frontmatter.compatibleGenres) } : {}),
    ...(asStringArray(frontmatter.tags) ? { tags: asStringArray(frontmatter.tags) } : {}),
    ...(asString(frontmatter.conflictGroup) ? { conflictGroup: asString(frontmatter.conflictGroup) } : {}),
    ...(asString(frontmatter.author) ? { author: asString(frontmatter.author) } : {}),
    ...(asString(frontmatter.version) ? { version: asString(frontmatter.version) } : {}),
    ...(asStringArray(frontmatter.references) ? { references: asStringArray(frontmatter.references) } : {}),
    ...(parseComplianceChecks(frontmatter.checks) ? { checks: parseComplianceChecks(frontmatter.checks) } : {}),
    ...(parseProvenance(frontmatter.provenance) ? { provenance: parseProvenance(frontmatter.provenance) } : {}),
  };
}

function loadWritingSkillsFromSources(home?: string): ReadonlyArray<ParsedWritingSkill> {
  const bySlug = new Map<string, ParsedWritingSkill>();

  const addBundle = (entries: ReadonlyArray<BundledWritingSkill>): void => {
    for (const entry of entries) {
      const parsed = parseWritingSkill(entry.content, entry.slug, "builtin");
      if (!parsed) continue;
      bySlug.set(entry.slug, {
        ...parsed,
        ...(entry.provenance ? { provenance: entry.provenance } : {}),
      });
    }
  };

  // 编译态使用单一内联快照；开发态的唯一 builtin root 覆盖同 slug 快照。
  addBundle(BUNDLED_WRITING_SKILLS);
  for (const slug of listSkillSlugsSync(BUILTIN_WRITING_SKILLS_DIR)) {
    const raw = tryReadFileSync(skillFile(BUILTIN_WRITING_SKILLS_DIR, slug));
    const parsed = raw ? parseWritingSkill(raw, slug, "builtin") : null;
    if (parsed) {
      bySlug.set(slug, {
        ...parsed,
        ...(readProvenanceSync(BUILTIN_WRITING_SKILLS_DIR, slug)
          ? { provenance: readProvenanceSync(BUILTIN_WRITING_SKILLS_DIR, slug) }
          : {}),
      });
    }
  }

  // 作者目录最后加载，同 slug 始终覆盖内置内容。
  const authorDir = authorWritingSkillsDir(home);
  for (const slug of listSkillSlugsSync(authorDir)) {
    const raw = tryReadFileSync(skillFile(authorDir, slug));
    const parsed = raw ? parseWritingSkill(raw, slug, "user") : null;
    if (parsed) bySlug.set(slug, parsed);
  }

  return [...bySlug.values()].sort((left, right) => left.id.localeCompare(right.id));
}

/** 每次调用重新解析开发态磁盘或 bundled snapshot；没有跨调用缓存。 */
export function loadWritingSkillsSync(home?: string): ReadonlyArray<ParsedWritingSkill> {
  return loadWritingSkillsFromSources(home);
}

export async function loadWritingSkills(home?: string): Promise<ReadonlyArray<ParsedWritingSkill>> {
  return loadWritingSkillsFromSources(home);
}

function isDirectorySync(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** 返回当前 catalog skill 的原始来源目录，供项目物化时递归复制附件。 */
export function getWritingSkillSourceDirSync(slug: string, home?: string): string | null {
  if (!isSafeWritingSkillSlug(slug)) return null;
  const authorDir = join(authorWritingSkillsDir(home), slug);
  if (isDirectorySync(authorDir) && tryReadFileSync(skillFile(authorWritingSkillsDir(home), slug))) {
    return authorDir;
  }

  const builtinDir = join(BUILTIN_WRITING_SKILLS_DIR, slug);
  if (isDirectorySync(builtinDir) && tryReadFileSync(skillFile(BUILTIN_WRITING_SKILLS_DIR, slug))) {
    return builtinDir;
  }

  // 编译态 bundled snapshot 没有可复制的附件目录，调用方应回退为单文件写入。
  return null;
}

export function getWritingSkillRawContentSync(slug: string, home?: string): string | null {
  if (!isSafeWritingSkillSlug(slug)) return null;
  const sourceDir = getWritingSkillSourceDirSync(slug, home);
  const fromSource = sourceDir ? tryReadFileSync(join(sourceDir, "SKILL.md")) : null;
  if (fromSource) return fromSource;

  return BUNDLED_WRITING_SKILLS.find((entry) => entry.slug === slug)?.content ?? null;
}

export async function forkWritingSkillForEditing(slug: string, home?: string): Promise<string | null> {
  if (!isSafeWritingSkillSlug(slug)) return null;
  const targetDir = join(authorWritingSkillsDir(home), slug);
  const targetFile = join(targetDir, "SKILL.md");
  if (await tryReadFile(targetFile)) return targetFile;

  const raw = getWritingSkillRawContentSync(slug, home);
  if (!raw) return null;
  await mkdir(targetDir, { recursive: true });
  await writeFile(targetFile, raw, "utf8");
  return targetFile;
}

export async function writeAuthorWritingSkill(
  slug: string,
  content: string,
  home?: string,
): Promise<string> {
  requireSafeWritingSkillSlug(slug);
  const dir = join(authorWritingSkillsDir(home), slug);
  const file = join(dir, "SKILL.md");
  await mkdir(dir, { recursive: true });
  await writeFile(file, content, "utf8");
  return file;
}

export async function removeAuthorWritingSkill(slug: string, home?: string): Promise<boolean> {
  if (!isSafeWritingSkillSlug(slug)) return false;
  try {
    await rm(join(authorWritingSkillsDir(home), slug), { recursive: true, force: false });
    return true;
  } catch {
    return false;
  }
}
