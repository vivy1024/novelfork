import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { StorageDatabase } from "@vivy1024/novelfork-core";

import {
  authorWritingSkillsDir,
  loadWritingSkills,
  parseWritingSkill,
  writeAuthorWritingSkill,
} from "../engine/writing-skills/loader.js";
import {
  MAX_RECOMMENDED_WRITING_SKILLS,
  recommendWritingSkills,
} from "../engine/writing-skills/recommend.js";
import {
  extractGeneralSkillReferences,
  loadProjectWritingSkills,
  readProjectWritingSkillRaw,
  syncProjectWritingSkills,
} from "../engine/writing-skills/project-storage.js";
import type {
  ParsedWritingSkill,
  WritingSkillComplianceCheck,
} from "../engine/writing-skills/types.js";

export interface TrustedWritingSkillOptions {
  readonly bookRoot: string;
  readonly home?: string;
  /** 仅 `writing-skills.import_legacy` 使用；普通 Skills 读取和写作不依赖数据库。 */
  readonly storage?: StorageDatabase;
  readonly now?: () => Date;
}

export interface WritingSkillsReadInput {
  readonly bookId: string;
  readonly scope?: "available" | "enabled";
}

export interface WritingSkillsWriteInput {
  readonly bookId: string;
  /** 将 catalog Skill 文件物化到当前项目 `.novelfork/skills`。 */
  readonly addSkillIds?: readonly string[];
  /** 删除当前项目中对应 catalog Skill 的文件夹。 */
  readonly removeSkillIds?: readonly string[];
  /** 作者副本更新后，覆盖当前项目中已经存在的对应文件。 */
  readonly refreshSkillIds?: readonly string[];
}

export interface WritingSkillsCheckComplianceInput {
  readonly bookId: string;
  readonly chapterNumber?: number;
  readonly content: string;
  /** 当前 Runtime 会话已成功加载的技能证据；缺失时跳过依赖加载完整性检查。 */
  readonly loadedSkills?: readonly { readonly name: string; readonly loadedAt: string; readonly contentHash?: string }[];
}

export interface WritingSkillsRecommendInput {
  readonly bookId: string;
  readonly maxCount?: number;
}

export interface WritingSkillsImportLegacyInput {
  readonly bookId?: string;
}

export interface WritingSkillProjectReport {
  readonly migratedSlugs: readonly string[];
}

export interface WritingSkillComplianceViolation {
  readonly skillId: string;
  readonly skillName: string;
  readonly checkId: string;
  readonly rule: string;
  readonly violation: string;
  readonly severity: "warning" | "error";
  readonly explanation: string;
}

export interface LegacyWritingSkillsImportReport {
  readonly tablePresent: boolean;
  readonly created: readonly string[];
  readonly skipped: readonly string[];
  readonly conflicts: readonly { readonly id: string; readonly explanation: string }[];
  readonly invalid: readonly { readonly id: string; readonly explanation: string }[];
}

type HandlerResult = Readonly<{
  ok: boolean;
  summary: string;
  error?: string;
  data?: unknown;
}>;

type BookFile = Record<string, unknown> & {
  readonly id?: unknown;
};

type LegacyUserTemplateRow = Readonly<{
  id: string;
  name: string;
  genre: string | null;
  description: string | null;
  bundleJson: string;
}>;

function fail(error: string, summary: string, data?: unknown): HandlerResult {
  return { ok: false, error, summary, ...(data === undefined ? {} : { data }) };
}

function normalizeBookId(bookId: string): string {
  const normalized = bookId.trim();
  if (!normalized) throw new Error("bookId must not be empty.");
  return normalized;
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string")
    .map((id) => id.trim())
    .filter(Boolean))];
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
    : [];
}

function bookConfigPath(options: TrustedWritingSkillOptions): string {
  return join(options.bookRoot, "book.json");
}

