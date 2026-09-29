/**
 * 叙述者角色声线工具（T2.3）。
 *
 * - character.voice.read：只读，返回声线各字段状态、依据与当前会注入写作的约束文本。
 * - character.voice.draft：生成待审草稿（规则初稿 + 可选会话模型增补），只写未确认字段。
 *
 * 两个工具都在进程内调用 routes/character-voice.ts 的同一路由，不另写一套草稿流程；
 * 书籍只取宿主可信绑定，模型只用当前会话的 generateText。叙述者没有「确认」声线的能力，
 * 确认留给作者在角色卡里逐项完成。
 */

import { getStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core";
import type { RuntimeToolResult, ToolExecutionContext } from "@vivy1024/novelfork-core/plugins";

import { createStoryJingweiEntryRepository } from "../engine/jingwei/repositories/entry-repo.js";
import { normalizeCategory } from "../engine/jingwei/unified-categories.js";
import {
  buildVoiceConstraintText,
  CHARACTER_VOICE_FIELD_META,
  parseCharacterVoice,
  VOICE_MISSING_LABEL,
} from "../engine/writing-layers/character-voice.js";
import { createCharacterVoiceRouter } from "../routes/character-voice.js";
import type { TrustedRuntimeBookBinding } from "./runtime-domain-tools.js";

export const CHARACTER_VOICE_TOOL_NAMES = ["character.voice.read", "character.voice.draft"] as const;

/** 叙述者草稿默认扫描的近章数。 */
export const CHARACTER_VOICE_TOOL_DEFAULT_SCAN_CHAPTERS = 10;

export interface CharacterVoiceToolDeps {
  readonly storage?: StorageDatabase;
}

interface Explanation {
  readonly whatHappened: string;
  readonly whyItMatters: string;
  readonly suggestedAction: string;
}

const STATUS_LABEL: Record<string, string> = { missing: VOICE_MISSING_LABEL, "needs-review": "待审", confirmed: "已确认" };
const SOURCE_LABEL: Record<string, string> = { card: "角色卡原句", dialogue: "对白统计", model: "模型增补", author: "作者填写" };

function fail(error: string, summary: string, data?: Record<string, unknown>): RuntimeToolResult {
  return { ok: false, error, summary, ...(data ? { data: JSON.parse(JSON.stringify(data)) } : {}) };
}

function ok(summary: string, data: unknown): RuntimeToolResult {
  return { ok: true, summary, data: JSON.parse(JSON.stringify(data)) };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function explanation(whatHappened: string, whyItMatters: string, suggestedAction: string): Explanation {
  return { whatHappened, whyItMatters, suggestedAction };
}

/** 按 entryId 或角色名（标题 / 别名，精确匹配）定位本书角色条目；重名时不猜。 */
async function resolveCharacterEntryId(
  storage: StorageDatabase,
  bookId: string,
  input: Readonly<Record<string, unknown>>,
): Promise<{ entryId: string } | RuntimeToolResult> {
  const entryId = text(input.entryId);
  if (entryId) return { entryId };
  const name = text(input.characterName);
  if (!name) {
    return fail("character-voice-target-required", "需要 entryId 或 characterName 指明角色。", {
      explanation: explanation("没有指明要处理哪个角色。", "声线挂在具体的经纬角色条目上。", "先用 lore.read 查到角色条目 id，或传入角色名。"),
    });
  }
  const key = name.toLowerCase();
  const candidates = (await createStoryJingweiEntryRepository(storage).listByBook(bookId))
    .filter((entry) => normalizeCategory(entry.category).category === "characters")
    .filter((entry) => [entry.title, ...entry.aliases].some((label) => label.trim().toLowerCase() === key));
  if (candidates.length === 1) return { entryId: candidates[0]!.id };
  if (candidates.length === 0) {
    return fail("character-voice-character-not-found", `本书经纬里没有名为「${name}」的角色。`, {
      explanation: explanation(
        `角色分类里找不到标题或别名为「${name}」的条目。`,
        "声线只能挂在已有角色卡上，不会为不存在的角色新建条目。",
        "先用 lore.read 确认角色名或 id；角色尚未建卡时请作者先建卡。",
      ),
    });
  }
  return fail("character-voice-character-ambiguous", `「${name}」对应多个角色条目，请改用 entryId。`, {
    candidates: candidates.map((entry) => ({ entryId: entry.id, title: entry.title, aliases: entry.aliases })),
    explanation: explanation("多个角色条目的标题或别名同为这个名字。", "猜错条目会把声线写到别的角色身上。", "从 candidates 里选定 entryId 后再调用。"),
  });
}

interface VoiceRouteBody {
  readonly entryId: string;
  readonly name: string;
  readonly version: number;
  readonly voice: unknown;
  readonly summary: { confirmed: number; needsReview: number; missing: number; missingKeys?: string[] };
  readonly draft?: Record<string, unknown>;
  readonly warnings?: readonly { code: string; message: string; explanation?: unknown }[];
  readonly error?: string;
  readonly code?: string;
  readonly explanation?: unknown;
}

/** 给模型看的字段视图：标签、状态、来源与依据都用中文，待补充明确写出。 */
function fieldView(voiceRaw: unknown) {
  const voice = parseCharacterVoice(voiceRaw);
  return CHARACTER_VOICE_FIELD_META.map((meta) => {
    const field = voice.fields[meta.key];
    const empty = Array.isArray(field.value) ? field.value.length === 0 : !field.value;
    return {
      key: meta.key,
      label: meta.label,
      status: field.status,
      statusLabel: STATUS_LABEL[field.status],
      value: empty ? VOICE_MISSING_LABEL : field.value,
      ...(field.source ? { source: SOURCE_LABEL[field.source] ?? field.source } : {}),
      ...(field.evidence?.length ? { evidence: field.evidence } : {}),
    };
  });
}

function constraintPreview(body: VoiceRouteBody): string {
  const voice = parseCharacterVoice(body.voice);
  return buildVoiceConstraintText([{ characterId: body.entryId, name: body.name, voice }], [body.entryId]);
}

export async function executeCharacterVoiceTool(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
  binding: TrustedRuntimeBookBinding,
  context: ToolExecutionContext,
  deps: CharacterVoiceToolDeps = {},
): Promise<RuntimeToolResult> {
  const normalized = toolName.replace(/\./g, "_");
  const storage = deps.storage ?? getStorageDatabase();
  const target = await resolveCharacterEntryId(storage, binding.bookId, input);
  if (!("entryId" in target)) return target;

  const router = createCharacterVoiceRouter({
    storage,
    // 只认宿主可信绑定的书籍根目录。
    resolveBookRoot: (bookId) => {
      if (bookId !== binding.bookId) throw new Error("The requested book does not match the trusted binding.");
      return binding.root;
    },
    resolveGenerateText: async () => context.generateText,
  });
  const path = `http://novel.local/api/books/${encodeURIComponent(binding.bookId)}/jingwei/entries/${encodeURIComponent(target.entryId)}/voice`;

  let response: Response;
  if (normalized === "character_voice_read") {
    response = await router.request(path);
  } else if (normalized === "character_voice_draft") {
    const expectedVersion = input.expectedVersion;
    if (typeof expectedVersion !== "number" || !Number.isInteger(expectedVersion)) {
      return fail("character-voice-version-required", "生成声线草稿必须传 character.voice.read 返回的 expectedVersion。", {
        explanation: explanation(
          "没有携带角色条目版本号。",
          "声线存在角色卡里，不核对版本可能覆盖作者刚在角色卡上的修改。",
          "先调用 character.voice.read，把返回的 expectedVersion 原样传回。",
        ),
      });
    }
    const scanChapters = typeof input.scanChapters === "number" && Number.isFinite(input.scanChapters)
      ? Math.max(0, Math.trunc(input.scanChapters))
      : CHARACTER_VOICE_TOOL_DEFAULT_SCAN_CHAPTERS;
    response = await router.request(`${path}/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedVersion,
        dialogueSamples: stringList(input.dialogueSamples),
        scanChapters,
        // 缺省：会话有模型就请模型增补；叙述者可显式关掉。
        useModel: typeof input.useModel === "boolean" ? input.useModel : Boolean(context.generateText),
      }),
    });
  } else {
    return fail("unknown-tool", `未知的声线工具：${toolName}`);
  }

  const body = await response.json() as VoiceRouteBody;
  if (!response.ok) {
    return fail(body.code ?? "character-voice-failed", body.error ?? "角色声线操作失败。", {
      status: response.status,
      ...(body.explanation ? { explanation: body.explanation } : {}),
    });
  }

  const fields = fieldView(body.voice);
  const preview = constraintPreview(body);
  const counts = `已确认 ${body.summary.confirmed} 项、待审 ${body.summary.needsReview} 项、待补充 ${body.summary.missing} 项`;

  if (normalized === "character_voice_read") {
    return ok(`「${body.name}」的声线：${counts}。只有已确认的项会约束写作。`, {
      entryId: body.entryId,
      name: body.name,
      expectedVersion: body.version,
      summary: body.summary,
      fields,
      constraintPreview: preview,
    });
  }

  const appliedKeys = stringList(body.draft?.appliedKeys);
  const warnings = body.warnings ?? [];
  const summary = appliedKeys.length > 0
    ? `已为「${body.name}」写入 ${appliedKeys.length} 项待审声线草稿（${counts}）。待审项需作者在角色卡「声线」区块逐项确认后才会约束写作。`
    : `没有找到新的依据，「${body.name}」的声线未改动（${counts}）。`;
  return ok(warnings.length > 0 ? `${summary}另有 ${warnings.length} 条提示，见 warnings。` : summary, {
    entryId: body.entryId,
    name: body.name,
    expectedVersion: body.version,
    summary: body.summary,
    draft: body.draft,
    fields,
    warnings,
    // 草稿不改变注入内容：这里仍只含已确认项。
    constraintPreview: preview,
  });
}
