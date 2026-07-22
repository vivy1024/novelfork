import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  createUserTemplateRepository,
  type BookConfig,
  type StorageDatabase,
} from "@vivy1024/novelfork-core";
import { registerBuiltinPresets } from "../engine/presets/builtin.js";
import {
  listBeatTemplates,
  listPresets,
  registerBeatTemplate,
  registerPreset,
} from "../engine/presets/index.js";
import type {
  Beat,
  BeatTemplate,
  Preset,
  PresetCategory,
} from "../engine/presets/types.js";

export interface TrustedPresetBeatOptions {
  readonly bookRoot: string;
  readonly storage: StorageDatabase;
  readonly now?: () => Date;
  readonly createId?: (kind: "preset" | "beat") => string;
}

export interface PresetsReadInput {
  readonly bookId: string;
  readonly scope?: string;
  readonly category?: string;
}

export interface PresetsWriteInput {
  readonly bookId: string;
  readonly action: string;
  readonly enabledPresetIds?: readonly string[];
  readonly name?: string;
  readonly category?: string;
  readonly promptInjection?: string;
  readonly description?: string;
}

export interface BeatReadInput {
  readonly bookId: string;
}

export interface BeatWriteInput {
  readonly bookId: string;
  readonly action: string;
  readonly templateId?: string;
  readonly name?: string;
  readonly description?: string;
  readonly beats?: readonly unknown[];
}

export interface PresetsCheckComplianceInput {
  readonly bookId: string;
  readonly content: string;
  readonly chapterNumber?: number;
}

type HandlerResult = Readonly<{
  ok: boolean;
  summary: string;
  error?: string;
  data?: unknown;
}>;

type BookWritingConfig = BookConfig & { readonly beatTemplateId?: string };

export type AccessiblePresetStore = Readonly<{
  presets: readonly Preset[];
  beats: readonly BeatTemplate[];
}>;

function fail(error: string, summary: string): HandlerResult {
  return { ok: false, error, summary };
}

function requireBookId(bookId: string): string {
  const normalized = bookId.trim();
  if (!normalized) throw new Error("bookId must not be empty.");
  return normalized;
}

function bookConfigPath(options: TrustedPresetBeatOptions): string {
  return join(options.bookRoot, "book.json");
}

