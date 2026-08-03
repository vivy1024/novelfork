import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { StorageDatabase } from "@vivy1024/novelfork-core";

import {
  authorWritingSkillsDir,
  getWritingSkillRawContentSync,
  loadWritingSkills,
  parseWritingSkill,
  writeAuthorWritingSkill,
} from "../engine/writing-skills/loader.js";
import {
  MAX_RECOMMENDED_WRITING_SKILLS,
  recommendWritingSkills,
} from "../engine/writing-skills/recommend.js";
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
  readonly enabledWritingSkillIds: readonly string[];
  /** 有无法映射的 legacy ID 时，明确允许清理旧字段。默认 false，避免静默丢失。 */
  readonly discardUnmappedLegacyIds?: boolean;
}

export interface WritingSkillsCheckComplianceInput {
  readonly bookId: string;
  readonly chapterNumber?: number;
  readonly content: string;
}

export interface WritingSkillsRecommendInput {
  readonly bookId: string;
  readonly maxCount?: number;
}

export interface WritingSkillsImportLegacyInput {
  readonly bookId?: string;
}

export interface WritingSkillSelectionMigrationReport {
  readonly migratedIds: readonly string[];
  readonly unmappedLegacyIds: readonly string[];
  readonly canRemoveLegacySelection: boolean;
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
  readonly enabledWritingSkillIds?: unknown;
  readonly enabledPresetIds?: unknown;
  readonly beatTemplateId?: unknown;
  readonly customPresetOverrides?: unknown;
  readonly updatedAt?: unknown;
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

async function writeBookFile(
  bookId: string,
  options: TrustedWritingSkillOptions,
  update: (book: BookFile) => BookFile,
): Promise<BookFile> {
  const current = await readBookFile(bookId, options);
  const next = update(current);
  await writeFile(bookConfigPath(options), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function nowIso(options: TrustedWritingSkillOptions): string {
  return (options.now?.() ?? new Date()).toISOString();
}

function explicitSelection(book: BookFile): string[] {
  return normalizeIds(book.enabledWritingSkillIds);
}

function legacySelection(book: BookFile): string[] {
  const selected = normalizeIds(book.enabledPresetIds);
  const beatTemplateId = asText(book.beatTemplateId);
  return beatTemplateId ? [...new Set([...selected, beatTemplateId])] : selected;
}

/**
 * 纯映射：仅迁移已经能由当前 SKILL.md 解析出的旧选择 ID。
 * 未映射旧值绝不静默删除，命令调用方可以把报告交给作者处理。
 */
export function migrateLegacyWritingSkillSelection(
  book: BookFile,
  skills: readonly ParsedWritingSkill[],
): { readonly enabledWritingSkillIds: readonly string[]; readonly report: WritingSkillSelectionMigrationReport } {
  const knownIds = new Set(skills.map((skill) => skill.id));
  const current = explicitSelection(book).filter((id) => knownIds.has(id));
  const legacy = legacySelection(book);
  const migratedIds = legacy.filter((id) => knownIds.has(id));
  const unmappedLegacyIds = legacy.filter((id) => !knownIds.has(id));
  return {
    enabledWritingSkillIds: [...new Set([...current, ...migratedIds])],
    report: {
      migratedIds,
      unmappedLegacyIds,
      canRemoveLegacySelection: unmappedLegacyIds.length === 0,
    },
  };
}

export function resolveActiveWritingSkills(
  skills: readonly ParsedWritingSkill[],
  enabledWritingSkillIds: Iterable<string>,
): ReadonlyArray<ParsedWritingSkill> {
  const enabled = new Set(enabledWritingSkillIds);
  const explicitlySelected = skills.filter((skill) => skill.mode !== "always" && enabled.has(skill.id));
  const alwaysEnabled = skills.filter((skill) => skill.mode === "always" && !enabled.has(skill.id));
  return [...explicitlySelected, ...alwaysEnabled];
}

/** 读取一书当前真正生效的 Skills；供管线和工具复用，不读数据库。 */
export async function loadActiveWritingSkillsForBook(
  bookId: string,
  options: TrustedWritingSkillOptions,
): Promise<Readonly<{
  skills: readonly ParsedWritingSkill[];
  enabledWritingSkillIds: readonly string[];
  migration: WritingSkillSelectionMigrationReport;
}>> {
  const normalizedBookId = normalizeBookId(bookId);
  const [book, skills] = await Promise.all([
    readBookFile(normalizedBookId, options),
    loadWritingSkills(options.home),
  ]);
  const migrated = migrateLegacyWritingSkillSelection(book, skills);
  return {
    skills: resolveActiveWritingSkills(skills, migrated.enabledWritingSkillIds),
    enabledWritingSkillIds: migrated.enabledWritingSkillIds,
    migration: migrated.report,
  };
}

function toListItem(skill: ParsedWritingSkill, enabled: boolean) {
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
    enabled,
  };
}

export async function handleWritingSkillsRead(
  input: WritingSkillsReadInput,
  options: TrustedWritingSkillOptions,
): Promise<HandlerResult> {
  try {
    const bookId = normalizeBookId(input.bookId);
    const [book, skills] = await Promise.all([
      readBookFile(bookId, options),
      loadWritingSkills(options.home),
    ]);
    const migrated = migrateLegacyWritingSkillSelection(book, skills);
    const active = resolveActiveWritingSkills(skills, migrated.enabledWritingSkillIds);
    const activeIds = new Set(active.map((skill) => skill.id));

    if ((input.scope ?? "available") === "enabled") {
      return {
        ok: true,
        summary: `已加载 ${active.length} 个生效 Writing Skills。`,
        data: {
          bookId,
          enabledWritingSkillIds: migrated.enabledWritingSkillIds,
          skills: active.map((skill) => ({ ...toListItem(skill, true), body: skill.body })),
          migration: migrated.report,
        },
      };
    }

    return {
      ok: true,
      summary: `共 ${skills.length} 个可用 Writing Skills，其中 ${active.length} 个当前生效。`,
      data: {
        bookId,
        enabledWritingSkillIds: migrated.enabledWritingSkillIds,
        skills: skills.map((skill) => toListItem(skill, activeIds.has(skill.id))),
        migration: migrated.report,
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
    const [current, skills] = await Promise.all([
      readBookFile(bookId, options),
      loadWritingSkills(options.home),
    ]);
    const existingMigration = migrateLegacyWritingSkillSelection(current, skills);
    if (!existingMigration.report.canRemoveLegacySelection && input.discardUnmappedLegacyIds !== true) {
      return fail(
        "legacy-writing-skill-selection-unresolved",
        `仍有 ${existingMigration.report.unmappedLegacyIds.length} 个旧 Preset/Beat 选择无法映射到当前 SKILL.md；未修改 book.json。请先运行 writing-skills.import_legacy，或明确确认 discardUnmappedLegacyIds。`,
        { migration: existingMigration.report },
      );
    }

    const knownSelectableIds = new Set(skills.filter((skill) => skill.mode !== "always").map((skill) => skill.id));
    const requested = normalizeIds(input.enabledWritingSkillIds);
    const enabledWritingSkillIds = requested.filter((id) => knownSelectableIds.has(id));
    const invalidIds = requested.filter((id) => !knownSelectableIds.has(id));

    await writeBookFile(bookId, options, (book) => {
      const {
        enabledPresetIds: _enabledPresetIds,
        beatTemplateId: _beatTemplateId,
        customPresetOverrides: _customPresetOverrides,
        ...rest
      } = book;
      return {
        ...rest,
        enabledWritingSkillIds,
        updatedAt: nowIso(options),
      };
    });

    // 物化启用的 Writing Skills 到作品目录 .novelfork/skills/<slug>/SKILL.md，
    // 使 Runtime 项目 Skill 扫描能发现它们，且作品可独立迁移。
    const projectSkillsDir = join(options.bookRoot, ".novelfork", "skills");
    for (const skill of skills) {
      if (!enabledWritingSkillIds.includes(skill.id)) continue;
      const raw = getWritingSkillRawContentSync(skill.slug, options.home);
      if (!raw) continue;
      const skillDir = join(projectSkillsDir, skill.slug);
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, "SKILL.md"), raw, "utf8");
    }

    return {
      ok: true,
      summary: enabledWritingSkillIds.length > 0
        ? `已启用 ${enabledWritingSkillIds.length} 个 Writing Skills。`
        : "已清空书籍级 Writing Skills 选择；mode: always 的 Skills 仍会生效。",
      data: {
        bookId,
        enabledWritingSkillIds,
        invalidIds,
        migration: {
          ...existingMigration.report,
          canRemoveLegacySelection: true,
          ...(input.discardUnmappedLegacyIds ? { discardedLegacyIds: existingMigration.report.unmappedLegacyIds } : {}),
        },
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
 * 不修改 `enabledWritingSkillIds`。启用必须由作者确认后走
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

    // 已启用的不再重复建议，避免作者看到「推荐启用一个已经启用的」。
    const migrated = migrateLegacyWritingSkillSelection(book, skills);
    const enabled = new Set(migrated.enabledWritingSkillIds);

    return {
      ok: true,
      summary: recommended.length > 0
        ? `按本书设定推荐 ${recommended.length} 个 Writing Skills${recommendation.matchedGenreCluster ? `（题材簇：${recommendation.matchedGenreCluster}）` : ""}。这只是建议，需你确认后再用 writing-skills.write 启用。`
        : "没有匹配到值得推荐的 Writing Skills；可在写作设置里手动挑选。",
      data: {
        bookId,
        matchedGenreCluster: recommendation.matchedGenreCluster,
        consideredCount: recommendation.consideredCount,
        droppedByConflict: recommendation.droppedByConflict,
        enabledWritingSkillIds: migrated.enabledWritingSkillIds,
        recommended: recommended.map((item) => ({ ...item, alreadyEnabled: enabled.has(item.id) })),
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
