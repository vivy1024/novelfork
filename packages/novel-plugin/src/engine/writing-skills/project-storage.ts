import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  getWritingSkillRawContentSync,
  getWritingSkillSourceDirSync,
  parseWritingSkill,
} from "./loader.js";
import type { ParsedWritingSkill } from "./types.js";

/** NovelFork 作品项目 Skill 的唯一 canonical 目录。Runtime 会自动扫描这里。 */
export const PROJECT_WRITING_SKILLS_RELATIVE_DIR = join(".novelfork", "skills");

/** v3.3.2 之前错误物化到 Runtime 通用目录的 Writing Skill 路径。只迁移已知 catalog slug。 */
export const LEGACY_PROJECT_WRITING_SKILLS_RELATIVE_DIR = join(".narrafork", "skills");

export interface ProjectWritingSkillSelection {
  readonly projectSkillSlugs: readonly string[];
  readonly legacyWritingSkillSlugs: readonly string[];
}

export interface ProjectWritingSkillChanges {
  readonly addSkillIds?: readonly string[];
  readonly removeSkillIds?: readonly string[];
  readonly refreshSkillIds?: readonly string[];
}

export interface SyncProjectWritingSkillsOptions {
  readonly home?: string;
}

export interface SyncProjectWritingSkillsResult {
  readonly projectSkillSlugs: readonly string[];
  readonly invalidIds: readonly string[];
  readonly createdSlugs: readonly string[];
  readonly removedSlugs: readonly string[];
  readonly refreshedSlugs: readonly string[];
  readonly migratedSlugs: readonly string[];
}

export interface LoadProjectWritingSkillsResult {
  readonly skills: readonly ParsedWritingSkill[];
  readonly projectSkillSlugs: readonly string[];
  readonly migratedSlugs: readonly string[];
}

function isSafeSkillSlug(value: string): boolean {
  return Boolean(value)
    && value === value.trim()
    && value !== "."
    && value !== ".."
    && !value.includes("\0")
    && !value.includes("/")
    && !value.includes("\\")
    && !value.includes(":");
}

export function projectWritingSkillsDir(bookRoot: string): string {
  return join(bookRoot, PROJECT_WRITING_SKILLS_RELATIVE_DIR);
}

export function legacyProjectWritingSkillsDir(bookRoot: string): string {
  return join(bookRoot, LEGACY_PROJECT_WRITING_SKILLS_RELATIVE_DIR);
}

export function projectWritingSkillDir(bookRoot: string, slug: string): string | null {
  return isSafeSkillSlug(slug) ? join(projectWritingSkillsDir(bookRoot), slug) : null;
}

export function projectWritingSkillFile(bookRoot: string, slug: string): string | null {
  const dir = projectWritingSkillDir(bookRoot, slug);
  return dir ? join(dir, "SKILL.md") : null;
}

function legacyProjectWritingSkillDir(bookRoot: string, slug: string): string | null {
  return isSafeSkillSlug(slug) ? join(legacyProjectWritingSkillsDir(bookRoot), slug) : null;
}

function legacyProjectWritingSkillFile(bookRoot: string, slug: string): string | null {
  const dir = legacyProjectWritingSkillDir(bookRoot, slug);
  return dir ? join(dir, "SKILL.md") : null;
}

async function pathIsFile(path: string | null): Promise<boolean> {
  if (!path) return false;
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function listSkillSlugs(root: string): Promise<Set<string>> {
  const result = new Set<string>();
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return result;
  }

  await Promise.all(entries.map(async (entry) => {
    if (!entry.isDirectory() || !isSafeSkillSlug(entry.name)) return;
    if (await pathIsFile(join(root, entry.name, "SKILL.md"))) result.add(entry.name);
  }));
  return result;
}

async function removeSkillDir(path: string | null): Promise<void> {
  if (!path) return;
  await rm(path, { recursive: true, force: true });
}