async function readBookConfig(
  bookId: string,
  options: TrustedPresetBeatOptions,
): Promise<BookWritingConfig> {
  const normalizedBookId = requireBookId(bookId);
  const parsed = JSON.parse(await readFile(bookConfigPath(options), "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid book.json for ${normalizedBookId}.`);
  }
  const config = parsed as BookWritingConfig;
  if (typeof config.id === "string" && config.id !== normalizedBookId) {
    throw new Error("book.json does not match the trusted book binding.");
  }
  return config;
}

async function writeBookConfig(
  bookId: string,
  options: TrustedPresetBeatOptions,
  update: (config: BookWritingConfig) => BookWritingConfig,
): Promise<BookWritingConfig> {
  const current = await readBookConfig(bookId, options);
  const next = update(current);
  await writeFile(bookConfigPath(options), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function parseTemplateBundle(bundleJson: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(bundleJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function normalizeStoredBeats(value: unknown): Beat[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const fallbackRatio = 1 / value.length;
  const beats: Beat[] = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const source = item as Record<string, unknown>;
    const name = typeof source.name === "string" ? source.name.trim() : "";
    const emotionalTone = typeof source.emotionalTone === "string" ? source.emotionalTone.trim() : "";
    if (!name || !emotionalTone) return null;
    const rawRatio = typeof source.wordRatio === "number" ? source.wordRatio : Number(source.wordRatio);
    beats.push({
      index: index + 1,
      name,
      emotionalTone,
      wordRatio: Number.isFinite(rawRatio) && rawRatio > 0 ? rawRatio : fallbackRatio,
      purpose: typeof source.purpose === "string" ? source.purpose.trim() : "",
      ...(typeof source.networkNovelTip === "string" && source.networkNovelTip.trim()
        ? { networkNovelTip: source.networkNovelTip.trim() }
        : {}),
    });
  }
  return beats;
}

export function loadAccessiblePresetBeatStore(
  storage: StorageDatabase,
  bookId: string,
): AccessiblePresetStore {
  if (listPresets().length === 0 || listBeatTemplates().length === 0) {
    registerBuiltinPresets();
  }

  const allCustomIds = new Set<string>();
  const accessibleCustomIds = new Set<string>();
  for (const template of createUserTemplateRepository(storage).list()) {
    allCustomIds.add(template.id);
    if (template.bookId !== null && template.bookId !== bookId) continue;
    accessibleCustomIds.add(template.id);
    const bundle = parseTemplateBundle(template.bundleJson);
    if (!bundle) continue;
    if (bundle.type === "preset" && typeof bundle.promptInjection === "string") {
      registerPreset({
        id: template.id,
        name: template.name,
        category: (typeof bundle.category === "string" ? bundle.category : "bundle") as PresetCategory,
        promptInjection: bundle.promptInjection,
        description: template.description ?? "",
      });
    }
    if (bundle.type === "beat-template") {
      const beats = normalizeStoredBeats(bundle.beats);
      if (!beats) continue;
      registerBeatTemplate({
        id: template.id,
        name: typeof bundle.name === "string" ? bundle.name : template.name,
        description: typeof bundle.description === "string" ? bundle.description : template.description ?? "",
        beats,
      });
    }
  }

  const isAccessible = (id: string): boolean => (
    (!id.startsWith("custom-") && !allCustomIds.has(id)) || accessibleCustomIds.has(id)
  );
  return {
    presets: listPresets().filter((preset) => isAccessible(preset.id)),
    beats: listBeatTemplates().filter((template) => isAccessible(template.id)),
  };
}

function createTemplateId(
  kind: "preset" | "beat",
  options: TrustedPresetBeatOptions,
): string {
  return options.createId?.(kind) ?? `custom-${kind}-${randomUUID()}`;
}

function nowIso(options: TrustedPresetBeatOptions): string {
  return (options.now?.() ?? new Date()).toISOString();
}

export async function handlePresetsRead(
  input: PresetsReadInput,
  options: TrustedPresetBeatOptions,
): Promise<HandlerResult> {
  try {
    const bookId = requireBookId(input.bookId);
    const config = await readBookConfig(bookId, options);
    const store = loadAccessiblePresetBeatStore(options.storage, bookId);
    const enabledIds = new Set(config.enabledPresetIds ?? []);
    const scope = input.scope ?? "enabled";

    if (scope === "available") {
      const presets = input.category
        ? store.presets.filter((preset) => preset.category === input.category)
        : store.presets;
      const items = presets.map((preset) => ({
        id: preset.id,
        name: preset.name,
        category: preset.category,
        description: preset.description,
        promptInjection: preset.promptInjection,
        ...(preset.conflictGroup ? { conflictGroup: preset.conflictGroup } : {}),
        ...(preset.postWriteChecks ? { postWriteChecks: preset.postWriteChecks } : {}),
        enabled: enabledIds.has(preset.id),
      }));
      return {
        ok: true,
        summary: `共 ${items.length} 个可用预设，其中 ${items.filter((item) => item.enabled).length} 个已启用。`,
        data: { bookId, enabledPresetIds: [...enabledIds], presets: items },
      };
    }

    if (scope !== "enabled") return fail("invalid-input", `未知 presets.read scope: ${scope}。`);
    const byId = new Map(store.presets.map((preset) => [preset.id, preset]));
    const rules = [...enabledIds]
      .map((id) => byId.get(id))
      .filter((preset): preset is Preset => Boolean(preset))
      .map((preset) => ({
        id: preset.id,
        name: preset.name,
        category: preset.category,
        promptInjection: preset.promptInjection,
      }));
    return {
      ok: true,
      summary: `${rules.length} 条预设规则已加载。`,
      data: { bookId, rules },
    };
  } catch (error) {
    return fail("presets-read-failed", `预设加载失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function handlePresetsWrite(
  input: PresetsWriteInput,
  options: TrustedPresetBeatOptions,
): Promise<HandlerResult> {
  try {
    const bookId = requireBookId(input.bookId);
    const action = input.action;
    const store = loadAccessiblePresetBeatStore(options.storage, bookId);

    if (action === "create") {
      const name = input.name?.trim() ?? "";
      const promptInjection = input.promptInjection?.trim() ?? "";
      if (!name || !promptInjection) {
        return fail("invalid-input", "action=create 时 name 和 promptInjection 必填。");
      }
      const category = (input.category?.trim() || "bundle") as PresetCategory;
      const id = createTemplateId("preset", options);
      createUserTemplateRepository(options.storage).create({
        id,
        bookId,
        name,
        description: input.description?.trim() || null,
        bundleJson: JSON.stringify({ type: "preset", category, promptInjection }),
      });
      registerPreset({ id, name, category, promptInjection, description: input.description?.trim() ?? "" });
      await writeBookConfig(bookId, options, (config) => ({
        ...config,
        enabledPresetIds: [...new Set([...(config.enabledPresetIds ?? []), id])],
        updatedAt: nowIso(options),
      }));
      return {
        ok: true,
        summary: `已创建并启用自定义预设「${name}」。`,
        data: { id, name, category, bookId, autoEnabled: true },
      };
    }

    if (action !== "enable" && action !== "disable" && action !== "set") {
      return fail("invalid-input", `presets.write 的 action 必须是 enable/disable/set/create，收到：${action}`);
    }
    const requestedIds = [...new Set((input.enabledPresetIds ?? []).map((id) => id.trim()).filter(Boolean))];
    const accessibleIds = new Set(store.presets.map((preset) => preset.id));
    const current = await readBookConfig(bookId, options);
    const currentIds = current.enabledPresetIds ?? [];
    const candidateIds = action === "enable"
      ? [...new Set([...currentIds, ...requestedIds])]
      : action === "disable"
        ? currentIds.filter((id) => !new Set(requestedIds).has(id))
        : requestedIds;
    const validIds = candidateIds.filter((id) => accessibleIds.has(id));
    const invalidIds = candidateIds.filter((id) => !accessibleIds.has(id));
    await writeBookConfig(bookId, options, (config) => ({
      ...config,
      enabledPresetIds: validIds,
      updatedAt: nowIso(options),
    }));
    return {
      ok: true,
      summary: validIds.length > 0
        ? `当前共 ${validIds.length} 条预设规则已启用。${invalidIds.length > 0 ? ` ${invalidIds.length} 个无效或越界 ID 已忽略。` : ""}`
        : "已清空所有预设规则。",
      data: { bookId, mode: action, enabledPresetIds: validIds, invalidIds },
    };
  } catch (error) {
    return fail("presets-write-failed", `设置预设规则失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function handleBeatRead(
  input: BeatReadInput,
  options: TrustedPresetBeatOptions,
): Promise<HandlerResult> {
  try {
    const bookId = requireBookId(input.bookId);
    const config = await readBookConfig(bookId, options);
    const store = loadAccessiblePresetBeatStore(options.storage, bookId);
    const activeTemplate = config.beatTemplateId
      ? store.beats.find((template) => template.id === config.beatTemplateId)
      : undefined;
    const availableTemplates = store.beats.map((template) => ({
      id: template.id,
      name: template.name,
      description: template.description,
      beats: template.beats,
    }));
    if (!activeTemplate) {
      return {
        ok: true,
        summary: "当前未选择节拍模板。",
        data: {
          bookId,
          selectedTemplateId: null,
          template: null,
          beats: [],
          availableTemplates,
          available: availableTemplates.map((template) => ({
            id: template.id,
            name: template.name,
            beatCount: template.beats.length,
          })),
        },
      };
    }
    return {
      ok: true,
      summary: `当前节拍模板：${activeTemplate.name}（${activeTemplate.beats.length} 个节拍）。`,
      data: {
        bookId,
        selectedTemplateId: activeTemplate.id,
        template: {
          id: activeTemplate.id,
          name: activeTemplate.name,
          description: activeTemplate.description,
          totalBeats: activeTemplate.beats.length,
        },
        availableTemplates,
        beats: activeTemplate.beats.map((beat, index) => ({
          index,
          name: beat.name,
          emotionalTone: beat.emotionalTone,
          wordRatio: beat.wordRatio,
          networkNovelTip: beat.networkNovelTip ?? null,
        })),
      },
    };
  } catch (error) {
    return fail("beat-read-failed", `节拍信息加载失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function handleBeatWrite(
  input: BeatWriteInput,
  options: TrustedPresetBeatOptions,
): Promise<HandlerResult> {
  try {
    const bookId = requireBookId(input.bookId);
    const store = loadAccessiblePresetBeatStore(options.storage, bookId);
    if (input.action === "select") {
      const templateId = input.templateId?.trim() ?? "";
      const template = store.beats.find((candidate) => candidate.id === templateId);
      if (!template) return fail("invalid-template", `模板 "${templateId}" 不存在或不属于当前书籍。`);
      await writeBookConfig(bookId, options, (config) => ({
        ...config,
        beatTemplateId: templateId,
        updatedAt: nowIso(options),
      }));
      return {
        ok: true,
        summary: `已将节拍模板设置为「${template.name}」（${template.beats.length} 个节拍）。`,
        data: { bookId, templateId, templateName: template.name, beatCount: template.beats.length },
      };
    }
    if (input.action === "create") {
      const name = input.name?.trim() ?? "";
      const beats = normalizeStoredBeats(input.beats);
      if (!name || !beats) return fail("invalid-input", "action=create 时 name 和有效 beats 列表必填。");
      const id = createTemplateId("beat", options);
      const description = input.description?.trim() ?? "";
      createUserTemplateRepository(options.storage).create({
        id,
        bookId,
        name,
        description,
        bundleJson: JSON.stringify({ type: "beat-template", name, description, beats }),
      });
      registerBeatTemplate({ id, name, description, beats });
      return {
        ok: true,
        summary: `已创建自定义节拍模板「${name}」（${beats.length} 个节拍）。`,
        data: { id, name, beatCount: beats.length, bookId },
      };
    }
    return fail("invalid-input", `beat.write 的 action 必须是 select/create，收到：${input.action}`);
  } catch (error) {
    return fail("beat-write-failed", `节拍模板写入失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function handlePresetsCheckCompliance(
  input: PresetsCheckComplianceInput,
  options: TrustedPresetBeatOptions,
): Promise<HandlerResult> {
  try {
    const bookId = requireBookId(input.bookId);
    if (!input.content.trim()) return fail("missing-content", "content 参数不能为空。");
    const config = await readBookConfig(bookId, options);
    const store = loadAccessiblePresetBeatStore(options.storage, bookId);
    const enabledIds = new Set(config.enabledPresetIds ?? []);
    const enabledPresets = store.presets.filter((preset) => enabledIds.has(preset.id));
    const violations: Array<{
      presetName: string;
      rule: string;
      violation: string;
      severity: "warning" | "error";
    }> = [];

    for (const preset of enabledPresets) {
      if (preset.category === "anti-ai" || preset.category === "tone") {
        for (const pattern of ["值得注意的是", "总而言之", "综上所述", "不言而喻", "毋庸置疑", "众所周知", "显而易见", "不可否认", "事实上", "换言之"]) {
          if (input.content.includes(pattern)) {
            violations.push({
              presetName: preset.name,
              rule: `避免使用“${pattern}”`,
              violation: `文本中包含“${pattern}”`,
              severity: "warning",
            });
          }
        }
      }
      if (preset.category === "literary") {
        const sentences = input.content.split(/[。！？]/).filter((sentence) => sentence.trim());
        if (sentences.length >= 5) {
          const lengths = sentences.map((sentence) => sentence.trim().length);
          const average = lengths.reduce((sum, length) => sum + length, 0) / lengths.length;
          const variance = lengths.reduce((sum, length) => sum + (length - average) ** 2, 0) / lengths.length;
          if (variance < 50) {
            violations.push({
              presetName: preset.name,
              rule: "句长应有变化",
              violation: `句长方差过低（${Math.round(variance)}），节奏单调`,
              severity: "warning",
            });
          }
        }
      }
      if (preset.category === "logic-risk" && /早上|清晨|黎明/.test(input.content) && /夜晚|深夜|月光/.test(input.content) && input.content.length < 2000) {
        violations.push({
          presetName: preset.name,
          rule: "时间线一致性",
          violation: "短文本中同时出现早晨和夜晚描写，可能存在时间矛盾",
          severity: "warning",
        });
      }
      if (preset.category === "tone") {
        const forbiddenMatch = preset.promptInjection.match(/禁止[：:]\s*(.+)/);
        for (const word of forbiddenMatch?.[1]?.split(/[,，、]/).map((item) => item.trim()).filter(Boolean) ?? []) {
          if (word.length >= 2 && input.content.includes(word)) {
            violations.push({
              presetName: preset.name,
              rule: `禁止使用“${word}”`,
              violation: `文本中包含禁用词“${word}”`,
              severity: "error",
            });
          }
        }
      }
    }

    return {
      ok: true,
      summary: violations.length === 0 ? "所有预设规则检查通过。" : `发现 ${violations.length} 处违规。`,
      data: {
        bookId,
        ...(input.chapterNumber ? { chapterNumber: input.chapterNumber } : {}),
        violations,
        checkedPresets: enabledPresets.length,
      },
    };
  } catch (error) {
    return fail("presets-check-failed", `合规检查失败：${error instanceof Error ? error.message : String(error)}`);
  }
}