async function readBookFile(bookId: string, options: TrustedWritingSkillOptions): Promise<BookFile> {
  const normalizedBookId = normalizeBookId(bookId);
  const parsed = JSON.parse(await readFile(bookConfigPath(options), "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid book.json for ${normalizedBookId}.`);
  }
  const book = parsed as BookFile;
  if (typeof book.id === "string" && book.id !== normalizedBookId) {
    throw new Error("book.json does not match the trusted book binding.");
  }
  return book;
}

async function resolveProjectWritingSkillState(
  options: TrustedWritingSkillOptions,
  skills: readonly ParsedWritingSkill[],
): Promise<{
  readonly projectSkills: readonly ParsedWritingSkill[];
  readonly projectSkillSlugs: readonly string[];
  readonly report: WritingSkillProjectReport;
}> {
  const loaded = await loadProjectWritingSkills(options.bookRoot, skills);
  return {
    projectSkills: loaded.skills,
    projectSkillSlugs: loaded.projectSkillSlugs,
    report: { migratedSlugs: loaded.migratedSlugs },
  };
}

/** 读取一书当前真正生效的 Skills；项目文件是唯一权威源。 */
export async function loadActiveWritingSkillsForBook(
  bookId: string,
  options: TrustedWritingSkillOptions,
): Promise<Readonly<{
  skills: readonly ParsedWritingSkill[];
  projectSkillSlugs: readonly string[];
  migration: WritingSkillProjectReport;
}>> {
  const normalizedBookId = normalizeBookId(bookId);
  void normalizedBookId;
  const catalog = await loadWritingSkills(options.home);
  const state = await resolveProjectWritingSkillState(options, catalog);
  const projectSlugs = new Set(state.projectSkillSlugs);
  const always = catalog.filter((skill) => skill.mode === "always" && !projectSlugs.has(skill.slug));
  return {
    skills: [...always, ...state.projectSkills],
    projectSkillSlugs: state.projectSkillSlugs,
    migration: state.report,
  };
}

function toListItem(skill: ParsedWritingSkill, projectActive: boolean) {
  return {
    id: skill.id,
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    kind: skill.kind,
    source: skill.source,
    mode: skill.mode,
    tags: skill.tags ?? [],
    version: skill.version ?? null,
    provenance: skill.provenance ?? null,
    editable: skill.source === "user",
    projectActive,
  };
}

export async function handleWritingSkillsRead(
  input: WritingSkillsReadInput,
  options: TrustedWritingSkillOptions,
): Promise<HandlerResult> {
  try {
    const bookId = normalizeBookId(input.bookId);
    const catalog = await loadWritingSkills(options.home);
    const active = await loadActiveWritingSkillsForBook(bookId, options);
    const activeSlugs = new Set(active.projectSkillSlugs);
    const catalogSlugs = new Set(catalog.map((skill) => skill.slug));
    const projectOnly = active.skills.filter((skill) => !catalogSlugs.has(skill.slug));
    const available = [...catalog, ...projectOnly];
    const projectContent = new Map(
      await Promise.all(
        active.skills
          .filter((skill) => skill.source === "project")
          .map(async (skill) => [skill.slug, await readProjectWritingSkillRaw(options.bookRoot, skill.slug)] as const),
      ),
    );
    const listItem = (skill: ParsedWritingSkill, projectActive: boolean) => ({
      ...toListItem(skill, projectActive),
      ...(projectContent.has(skill.slug) ? { content: projectContent.get(skill.slug) } : {}),
    });

    if ((input.scope ?? "available") === "enabled") {
      return {
        ok: true,
        summary: `已加载 ${active.skills.length} 个项目目录中的生效 Writing Skills。`,
        data: {
          bookId,
          projectSkillSlugs: active.projectSkillSlugs,
          projectSkillsDirectory: ".novelfork/skills",
          skills: active.skills.map((skill) => ({ ...listItem(skill, true), body: skill.body })),
          migration: active.migration,
        },
      };
    }

    return {
      ok: true,
      summary: `共 ${available.length} 个可用 Writing Skills，其中 ${active.skills.length} 个来自当前项目目录。`,
      data: {
        bookId,
        projectSkillSlugs: active.projectSkillSlugs,
        projectSkillsDirectory: ".novelfork/skills",
        skills: available.map((skill) => listItem(skill, skill.mode === "always" || activeSlugs.has(skill.slug))),
        migration: active.migration,
      },
    };
  } catch (error) {
    return fail(
      "writing-skills-read-failed",
      `Writing Skills 加载失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function handleWritingSkillsWrite(
  input: WritingSkillsWriteInput,
  options: TrustedWritingSkillOptions,
): Promise<HandlerResult> {
  try {
    const bookId = normalizeBookId(input.bookId);
    const skills = await loadWritingSkills(options.home);
    const synced = await syncProjectWritingSkills(options.bookRoot, skills, {
      addSkillIds: normalizeIds(input.addSkillIds),
      removeSkillIds: normalizeIds(input.removeSkillIds),
      refreshSkillIds: normalizeIds(input.refreshSkillIds),
    }, { home: options.home });

    return {
      ok: true,
      summary: synced.createdSlugs.length > 0 || synced.refreshedSlugs.length > 0
        ? `已更新当前项目 .novelfork/skills，当前发现 ${synced.projectSkillSlugs.length} 个项目 Writing Skills。`
        : synced.removedSlugs.length > 0
          ? `已从当前项目 .novelfork/skills 移除 ${synced.removedSlugs.length} 个 Writing Skills。`
          : `当前项目 .novelfork/skills 中发现 ${synced.projectSkillSlugs.length} 个 Writing Skills。`,
      data: {
        bookId,
        projectSkillSlugs: synced.projectSkillSlugs,
        projectSkillsDirectory: ".novelfork/skills",
        invalidIds: synced.invalidIds,
        createdSlugs: synced.createdSlugs,
        removedSlugs: synced.removedSlugs,
        refreshedSlugs: synced.refreshedSlugs,
        migratedSlugs: synced.migratedSlugs,
      },
    };
  } catch (error) {
    return fail(
      "writing-skills-write-failed",
      `Writing Skills 设置失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * 按本书已落库的建书答案推荐 Writing Skills。
 *
 * 只读：答案取自 book.json（建书十一问由 applyGuidedSetup 写入），
 * 不修改项目 Skill 文件。添加或移除必须由作者确认后走
 * `writing-skills.write`，保留 Runtime 的权限确认。
 */
export async function handleWritingSkillsRecommend(
  input: WritingSkillsRecommendInput,
  options: TrustedWritingSkillOptions,
): Promise<HandlerResult> {
  try {
    const bookId = normalizeBookId(input.bookId);
    const [book, skills] = await Promise.all([
      readBookFile(bookId, options),
      loadWritingSkills(options.home),
    ]);

    const recommendation = recommendWritingSkills({
      genre: asText(book.genre),
      tone: asText((book as { tone?: unknown }).tone),
      platform: asText(book.platform),
      complexity: asText((book as { complexity?: unknown }).complexity),
      aiTasteLevel: asText((book as { aiTasteLevel?: unknown }).aiTasteLevel),
      writingPhilosophy: asText((book as { writingPhilosophy?: unknown }).writingPhilosophy),
    }, skills);

    const limit = typeof input.maxCount === "number" && Number.isInteger(input.maxCount) && input.maxCount > 0
      ? Math.min(input.maxCount, MAX_RECOMMENDED_WRITING_SKILLS)
      : MAX_RECOMMENDED_WRITING_SKILLS;
    const recommended = recommendation.recommended.slice(0, limit);

    // 已在项目目录中的不再重复建议，避免作者看到「推荐启用一个已经存在的文件」。
    const projectState = await resolveProjectWritingSkillState(options, skills);
    const projectSlugs = new Set(projectState.projectSkillSlugs);

    return {
      ok: true,
      summary: recommended.length > 0
        ? `按本书设定推荐 ${recommended.length} 个 Writing Skills${recommendation.matchedGenreCluster ? `（题材簇：${recommendation.matchedGenreCluster}）` : ""}。这只是建议，需你确认后再用 writing-skills.write 添加到项目目录。`
        : "没有匹配到值得推荐的 Writing Skills；可在写作设置里手动挑选。",
      data: {
        bookId,
        matchedGenreCluster: recommendation.matchedGenreCluster,
        consideredCount: recommendation.consideredCount,
        droppedByConflict: recommendation.droppedByConflict,
        projectSkillSlugs: projectState.projectSkillSlugs,
        recommended: recommended.map((item) => ({ ...item, alreadyEnabled: projectSlugs.has(item.slug) })),
      },
    };
  } catch (error) {
    return fail(
      "writing-skills-recommend-failed",
      `Writing Skills 推荐失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function occurrences(content: string, term: string): number {
  if (!term) return 0;
  let count = 0;
  let index = content.indexOf(term);
  while (index >= 0) {
    count += 1;
    index = content.indexOf(term, index + term.length);
  }
  return count;
}

function checkId(check: WritingSkillComplianceCheck, index: number): string {
  return check.id?.trim() || `${check.type}-${index + 1}`;
}

function checkRule(check: WritingSkillComplianceCheck): string {
  switch (check.type) {
    case "required-terms": return `必须出现：${check.terms.join("、")}`;
    case "forbidden-terms": return `不得出现：${check.terms.join("、")}`;
    case "pattern": return `模式匹配：${check.pattern}`;
  }
}

/**
 * loader 已在解析阶段拒绝 lookaround、回溯引用与嵌套量词，因此这里只按已校验的
 * 声明编译一次；仍旧不接受 g/y，避免有状态匹配。
 */
function compilePattern(check: { readonly pattern: string; readonly flags?: string }): RegExp | null {
  try {
    return new RegExp(check.pattern, `g${(check.flags ?? "").replace(/[^im]/gu, "")}`);
  } catch {
    return null;
  }
}

/** 返回违规描述；通过检查时返回 null。 */
function evaluateCheck(content: string, check: WritingSkillComplianceCheck): string | null {
  if (check.type === "required-terms") {
    const minimum = check.minOccurrences ?? 1;
    const missing = check.terms.filter((term) => occurrences(content, term) < minimum);
    return missing.length > 0
      ? `缺少要求的词项：${missing.join("、")}${minimum > 1 ? `（每项至少 ${minimum} 次）` : ""}`
      : null;
  }
  if (check.type === "forbidden-terms") {
    const hits = check.terms.filter((term) => content.includes(term));
    return hits.length > 0 ? `命中禁止词项：${hits.join("、")}` : null;
  }
  const pattern = compilePattern(check);
  if (!pattern) return null;
  const matches = content.match(pattern) ?? [];
  const minMatches = check.minMatches ?? 1;
  if (matches.length < minMatches) {
    return `模式匹配 ${matches.length} 次，少于要求的 ${minMatches} 次`;
  }
  if (check.maxMatches !== undefined && matches.length > check.maxMatches) {
    return `模式匹配 ${matches.length} 次，超过允许的 ${check.maxMatches} 次（例如「${matches[0]?.slice(0, 120) ?? ""}」）`;
  }
  return null;
}

export async function handleWritingSkillsCheckCompliance(
  input: WritingSkillsCheckComplianceInput,
  options: TrustedWritingSkillOptions,
): Promise<HandlerResult> {
  try {
    const content = input.content.trim();
    if (!content) return fail("invalid-input", "正文不能为空，无法执行 Writing Skills 合规检查。");
    const active = await loadActiveWritingSkillsForBook(input.bookId, options);
    const violations: WritingSkillComplianceViolation[] = [];
    const loadedNames = new Set((input.loadedSkills ?? []).map((evidence) => evidence.name.trim()));
    // 依赖名必须是技能库中真实存在的技能（过滤路径/模板名噪音）。
    const knownSkillNames = new Set(active.skills.map((skill) => skill.name));
    for (const skill of active.skills) {
      const checks = skill.checks ?? [];
      for (const [index, check] of checks.entries()) {
        const violation = evaluateCheck(content, check);
        if (!violation) continue;
        const rule = checkRule(check);
        violations.push({
          skillId: skill.id,
          skillName: skill.name,
          checkId: checkId(check, index),
          rule,
          violation,
          severity: check.severity ?? "warning",
          explanation: check.message?.trim()
            || `Writing Skill「${skill.name}」声明了检查「${rule}」；当前正文不满足它，请按该 Skill 的方法调整或关闭这条 Skill。`,
        });
      }

      // 依赖加载完整性：作者显式启用的技能（mode != always）要求本体 + 直接引用的
      // 通用依赖已在当前会话加载；always 技能自动生效，不要求会话加载证据。
      // 缺失按 warning 上报（不阻断保存）。
      if (skill.mode !== "always" && input.loadedSkills !== undefined) {
        const rawDependencies = extractGeneralSkillReferences(skill.body ?? "");
        const dependencies = [...new Set(rawDependencies)]
          .filter((name) => name !== skill.name && knownSkillNames.has(name));
        const requiredNames = [skill.name, ...dependencies];
        const missing = requiredNames.filter((name) => !loadedNames.has(name));
        if (missing.length > 0) {
          violations.push({
            skillId: skill.id,
            skillName: skill.name,
            checkId: "dependency-loaded",
            rule: "技能依赖已加载",
            violation: `当前会话未加载该技能及其依赖：${missing.join("、")}。`,
            severity: "warning",
            explanation: `「${skill.name}」要求连同依赖一起加载才能生效；请先读取 ${missing.join("、")} 再重写或重跑检查。`,
          });
        }
      }
    }
    const errorCount = violations.filter((violation) => violation.severity === "error").length;
    return {
      ok: true,
      summary: errorCount > 0
        ? `Writing Skills 检出 ${violations.length} 条问题，其中 ${errorCount} 条为硬性违规。`
        : violations.length > 0
          ? `Writing Skills 检出 ${violations.length} 条提醒。`
          : "已通过当前启用 Writing Skills 的声明式检查。",
      data: {
        bookId: normalizeBookId(input.bookId),
        ...(input.chapterNumber ? { chapterNumber: input.chapterNumber } : {}),
        violations,
        checkedSkillIds: active.skills.map((skill) => skill.id),
        migration: active.migration,
      },
    };
  } catch (error) {
    return fail(
      "writing-skills-check-failed",
      `Writing Skills 合规检查失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase()
    .replace(/[^a-z0-9-_]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 96);
}

function contentHash(value: string): string {
  return createHash("sha256").update(value.replace(/\r\n/g, "\n").trim()).digest("hex");
}

function skillKindFromLegacyCategory(category: string): string {
  switch (category) {
    case "beat": return "pacing";
    case "tone":
    case "anti-ai":
    case "literary": return "prose";
    case "logic-risk": return "revision";
    case "genre":
    case "bundle": return "plot";
    default: return "workflow";
  }
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function legacyBundleBody(bundle: Record<string, unknown>): string | null {
  const prompt = asText(bundle.promptInjection) || asText(bundle.prompt);
  if (prompt) return prompt;
  if (bundle.type !== "beat-template" || !Array.isArray(bundle.beats)) return null;
  const beats = bundle.beats.map((beat, index) => {
    if (!beat || typeof beat !== "object" || Array.isArray(beat)) return null;
    const item = beat as Record<string, unknown>;
    const name = asText(item.name) || `节拍 ${index + 1}`;
    const purpose = asText(item.purpose);
    const tone = asText(item.emotionalTone);
    const ratio = typeof item.wordRatio === "number" ? `（篇幅占比 ${item.wordRatio}）` : "";
    const tip = asText(item.networkNovelTip);
    return `- ${index + 1}. ${name}${ratio}${purpose ? `：${purpose}` : ""}${tone ? `；情绪：${tone}` : ""}${tip ? `；提示：${tip}` : ""}`;
  }).filter((item): item is string => Boolean(item));
  return beats.length > 0 ? `## 章节节拍\n\n${beats.join("\n")}` : null;
}

function legacyTemplateToSkillContent(row: LegacyUserTemplateRow): { readonly slug: string; readonly content: string } | null {
  let bundle: unknown;
  try {
    bundle = JSON.parse(row.bundleJson);
  } catch {
    return null;
  }
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) return null;
  const record = bundle as Record<string, unknown>;
  const body = legacyBundleBody(record);
  if (!body) return null;
  const name = row.name.trim() || asText(record.name) || row.id;
  const description = row.description?.trim() || asText(record.description) || `从旧 user_template 导入：${name}`;
  const tags = [row.genre?.trim(), asText(record.category), "legacy-import"].filter(Boolean);
  const mode = record.mode === "always" || record.mode === "auto" ? record.mode : "manual";
  const kind = skillKindFromLegacyCategory(asText(record.category));
  const slug = normalizeSlug(`legacy-${row.id}`) || `legacy-${contentHash(row.id).slice(0, 16)}`;
  return {
    slug,
    content: [
      "---",
      `id: ${yamlString(row.id)}`,
      `name: ${yamlString(name)}`,
      `description: ${yamlString(description)}`,
      `kind: ${kind}`,
      `mode: ${mode}`,
      tags.length > 0 ? `tags: ${JSON.stringify(tags)}` : "",
      "legacyUserTemplate: true",
      "---",
      "",
      body.trim(),
      "",
    ].filter((line) => line !== "").join("\n"),
  };
}

async function authorSkillRaw(slug: string, home?: string): Promise<string | null> {
  try {
    return await readFile(join(authorWritingSkillsDir(home), slug, "SKILL.md"), "utf8");
  } catch {
    return null;
  }
}

function userTemplateTablePresent(storage: StorageDatabase): boolean {
  return Boolean(storage.sqlite
    .prepare<{ readonly name: string }>("SELECT name FROM sqlite_master WHERE type = ? AND name = ?")
    .get("table", "user_template"));
}

function listLegacyUserTemplates(storage: StorageDatabase): readonly LegacyUserTemplateRow[] {
  return storage.sqlite.prepare<LegacyUserTemplateRow>(`
    SELECT
      "id",
      "name",
      "genre",
      "description",
      "bundle_json" AS "bundleJson"
    FROM "user_template"
    WHERE "deleted_at" IS NULL
    ORDER BY "created_at" ASC
  `).all();
}

/**
 * 一次性只读迁移边界：仅显式调用时探测旧表，转换为作者 SKILL.md 后即回到文件源。
 * 不写旧表、不依赖 Repo，也不让日常 loader 读取 SQLite。
 */
export async function handleWritingSkillsImportLegacy(
  _input: WritingSkillsImportLegacyInput,
  options: TrustedWritingSkillOptions,
): Promise<HandlerResult> {
  if (!options.storage) {
    return fail("storage-unavailable", "当前运行环境没有可用的受控存储，无法检查 legacy user_template；没有修改任何文件。");
  }
  try {
    if (!userTemplateTablePresent(options.storage)) {
      const report: LegacyWritingSkillsImportReport = {
        tablePresent: false,
        created: [],
        skipped: [],
        conflicts: [],
        invalid: [],
      };
      return { ok: true, summary: "未发现 legacy user_template 表，无需导入。", data: report };
    }

    const report: {
      tablePresent: true;
      created: string[];
      skipped: string[];
      conflicts: { id: string; explanation: string }[];
      invalid: { id: string; explanation: string }[];
    } = { tablePresent: true, created: [], skipped: [], conflicts: [], invalid: [] };
    for (const row of listLegacyUserTemplates(options.storage)) {
      const generated = legacyTemplateToSkillContent(row);
      if (!generated) {
        report.invalid.push({ id: row.id, explanation: "bundle_json 不是可转换的旧 Preset/Beat bundle，未写入作者目录。" });
        continue;
      }
      const parsed = parseWritingSkill(generated.content, generated.slug, "user");
      if (!parsed) {
        report.invalid.push({ id: row.id, explanation: "转换后的 SKILL.md 无法通过解析，未写入作者目录。" });
        continue;
      }
      const existing = await authorSkillRaw(generated.slug, options.home);
      if (existing) {
        const existingParsed = parseWritingSkill(existing, generated.slug, "user");
        if (existingParsed?.id === row.id && contentHash(existing) === contentHash(generated.content)) {
          report.skipped.push(row.id);
        } else {
          report.conflicts.push({
            id: row.id,
            explanation: `作者目录已有 ${generated.slug}/SKILL.md，内容或 ID 不同；迁移不会覆盖它。`,
          });
        }
        continue;
      }
      await writeAuthorWritingSkill(generated.slug, generated.content, options.home);
      report.created.push(row.id);
    }
    return {
      ok: true,
      summary: `legacy user_template 导入完成：新建 ${report.created.length} 个，跳过 ${report.skipped.length} 个，冲突 ${report.conflicts.length} 个，无效 ${report.invalid.length} 个。`,
      data: report,
    };
  } catch (error) {
    return fail(
      "writing-skills-import-legacy-failed",
      `legacy user_template 导入失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