async function moveLegacySkillToCanonical(bookRoot: string, slug: string): Promise<boolean> {
  const canonicalDir = projectWritingSkillDir(bookRoot, slug);
  const legacyDir = legacyProjectWritingSkillDir(bookRoot, slug);
  if (!canonicalDir || !legacyDir) return false;
  if (!(await pathIsFile(legacyProjectWritingSkillFile(bookRoot, slug)))) return false;

  if (await pathIsFile(projectWritingSkillFile(bookRoot, slug))) {
    await removeSkillDir(legacyDir);
    return true;
  }

  await mkdir(projectWritingSkillsDir(bookRoot), { recursive: true });
  try {
    await rename(legacyDir, canonicalDir);
  } catch {
    await cp(legacyDir, canonicalDir, { recursive: true, force: false });
    await removeSkillDir(legacyDir);
  }
  return true;
}

/** 只迁移本产品 catalog 已知的旧物化目录，不碰其它 Runtime project skills。 */
export async function migrateLegacyProjectWritingSkills(
  bookRoot: string,
  skills: readonly ParsedWritingSkill[],
): Promise<readonly string[]> {
  const migrated: string[] = [];
  for (const skill of skills) {
    if (await moveLegacySkillToCanonical(bookRoot, skill.slug)) migrated.push(skill.slug);
  }
  return migrated;
}

export async function readProjectWritingSkillSelection(bookRoot: string): Promise<ProjectWritingSkillSelection> {
  const [canonical, legacy] = await Promise.all([
    listSkillSlugs(projectWritingSkillsDir(bookRoot)),
    listSkillSlugs(legacyProjectWritingSkillsDir(bookRoot)),
  ]);
  return {
    projectSkillSlugs: [...canonical],
    legacyWritingSkillSlugs: [...legacy],
  };
}

export async function readProjectWritingSkillRaw(bookRoot: string, slug: string): Promise<string | null> {
  const canonical = projectWritingSkillFile(bookRoot, slug);
  const legacy = legacyProjectWritingSkillFile(bookRoot, slug);
  if (await pathIsFile(canonical)) return readFile(canonical!, "utf8");
  if (await pathIsFile(legacy)) return readFile(legacy!, "utf8");
  return null;
}

/**
 * 用项目副本覆盖 catalog skill 的正文与项目级声明；项目文件是实际生效内容。
 * catalog 仅提供没有项目副本时的可用候选和元数据。
 */
export async function loadProjectWritingSkill(
  bookRoot: string,
  skill: ParsedWritingSkill,
): Promise<ParsedWritingSkill | null> {
  const raw = await readProjectWritingSkillRaw(bookRoot, skill.slug);
  if (!raw) return null;
  const parsed = parseWritingSkill(raw, skill.slug, "project");
  if (!parsed) return null;
  return {
    ...skill,
    ...parsed,
    id: skill.id,
    slug: skill.slug,
    source: "project",
    provenance: parsed.provenance ?? skill.provenance,
  };
}

/** 扫描当前作品 `.novelfork/skills`，项目文件不要求先存在于 catalog。 */
export async function loadProjectWritingSkills(
  bookRoot: string,
  catalogSkills: readonly ParsedWritingSkill[] = [],
): Promise<LoadProjectWritingSkillsResult> {
  const migratedSlugs = await migrateLegacyProjectWritingSkills(bookRoot, catalogSkills);
  const slugs = await listSkillSlugs(projectWritingSkillsDir(bookRoot));
  const skills: ParsedWritingSkill[] = [];
  const catalogBySlug = new Map(catalogSkills.map((skill) => [skill.slug, skill]));

  for (const slug of slugs) {
    const raw = await readFile(join(projectWritingSkillsDir(bookRoot), slug, "SKILL.md"), "utf8").catch(() => null);
    if (!raw) continue;
    const parsed = parseWritingSkill(raw, slug, "project");
    if (!parsed) continue;
    const catalog = catalogBySlug.get(slug);
    skills.push(catalog
      ? {
          ...catalog,
          ...parsed,
          id: catalog.id,
          slug,
          source: "project",
          provenance: parsed.provenance ?? catalog.provenance,
        }
      : parsed);
  }

  return {
    skills,
    projectSkillSlugs: [...slugs],
    migratedSlugs,
  };
}

