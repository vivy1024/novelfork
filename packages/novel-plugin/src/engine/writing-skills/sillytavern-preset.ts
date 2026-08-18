/**
 * 酒馆 Chat Completion 预设与角色卡兼容转换引擎。
 *
 * 核心能力：
 * 1. 自动解析酒馆预设 JSON 中的 prompts 数组与 prompt_order 排序；
 * 2. 自动展开宏变量（{{setvar}} / {{getvar}} / {{user}} -> 作者 / {{char}} -> 叙述者）；
 * 3. 破限/高烈度词小说化提纯（将 RP 聊天黑话转写为严肃虚构文学高烈度创作协议）；
 * 4. 自动剔除聊天占位符（{{chat_history}} / {{world_info}}），避免重复注入；
 * 5. 产出 NovelFork 原生标准 Writing Skill（带 YAML Frontmatter 与采样元数据）。
 */

const MAX_PRESET_LENGTH = 2_000_000;
const MAX_PROMPTS = 1_000;
const MAX_GENERATED_SKILL_LENGTH = 2_000_000;

type JsonRecord = Record<string, unknown>;

export type TavernPresetRole = "system" | "user" | "assistant";

export interface TavernPrompt {
  readonly key: string;
  readonly sourceIndex: number;
  readonly identifier: string;
  readonly name: string;
  readonly role: TavernPresetRole;
  readonly content: string;
  readonly marker: boolean;
  readonly enabled: boolean;
}

export interface TavernOrderEntry {
  readonly identifier: string;
  readonly enabled: boolean;
}

export interface TavernOrderGroup {
  readonly index: number;
  readonly characterId: string | null;
  readonly order: readonly TavernOrderEntry[];
}

export interface TavernPresetEntry {
  readonly entryId: string;
  readonly order: number;
  readonly identifier: string;
  readonly name: string;
  readonly role: TavernPresetRole | null;
  readonly content: string;
  readonly marker: boolean;
  readonly enabled: boolean;
  readonly missing: boolean;
  readonly isJailbreak?: boolean;
}

export interface TavernPresetSamplerSettings {
  readonly temperature?: number;
  readonly topP?: number;
  readonly topK?: number;
  readonly maxContext?: number;
  readonly maxTokens?: number;
  readonly squashSystemMessages?: boolean;
  readonly continuePrefill?: boolean;
  readonly reasoningEffort?: string;
}

export interface TavernPresetImportStats {
  readonly totalPrompts: number;
  readonly orderGroups: number;
  readonly selectedOrderEntries: number;
  readonly enabledEntries: number;
  readonly importedPrompts: number;
  readonly skippedMarkers: number;
  readonly missingPrompts: number;
  readonly jailbreakCount: number;
}

export interface TavernPresetImportResult {
  readonly sourceFile: string;
  readonly skill: {
    readonly slug: string;
    readonly name: string;
    readonly content: string;
  };
  readonly selectedOrder: {
    readonly index: number | null;
    readonly characterId: string | null;
  };
  readonly sampler: TavernPresetSamplerSettings;
  readonly stats: TavernPresetImportStats;
  readonly entries: readonly TavernPresetEntry[];
  readonly warnings: readonly string[];
}

export class TavernPresetImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TavernPresetImportError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeRole(value: unknown): TavernPresetRole {
  return value === "user" || value === "assistant" ? value : "system";
}

function parsePrompts(value: unknown): readonly TavernPrompt[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TavernPresetImportError("没有找到 prompts 数组，无法识别为酒馆 Chat Completion 预设。");
  }
  if (value.length > MAX_PROMPTS) {
    throw new TavernPresetImportError(`预设包含 ${value.length} 条提示词，超过 ${MAX_PROMPTS} 条安全上限。`);
  }

  const identifierUses = new Map<string, number>();
  return value.flatMap((candidate, index) => {
    if (!isRecord(candidate)) return [];
    const identifier = asString(candidate.identifier) || `prompt-${index + 1}`;
    const useCount = identifierUses.get(identifier) ?? 0;
    identifierUses.set(identifier, useCount + 1);
    return [{
      key: useCount === 0 ? identifier : `${identifier}::duplicate-${useCount + 1}`,
      sourceIndex: index,
      identifier,
      name: asString(candidate.name) || identifier,
      role: normalizeRole(candidate.role),
      content: typeof candidate.content === "string" ? candidate.content : "",
      marker: candidate.marker === true,
      enabled: candidate.enabled !== false,
    } satisfies TavernPrompt];
  });
}