async function materializeCatalogSkill(
  bookRoot: string,
  skill: ParsedWritingSkill,
  home?: string,
): Promise<void> {
  const canonicalDir = projectWritingSkillDir(bookRoot, skill.slug);
  const canonicalFile = projectWritingSkillFile(bookRoot, skill.slug);
  if (!canonicalDir || !canonicalFile) return;
  const sourceDir = getWritingSkillSourceDirSync(skill.slug, home);
  if (sourceDir) {
    // 内置/作者 Skill 可能带 references、templates 等附件，必须完整递归物化。
    await cp(sourceDir, canonicalDir, { recursive: true, force: true });
    return;
  }

  const raw = getWritingSkillRawContentSync(skill.slug, home);
  if (!raw) throw new Error(`无法读取 Writing Skill「${skill.slug}」的 SKILL.md 原文。`);
  await mkdir(canonicalDir, { recursive: true });
  await writeFile(canonicalFile, raw, "utf8");
}

/**
 * 对项目目录执行文件操作。当前磁盘内容是基线，add/remove/refresh 只修改指定 catalog Skill，
 * 不会用一份“启用列表”覆盖或删除其它项目 Skill。
 */
export async function syncProjectWritingSkills(
  bookRoot: string,
  skills: readonly ParsedWritingSkill[],
  changes: ProjectWritingSkillChanges,
  options: SyncProjectWritingSkillsOptions = {},
): Promise<SyncProjectWritingSkillsResult> {
  const selectable = skills.filter((skill) => skill.mode !== "always");
  const byId = new Map(selectable.map((skill) => [skill.id, skill]));
  const addIds = [...new Set((changes.addSkillIds ?? []).map((id) => id.trim()).filter(Boolean))];
  const removeIds = [...new Set((changes.removeSkillIds ?? []).map((id) => id.trim()).filter(Boolean))];
  const refreshIds = [...new Set((changes.refreshSkillIds ?? []).map((id) => id.trim()).filter(Boolean))];
  const requestedIds = [...new Set([...addIds, ...removeIds, ...refreshIds])];
  const invalidIds = requestedIds.filter((id) => !byId.has(id));
  const createdSlugs: string[] = [];
  const removedSlugs: string[] = [];
  const refreshedSlugs: string[] = [];
  const migratedSlugs = [...await migrateLegacyProjectWritingSkills(bookRoot, selectable)];

  for (const id of removeIds) {
    const skill = byId.get(id);
    if (!skill) continue;
    const canonicalFile = projectWritingSkillFile(bookRoot, skill.slug);
    const legacyFile = legacyProjectWritingSkillFile(bookRoot, skill.slug);
    if (await pathIsFile(canonicalFile) || await pathIsFile(legacyFile)) {
      await removeSkillDir(projectWritingSkillDir(bookRoot, skill.slug));
      await removeSkillDir(legacyProjectWritingSkillDir(bookRoot, skill.slug));
      removedSlugs.push(skill.slug);
    }
  }

  for (const id of addIds) {
    const skill = byId.get(id);
    if (!skill) continue;
    const canonicalFile = projectWritingSkillFile(bookRoot, skill.slug);
    if (await pathIsFile(canonicalFile)) continue;
    await mkdir(projectWritingSkillsDir(bookRoot), { recursive: true });
    await materializeCatalogSkill(bookRoot, skill, options.home);
    createdSlugs.push(skill.slug);
  }

  for (const id of refreshIds) {
    const skill = byId.get(id);
    if (!skill) continue;
    const canonicalFile = projectWritingSkillFile(bookRoot, skill.slug);
    if (!(await pathIsFile(canonicalFile))) continue;
    await removeSkillDir(projectWritingSkillDir(bookRoot, skill.slug));
    await materializeCatalogSkill(bookRoot, skill, options.home);
    refreshedSlugs.push(skill.slug);
  }

  const projectSkillSlugs = [...await listSkillSlugs(projectWritingSkillsDir(bookRoot))];
  return {
    projectSkillSlugs,
    invalidIds,
    createdSlugs,
    removedSlugs,
    refreshedSlugs,
    migratedSlugs: [...new Set(migratedSlugs)],
  };
}