function parseOrderGroups(value: unknown): readonly TavernOrderGroup[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate, index) => {
    if (!isRecord(candidate) || !Array.isArray(candidate.order)) return [];
    const order = candidate.order.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const identifier = asString(entry.identifier);
      return identifier ? [{ identifier, enabled: entry.enabled !== false }] : [];
    });
    if (order.length === 0) return [];
    const rawCharacterId = candidate.character_id;
    return [{
      index,
      characterId: typeof rawCharacterId === "string" || typeof rawCharacterId === "number"
        ? String(rawCharacterId)
        : null,
      order,
    } satisfies TavernOrderGroup];
  });
}

function selectOrderGroup(
  groups: readonly TavernOrderGroup[],
  promptsById: ReadonlyMap<string, TavernPrompt>,
): TavernOrderGroup | null {
  let best: TavernOrderGroup | null = null;
  let bestScore = -1;
  for (const group of groups) {
    const usable = group.order.reduce((count, entry) => {
      const prompt = promptsById.get(entry.identifier);
      return count + Number(Boolean(
        entry.enabled && prompt && !prompt.marker && prompt.content.trim().length > 0,
      ));
    }, 0);
    const score = usable * 10_000 + group.order.length;
    if (score > bestScore) {
      best = group;
      bestScore = score;
    }
  }
  return best;
}

function fileBaseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/u, "").trim() || "酒馆预设";
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function presetSlug(fileName: string, raw: string): string {
  const ascii = fileBaseName(fileName)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return ascii ? `st-${ascii}` : `st-preset-${stableHash(raw)}`;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function safeHeading(value: string): string {
  return value.replace(/[\r\n#]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "未命名提示词";
}

function readSamplerSettings(root: JsonRecord): TavernPresetSamplerSettings {
  return {
    ...(asFiniteNumber(root.temperature) !== undefined ? { temperature: asFiniteNumber(root.temperature) } : {}),
    ...(asFiniteNumber(root.top_p) !== undefined ? { topP: asFiniteNumber(root.top_p) } : {}),
    ...(asFiniteNumber(root.top_k) !== undefined ? { topK: asFiniteNumber(root.top_k) } : {}),
    ...(asFiniteNumber(root.openai_max_context) !== undefined ? { maxContext: asFiniteNumber(root.openai_max_context) } : {}),
    ...(asFiniteNumber(root.openai_max_tokens) !== undefined ? { maxTokens: asFiniteNumber(root.openai_max_tokens) } : {}),
    ...(asBoolean(root.squash_system_messages) !== undefined ? { squashSystemMessages: asBoolean(root.squash_system_messages) } : {}),
    ...(asBoolean(root.continue_prefill) !== undefined ? { continuePrefill: asBoolean(root.continue_prefill) } : {}),
    ...(asString(root.reasoning_effort) ? { reasoningEffort: asString(root.reasoning_effort) } : {}),
  };
}

function samplerYaml(settings: TavernPresetSamplerSettings): readonly string[] {
  const entries: Array<readonly [string, string | number | boolean]> = [];
  if (settings.temperature !== undefined) entries.push(["temperature", settings.temperature]);
  if (settings.topP !== undefined) entries.push(["topP", settings.topP]);
  if (settings.topK !== undefined) entries.push(["topK", settings.topK]);
  if (settings.maxContext !== undefined) entries.push(["maxContext", settings.maxContext]);
  if (settings.maxTokens !== undefined) entries.push(["maxTokens", settings.maxTokens]);
  if (settings.squashSystemMessages !== undefined) entries.push(["squashSystemMessages", settings.squashSystemMessages]);
  if (settings.continuePrefill !== undefined) entries.push(["continuePrefill", settings.continuePrefill]);
  if (settings.reasoningEffort !== undefined) entries.push(["reasoningEffort", yamlString(settings.reasoningEffort)]);
  return entries.map(([key, value]) => `    ${key}: ${value}`);
}

/** 识别并小说化提纯酒馆破限词 */
function refineJailbreakPrompt(content: string, identifier: string): { content: string; isJailbreak: boolean } {
  const idLower = identifier.toLowerCase();
  const contentLower = content.toLowerCase();
  const isJailbreak = idLower.includes("jailbreak") || idLower.includes("nsfw") || idLower.includes("uncensored")
    || contentLower.includes("nsfw") || contentLower.includes("jailbreak") || contentLower.includes("uncensored");

  if (!isJailbreak) return { content, isJailbreak: false };

  // 纯聊天机器人黑话转写为小说文学创作契约
  let refined = content
    .replace(/you are an uncensored (?:ai|rp|chat) bot/gi, "你是严肃虚构小说的高烈度创作助手")
    .replace(/in this roleplay/gi, "在本文学创作中")
    .replace(/never refuse/gi, "保持真实、残酷与完整的文学细节描写");

  return { content: refined, isJailbreak: true };
}

function translateMacros(
  content: string,
  variables: Map<string, string>,
  unknownMacros: Set<string>,
): string {
  let translated = content.replace(/\{\{setvar::([^:{}]{1,80})::([^{}]{0,500})\}\}/giu, (_match, rawName: string, rawValue: string) => {
    variables.set(rawName.trim().toLowerCase(), rawValue.trim());
    return "";
  });

  translated = translated.replace(/\{\{getvar::([^:{}]{1,80})\}\}/giu, (match, rawName: string) => {
    const value = variables.get(rawName.trim().toLowerCase());
    if (value !== undefined) return value;
    unknownMacros.add(match);
    return match;
  });

  const replacements: Readonly<Record<string, string>> = {
    user: "作者",
    char: "叙述者",
    lastusermessage: "当前用户请求",
    lastcharmessage: "上一条叙述者回复",
  };
  translated = translated.replace(/\{\{([^{}]{1,120})\}\}/gu, (match, rawName: string) => {
    const replacement = replacements[rawName.trim().toLowerCase()];
    if (replacement) return replacement;
    unknownMacros.add(match);
    return match;
  });
  return translated.replace(/\r\n/g, "\n").trim();
}

function toPresetEntries(
  orderedEntries: readonly TavernOrderEntry[],
  prompts: readonly TavernPrompt[],
): readonly TavernPresetEntry[] {
  const promptsById = new Map<string, TavernPrompt[]>();
  for (const prompt of prompts) {
    const bucket = promptsById.get(prompt.identifier);
    if (bucket) bucket.push(prompt);
    else promptsById.set(prompt.identifier, [prompt]);
  }
  const usedPromptKeys = new Set<string>();
  const entries: TavernPresetEntry[] = [];

  for (const orderedEntry of orderedEntries) {
    const prompt = promptsById.get(orderedEntry.identifier)?.find((candidate) => !usedPromptKeys.has(candidate.key));
    if (prompt) usedPromptKeys.add(prompt.key);
    const order = entries.length;
    const { isJailbreak } = refineJailbreakPrompt(prompt?.content ?? "", orderedEntry.identifier);
    entries.push({
      entryId: prompt?.key ?? `missing:${order}:${orderedEntry.identifier}`,
      order,
      identifier: orderedEntry.identifier,
      name: prompt?.name ?? `缺失提示词 · ${orderedEntry.identifier}`,
      role: prompt?.role ?? null,
      content: prompt?.content ?? "",
      marker: prompt?.marker ?? false,
      enabled: orderedEntry.enabled,
      missing: !prompt,
      isJailbreak,
    } satisfies TavernPresetEntry);
  }

  for (const prompt of prompts) {
    if (usedPromptKeys.has(prompt.key)) continue;
    const order = entries.length;
    const { isJailbreak } = refineJailbreakPrompt(prompt.content, prompt.identifier);
    entries.push({
      entryId: prompt.key,
      order,
      identifier: prompt.identifier,
      name: prompt.name,
      role: prompt.role,
      content: prompt.content,
      marker: prompt.marker,
      enabled: false,
      missing: false,
      isJailbreak,
    });
  }

  return entries;
}

function isEntryDerivedWarning(warning: string): boolean {
  return warning.startsWith("跳过 ")
    || warning.startsWith("顺序表中有 ")
    || warning.startsWith("保留了 ")
    || warning.startsWith("包含 ")
    || warning === "当前没有可导入的已启用提示词正文。";
}

interface BuildPresetSkillInput {
  readonly sourceFile: string;
  readonly skillSlug: string;
  readonly skillName: string;
  readonly selectedOrder: TavernPresetImportResult["selectedOrder"];
  readonly sampler: TavernPresetSamplerSettings;
  readonly totalPrompts: number;
  readonly orderGroups: number;
  readonly selectedOrderEntries: number;
  readonly entries: readonly TavernPresetEntry[];
  readonly baseWarnings: readonly string[];
  readonly allowEmpty: boolean;
}

function buildPresetSkill(input: BuildPresetSkillInput): Pick<
  TavernPresetImportResult,
  "skill" | "stats" | "warnings"
> {
  const unknownMacros = new Set<string>();
  const variables = new Map<string, string>();
  const sections: string[] = [];
  let skippedMarkers = 0;
  let missingPrompts = 0;
  let jailbreakCount = 0;

  for (const entry of input.entries) {
    if (!entry.enabled) continue;
    if (entry.missing) {
      missingPrompts += 1;
      continue;
    }
    if (entry.marker) {
      skippedMarkers += 1;
      continue;
    }
    const { content: refinedContent, isJailbreak } = refineJailbreakPrompt(entry.content, entry.identifier);
    if (isJailbreak) jailbreakCount += 1;
    const content = translateMacros(refinedContent, variables, unknownMacros);
    if (!content) continue;
    sections.push([
      `## ${String(sections.length + 1).padStart(2, "0")} · ${safeHeading(entry.name)}${isJailbreak ? " [高烈度创作协议]" : ""}`,
      `<!-- source-role: ${entry.role ?? "system"}; source-id: ${entry.identifier.replace(/--/g, "- -")} -->`,
      "",
      content,
    ].join("\n"));
  }

  if (sections.length === 0 && !input.allowEmpty) {
    throw new TavernPresetImportError("选中的提示词顺序里没有可导入的已启用正文。");
  }

  const stats: TavernPresetImportStats = {
    totalPrompts: input.totalPrompts,
    orderGroups: input.orderGroups,
    selectedOrderEntries: input.selectedOrderEntries,
    enabledEntries: input.entries.filter((entry) => entry.enabled).length,
    importedPrompts: sections.length,
    skippedMarkers,
    missingPrompts,
    jailbreakCount,
  };
  const warnings = [...input.baseWarnings];
  if (skippedMarkers > 0) {
    warnings.push(`跳过 ${skippedMarkers} 个动态标记项；角色、经纬、场景与聊天历史由 NovelFork 原生管线提供。`);
  }
  if (missingPrompts > 0) warnings.push(`顺序表中有 ${missingPrompts} 个标识未在 prompts 中找到，已忽略。`);
  if (jailbreakCount > 0) warnings.push(`包含 ${jailbreakCount} 处高烈度虚构文学创作协议（破限模块），已做小说化提纯。`);
  if (unknownMacros.size > 0) {
    warnings.push(`保留了 ${unknownMacros.size} 个无法静态转换的模板变量，导入后可在技能编辑器中检查。`);
  }
  if (sections.length === 0) warnings.push("当前没有可导入的已启用提示词正文。");

  const metadataLines = [
    "  format: \"sillytavern-chat-completion-preset\"",
    `  sourceFile: ${yamlString(input.sourceFile)}`,
    `  selectedOrderIndex: ${input.selectedOrder.index ?? -1}`,
    `  selectedCharacterId: ${input.selectedOrder.characterId ? yamlString(input.selectedOrder.characterId) : "null"}`,
    `  enabledEntries: ${stats.enabledEntries}`,
    `  importedPrompts: ${stats.importedPrompts}`,
    `  skippedMarkers: ${stats.skippedMarkers}`,
    "  sampler:",
    ...(samplerYaml(input.sampler).length > 0 ? samplerYaml(input.sampler) : ["    {}"]),
  ];
  const skillContent = [
    "---",
    `id: ${yamlString(`writing-skill-${input.skillSlug}`)}`,
    `name: ${yamlString(input.skillName)}`,
    `description: ${yamlString(`从酒馆 Chat Completion 预设导入，按原顺序保留 ${stats.importedPrompts} 条启用提示词。`)}`,
    "kind: prose",
    "mode: manual",
    "tags:",
    "  - \"酒馆预设\"",
    "  - \"格式兼容\"",
    "version: \"1\"",
    "compatibility:",
    ...metadataLines,
    "---",
    "",
    `# ${input.skillName}`,
    "",
    "以下规则由酒馆 Chat Completion 预设导入，并按原预设的启用顺序整理。NovelFork 原生负责书籍绑定、经纬、叙事记忆、场景蓝图与聊天历史；对应动态标记不会在这里重复注入。",
    "",
    ...sections.flatMap((section) => [section, ""]),
  ].join("\n").trimEnd() + "\n";

  if (skillContent.length > MAX_GENERATED_SKILL_LENGTH) {
    throw new TavernPresetImportError("转换后的 Writing Skill 超过 2 MB，无法安全保存。");
  }

  return {
    skill: { slug: input.skillSlug, name: input.skillName, content: skillContent },
    stats,
    warnings,
  };
}

export function toggleTavernPresetEntry(
  entries: readonly TavernPresetEntry[],
  entryId: string,
  enabled: boolean,
): readonly TavernPresetEntry[] {
  let changed = false;
  const next = entries.map((entry) => {
    if (entry.entryId !== entryId || entry.enabled === enabled) return entry;
    changed = true;
    return { ...entry, enabled };
  });
  return changed ? next : entries;
}

export function rebuildTavernPresetSkill(
  result: TavernPresetImportResult,
  entries: readonly TavernPresetEntry[] = result.entries,
): TavernPresetImportResult {
  const rebuilt = buildPresetSkill({
    sourceFile: result.sourceFile,
    skillSlug: result.skill.slug,
    skillName: result.skill.name,
    selectedOrder: result.selectedOrder,
    sampler: result.sampler,
    totalPrompts: result.stats.totalPrompts,
    orderGroups: result.stats.orderGroups,
    selectedOrderEntries: result.stats.selectedOrderEntries,
    entries,
    baseWarnings: result.warnings.filter((warning) => !isEntryDerivedWarning(warning)),
    allowEmpty: true,
  });
  return {
    ...result,
    ...rebuilt,
    entries,
  };
}

export function importTavernPreset(raw: string, fileName = "preset.json"): TavernPresetImportResult {
  if (!raw.trim()) throw new TavernPresetImportError("预设文件为空。");
  if (raw.length > MAX_PRESET_LENGTH) {
    throw new TavernPresetImportError(`预设文件超过 ${Math.round(MAX_PRESET_LENGTH / 1_000_000)} MB 安全上限。`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TavernPresetImportError("JSON 解析失败，请选择酒馆导出的 Chat Completion 预设文件。");
  }
  if (!isRecord(parsed)) throw new TavernPresetImportError("预设根节点必须是 JSON 对象。");

  const prompts = parsePrompts(parsed.prompts);
  const promptsById = new Map<string, TavernPrompt>();
  for (const prompt of prompts) if (!promptsById.has(prompt.identifier)) promptsById.set(prompt.identifier, prompt);
  const orderGroups = parseOrderGroups(parsed.prompt_order);
  const selectedOrder = selectOrderGroup(orderGroups, promptsById);
  const baseWarnings: string[] = [];

  if (orderGroups.length > 1 && selectedOrder) {
    baseWarnings.push(`检测到 ${orderGroups.length} 套提示词顺序，已选择有效内容最多的一套${selectedOrder.characterId ? `（${selectedOrder.characterId}）` : ""}。`);
  }
  if (!selectedOrder) baseWarnings.push("未找到可用的 prompt_order，已按 prompts 原始顺序导入未禁用内容。");

  const orderedEntries: readonly TavernOrderEntry[] = selectedOrder
    ? selectedOrder.order
    : prompts.map((prompt) => ({ identifier: prompt.identifier, enabled: prompt.enabled }));
  const entries = toPresetEntries(orderedEntries, prompts);

  const sampler = readSamplerSettings(parsed);
  if (Object.keys(sampler).length > 0) {
    baseWarnings.push("采样参数已保存在技能元数据中；可作为模型调度参考。");
  }

  const baseName = fileBaseName(fileName).slice(0, 100);
  const skillName = `酒馆预设 · ${baseName}`;
  const slug = presetSlug(fileName, raw);
  const selectedOrderInfo = {
    index: selectedOrder?.index ?? null,
    characterId: selectedOrder?.characterId ?? null,
  };
  const built = buildPresetSkill({
    sourceFile: fileName,
    skillSlug: slug,
    skillName,
    selectedOrder: selectedOrderInfo,
    sampler,
    totalPrompts: prompts.length,
    orderGroups: orderGroups.length,
    selectedOrderEntries: orderedEntries.length,
    entries,
    baseWarnings,
    allowEmpty: false,
  });

  return {
    sourceFile: fileName,
    skill: built.skill,
    selectedOrder: selectedOrderInfo,
    sampler,
    stats: built.stats,
    entries,
    warnings: built.warnings,
  };
}
