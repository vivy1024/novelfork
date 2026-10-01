/**
 * 角色声线 HTTP（T2.3）。
 *
 * 权威源是经纬角色条目的 `fields_json.voice`；本路由只做读取、生成待审草稿、
 * 作者逐项确认三件事。所有写入都带条目 version 做乐观并发，版本不符返回 409。
 * 草稿与模型产物一律写成 status=needs-review，作者确认前不进入写作约束。
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono, type Context } from "hono";
import { getStorageDatabase, isSafeBookId, type StorageDatabase } from "@vivy1024/novelfork-core";
import {
  applyVoiceFieldUpdates,
  CHARACTER_VOICE_FIELD_KEYS,
  CharacterVoiceError,
  draftCharacterVoice,
  enrichCharacterVoiceWithModel,
  extractCharacterDialogue,
  getVoiceFieldMeta,
  mergeVoiceDraft,
  MIN_DIALOGUE_LINES_FOR_STATS,
  parseCharacterVoice,
  serializeCharacterVoice,
  summarizeCharacterVoice,
  cleanDialogueLine,
  type CharacterCardSource,
  type CharacterVoice,
  type CharacterVoiceFieldKey,
  type CharacterVoiceGenerateText,
  type DialogueVoiceStats,
  type VoiceFieldUpdate,
  type VoiceModelOutcome,
} from "../engine/writing-layers/character-voice.js";
import { modelJsonFailureAdvice } from "../engine/model-output/lenient-json.js";
import { createBookRepository } from "../engine/jingwei/repositories/book-repo.js";
import { createStoryJingweiEntryRepository } from "../engine/jingwei/repositories/entry-repo.js";
import { normalizeCategory } from "../engine/jingwei/unified-categories.js";
import type { StoryJingweiEntryRecord } from "../engine/jingwei/types.js";
import { listChapterFiles } from "../engine/writing-resource/chapter-layout.js";
import type { DiagnosticExplanation } from "../handlers/diagnostic-explanation.js";
import type { HostTextGenerationAvailability } from "./context.js";

export interface CreateCharacterVoiceRouterOptions {
  readonly storage?: StorageDatabase;
  /** 书籍根目录（扫描近章对白用）；缺省时不支持从正文取样。 */
  readonly resolveBookRoot?: (bookId: string) => string;
  /** 宿主注入的文本生成能力；缺省或返回 undefined 时只做规则初稿。 */
  readonly resolveGenerateText?: (c: Context, bookId: string) => Promise<CharacterVoiceGenerateText | undefined>;
  /**
   * 宿主按当前登录用户提供的服务端文本生成（同 RouterContext.resolveTextGeneration），
   * 不可用时带原因。给了它就不再看 resolveGenerateText。
   */
  readonly resolveTextGeneration?: (c: Context) => Promise<HostTextGenerationAvailability>;
  readonly now?: () => Date;
}

export interface CharacterVoiceWarning {
  readonly code: string;
  readonly message: string;
  readonly explanation: DiagnosticExplanation;
}

const MAX_SCAN_CHAPTERS = 30;
const MAX_REQUEST_SAMPLES = 80;

class VoiceRouteError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 422,
    readonly code: string,
    message: string,
    readonly explanation: DiagnosticExplanation,
  ) {
    super(message);
  }
}

function explain(whatHappened: string, whyItMatters: string, suggestedAction: string): DiagnosticExplanation {
  return { whatHappened, whyItMatters, suggestedAction };
}

function bodyRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readExpectedVersion(body: Record<string, unknown>): number {
  const value = body.expectedVersion;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new VoiceRouteError(400, "CHARACTER_VOICE_VERSION_REQUIRED", "保存声线必须携带 expectedVersion。", explain(
      "请求里没有角色条目的版本号。",
      "声线存放在角色条目里，不带版本号就无法判断别处是否刚改过这张卡，可能静默覆盖他人改动。",
      "重新载入角色卡后再操作。",
    ));
  }
  return value;
}

function labelList(keys: readonly CharacterVoiceFieldKey[]): string {
  return keys.map((key) => getVoiceFieldMeta(key).label).join("、");
}

function cardFromEntry(entry: StoryJingweiEntryRecord): CharacterCardSource {
  return { name: entry.title, aliases: entry.aliases, fields: entry.fields, contentMd: entry.contentMd };
}

function isCharacterEntry(entry: StoryJingweiEntryRecord): boolean {
  return normalizeCategory(entry.category).category === "characters";
}

function readVoice(entry: StoryJingweiEntryRecord): CharacterVoice {
  try {
    return parseCharacterVoice(entry.fields.voice);
  } catch (error) {
    if (error instanceof CharacterVoiceError) {
      throw new VoiceRouteError(422, error.code, error.message, explain(
        `角色「${entry.title}」的声线数据格式损坏：${error.message}`,
        "损坏的声线既不能安全注入写作，也不能被新草稿直接覆盖，否则会丢掉原有内容。",
        "在经纬条目的「历史」里恢复到上一个正常版本后再生成或编辑声线。",
      ));
    }
    throw error;
  }
}

function serializeVoiceResponse(entry: StoryJingweiEntryRecord, voice: CharacterVoice) {
  return {
    entryId: entry.id,
    name: entry.title,
    version: entry.version,
    voice: serializeCharacterVoice(voice),
    summary: summarizeCharacterVoice(voice),
  };
}

function sendError(c: Context, error: unknown) {
  if (error instanceof VoiceRouteError) {
    return c.json({ error: error.message, code: error.code, explanation: error.explanation }, error.status);
  }
  if (error instanceof CharacterVoiceError) {
    return c.json({ error: error.message, code: error.code, explanation: explain(
      error.message,
      "声线字段有长度与形态约束，非法内容会破坏写对白时的约束文本。",
      "按提示修改该字段后再保存（文本不超过 400 字，列表每项不超过 80 字、最多 12 项）。",
    ) }, 400);
  }
  throw error;
}

async function resolveStorage(options: CreateCharacterVoiceRouterOptions): Promise<StorageDatabase> {
  return options.storage ?? getStorageDatabase();
}

async function loadCharacterEntry(storage: StorageDatabase, bookId: string, entryId: string): Promise<StoryJingweiEntryRecord> {
  if (!isSafeBookId(bookId)) {
    throw new VoiceRouteError(400, "INVALID_BOOK_ID", `书籍 ID 不合法：${bookId}`, explain(
      "请求里的书籍 ID 含非法字符。", "非法 ID 可能指向书籍目录之外。", "从作品列表重新打开这本书。",
    ));
  }
  const book = await createBookRepository(storage).getById(bookId);
  if (!book) {
    throw new VoiceRouteError(404, "BOOK_NOT_FOUND", `找不到书籍：${bookId}`, explain(
      "产品库里没有这本书。", "没有书籍记录就无法定位它的经纬角色。", "确认书籍绑定正常，必要时在「我的作品」重新校验。",
    ));
  }
  const entry = await createStoryJingweiEntryRepository(storage).getById(bookId, entryId);
  if (!entry) {
    throw new VoiceRouteError(404, "JINGWEI_ENTRY_NOT_FOUND", `找不到经纬条目：${entryId}`, explain(
      "这张角色卡已被删除或不属于这本书。", "声线只能挂在本书现存的角色条目上。", "刷新经纬列表后重新打开角色卡。",
    ));
  }
  if (!isCharacterEntry(entry)) {
    throw new VoiceRouteError(400, "CHARACTER_VOICE_NOT_CHARACTER", `条目「${entry.title}」不是角色，不能设置声线。`, explain(
      `条目分类是「${entry.category}」，不是角色。`, "声线属于角色设定，挂在其他分类上不会被写作使用。", "把条目移到「角色」分类后再设置声线。",
    ));
  }
  return entry;
}

function assertVersion(entry: StoryJingweiEntryRecord, expectedVersion: number): void {
  if (entry.version === expectedVersion) return;
  throw new VoiceRouteError(409, "CHARACTER_VOICE_CONFLICT", "角色卡已在别处更新，请重新载入后再操作。", explain(
    `提交时的版本是 ${expectedVersion}，角色卡当前版本是 ${entry.version}。`,
    "直接写入会覆盖刚才别处（角色卡保存、叙述者或其他窗口）对这张卡的修改。",
    "点「重新载入」取回最新声线，再重新确认或生成。",
  ));
}

function readSampleList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .flatMap((item) => item.split(/\n+/u))
    .map(cleanDialogueLine)
    .filter(Boolean)
    .slice(0, MAX_REQUEST_SAMPLES);
}

function readScanChapters(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return 0;
  return Math.min(value, MAX_SCAN_CHAPTERS);
}

async function scanChapterDialogue(input: {
  bookRoot: string;
  chapters: number;
  entry: StoryJingweiEntryRecord;
  otherNames: readonly string[];
}): Promise<{ lines: string[]; scannedChapters: number }> {
  const files = (await listChapterFiles(input.bookRoot)).slice(-input.chapters);
  const names = [input.entry.title, ...input.entry.aliases];
  const lines: string[] = [];
  for (const file of files) {
    const content = await readFile(join(input.bookRoot, file.relativePath), "utf8").catch(() => "");
    if (!content) continue;
    lines.push(...extractCharacterDialogue(content, { names, otherNames: input.otherNames, limit: 30 }));
  }
  return { lines: [...new Set(lines)].slice(0, MAX_REQUEST_SAMPLES), scannedChapters: files.length };
}

function parseFieldUpdates(value: unknown): Partial<Record<CharacterVoiceFieldKey, VoiceFieldUpdate>> {
  const raw = bodyRecord(value);
  const keys = Object.keys(raw);
  if (keys.length === 0) {
    throw new VoiceRouteError(400, "CHARACTER_VOICE_INVALID", "没有要保存的声线字段。", explain(
      "请求里的 fields 为空。", "空保存不会改变任何内容，却会让人误以为已确认。", "至少提交一个字段的值与状态。",
    ));
  }
  const updates: Partial<Record<CharacterVoiceFieldKey, VoiceFieldUpdate>> = {};
  for (const key of keys) {
    if (!(CHARACTER_VOICE_FIELD_KEYS as readonly string[]).includes(key)) {
      throw new VoiceRouteError(400, "CHARACTER_VOICE_INVALID", `未知的声线字段：${key}`, explain(
        `字段「${key}」不在声线定义里。`, "未定义的字段不会被写作使用，存进去只会变成死数据。", "只提交声线面板列出的字段。",
      ));
    }
    const item = bodyRecord(raw[key]);
    const status = item.status === "needs-review" ? "needs-review" : item.status === "confirmed" ? "confirmed" : null;
    if (!status || (typeof item.value !== "string" && !Array.isArray(item.value))) {
      throw new VoiceRouteError(400, "CHARACTER_VOICE_INVALID", `${getVoiceFieldMeta(key as CharacterVoiceFieldKey).label}的提交格式不对。`, explain(
        "字段必须带 value（文本或列表）与 status（confirmed / needs-review）。",
        "缺状态就无法区分作者确认与机器草稿。",
        "按面板提供的格式重新提交。",
      ));
    }
    updates[key as CharacterVoiceFieldKey] = { value: item.value as string | string[], status };
  }
  return updates;
}

function statsSummary(stats: DialogueVoiceStats | null) {
  if (!stats) return null;
  return {
    lineCount: stats.lineCount,
    sentenceCount: stats.sentenceCount,
    avgSentenceLength: stats.avgSentenceLength,
    shortSentenceRatio: stats.shortSentenceRatio,
    longSentenceRatio: stats.longSentenceRatio,
    questionRatio: stats.questionRatio,
    exclamationRatio: stats.exclamationRatio,
  };
}

type UnavailableGeneration = Extract<HostTextGenerationAvailability, { available: false }>;

async function resolveVoiceGenerator(
  options: CreateCharacterVoiceRouterOptions,
  c: Context,
  bookId: string,
): Promise<{ generateText?: CharacterVoiceGenerateText; unavailable?: UnavailableGeneration }> {
  if (options.resolveTextGeneration) {
    const generation = await options.resolveTextGeneration(c).catch((error): UnavailableGeneration => ({
      available: false,
      code: "MODEL_STATUS_FAILED",
      message: `读取模型配置失败：${error instanceof Error ? error.message : String(error)}。`,
      suggestedAction: "稍后重试；若反复失败，检查设置里的模型与供应商配置。",
    }));
    if (!generation.available) return { unavailable: generation };
    const generate = generation.generateText;
    return {
      generateText: async (request) => {
        const result = await generate(request);
        return { text: result.text, ...(result.outputTruncated ? { outputTruncated: true } : {}) };
      },
    };
  }
  return { generateText: options.resolveGenerateText ? await options.resolveGenerateText(c, bookId) : undefined };
}

/** 这次草稿里模型增补的结局，决定失败与缺字段提示怎么说。 */
type VoiceModelStatus = "not-requested" | "unavailable" | "failed" | "applied";

/** 模型增补失败：按失败类别如实说明发生了什么、该怎么办。 */
function modelFailureWarning(outcome: VoiceModelOutcome): CharacterVoiceWarning {
  const reason = outcome.reason ?? "未知原因";
  switch (outcome.failureKind) {
    case "truncated":
      return { code: "MODEL_OUTPUT_TRUNCATED", message: "模型输出被截断，这次增补没有写入，已保留规则初稿。", explanation: explain(
        `${reason}（思考型模型的推理过程也占用输出额度。）`,
        "截断的输出缺后半部分字段，硬拼进去会把半截内容当成声线，所以一律不写入；规则初稿照常保存。",
        modelJsonFailureAdvice("truncated"),
      ) };
    case "no-json":
      return { code: "MODEL_OUTPUT_NO_JSON", message: "模型没有按要求给出 JSON，这次增补没有写入，已保留规则初稿。", explanation: explain(
        reason,
        "声线字段必须逐项带原文依据才能核对，不是 JSON 的回答无法逐项核对，所以一律不写入。",
        modelJsonFailureAdvice("no-json"),
      ) };
    case "invalid":
      return { code: "MODEL_OUTPUT_INVALID", message: "模型给出的 JSON 格式有误，这次增补没有写入，已保留规则初稿。", explanation: explain(
        `${reason}（已尝试修补字符串里未转义的引号等常见问题，仍无法解析。）`,
        "格式错误的输出无法可靠地拆成字段，猜着解析会写错内容，所以一律不写入；规则初稿照常保存。",
        modelJsonFailureAdvice("invalid"),
      ) };
    case "invalid-shape":
      return { code: "MODEL_OUTPUT_INVALID", message: "模型输出的结构不对，这次增补没有写入，已保留规则初稿。", explanation: explain(
        reason,
        "结构不对就无法把内容对应到具体的声线字段，猜着对应会张冠李戴。",
        modelJsonFailureAdvice("invalid"),
      ) };
    case "call-failed":
    default:
      return { code: "MODEL_FAILED", message: "模型调用失败，这次增补没有写入，已保留规则初稿。", explanation: explain(
        `模型调用失败：${reason}。`,
        "失败时不写入任何模型内容，规则初稿照常保存。",
        "稍后重试；反复失败时检查设置里的模型与供应商配置，或换一个模型。",
      ) };
  }
}

/** 仍待补充的字段：按模型增补的结局说清楚为什么空着，不把「模型失败」说成「材料里没有依据」。 */
function missingFieldsWarning(keys: readonly CharacterVoiceFieldKey[], modelStatus: VoiceModelStatus): CharacterVoiceWarning {
  const labels = labelList(keys);
  const why = "待补充的字段不会注入写作；写对白时这些方面只按角色卡性格自然处理。";
  switch (modelStatus) {
    case "failed":
      return { code: "FIELDS_MISSING", message: `「${labels}」仍待补充：这次模型增补失败，没能生成。`, explanation: explain(
        "规则初稿只能从角色卡原句与对白统计里提取，这些字段没提取到；本该由模型归纳补上，但这次模型增补失败（原因见上一条提示），所以仍空着。这不代表角色卡和对白里没有依据。",
        why,
        "重新点「生成草稿」重试模型增补；反复失败时在设置里换一个模型，或直接手填。",
      ) };
    case "unavailable":
      return { code: "FIELDS_MISSING", message: `「${labels}」仍待补充。`, explanation: explain(
        "规则初稿只从角色卡原句与对白统计里提取，这些方面没有找到直接依据；当前没有可用模型，没有做模型增补。",
        why,
        "配置可用模型后再请模型增补，或直接手填。",
      ) };
    case "not-requested":
      return { code: "FIELDS_MISSING", message: `「${labels}」仍待补充。`, explanation: explain(
        "规则初稿只从角色卡原句与对白统计里提取，这些方面没有找到直接依据，没有编造。",
        why,
        "打开「请模型增补」让模型从角色卡与对白里归纳，或补充角色卡 / 对白样本后重新生成；也可以直接手填。",
      ) };
    case "applied":
      return { code: "FIELDS_MISSING", message: `「${labels}」仍待补充。`, explanation: explain(
        "角色卡与对白样本里找不到这些方面的依据（规则初稿与模型增补都没找到，或模型给的摘录对不上原文已丢弃），没有编造。",
        why,
        "需要时直接手填，或补充角色卡 / 对白样本后重新生成。",
      ) };
  }
}

export function createCharacterVoiceRouter(options: CreateCharacterVoiceRouterOptions = {}): Hono {
  const app = new Hono();
  const now = options.now ?? (() => new Date());
  const base = "/api/books/:bookId/jingwei/entries/:entryId/voice";

  app.get(base, async (c) => {
    try {
      const storage = await resolveStorage(options);
      const entry = await loadCharacterEntry(storage, c.req.param("bookId"), c.req.param("entryId"));
      return c.json(serializeVoiceResponse(entry, readVoice(entry)));
    } catch (error) {
      return sendError(c, error);
    }
  });

  app.post(`${base}/draft`, async (c) => {
    try {
      const bookId = c.req.param("bookId");
      const entryId = c.req.param("entryId");
      const body = bodyRecord(await c.req.json().catch(() => null));
      const expectedVersion = readExpectedVersion(body);
      const storage = await resolveStorage(options);
      const entry = await loadCharacterEntry(storage, bookId, entryId);
      assertVersion(entry, expectedVersion);
      const existing = readVoice(entry);
      const warnings: CharacterVoiceWarning[] = [];

      const requestSamples = readSampleList(body.dialogueSamples);
      const scanChapters = readScanChapters(body.scanChapters);
      let chapterSamples: string[] = [];
      let scannedChapters = 0;
      if (scanChapters > 0) {
        if (!options.resolveBookRoot) {
          warnings.push({ code: "CHAPTER_SCAN_UNAVAILABLE", message: "当前环境无法读取正文，未从章节取对白。", explanation: explain(
            "这个接口没有接到书籍目录，扫描近章对白被跳过。",
            "只靠角色卡推出的句式指纹偏少，两个角色的对白可能区分不开。",
            "把该角色的几句代表对白粘贴到「对白样本」里再生成。",
          ) });
        } else {
          const entries = await createStoryJingweiEntryRepository(storage).listByBook(bookId);
          const otherNames = entries
            .filter((candidate) => candidate.id !== entry.id && isCharacterEntry(candidate))
            .flatMap((candidate) => [candidate.title, ...candidate.aliases]);
          const scanned = await scanChapterDialogue({ bookRoot: options.resolveBookRoot(bookId), chapters: scanChapters, entry, otherNames });
          chapterSamples = scanned.lines;
          scannedChapters = scanned.scannedChapters;
        }
      }

      const card = cardFromEntry(entry);
      const dialogueSamples = [...new Set([...requestSamples, ...chapterSamples])];
      let draft = draftCharacterVoice({ card, dialogueSamples });
      if (draft.sampleCount < MIN_DIALOGUE_LINES_FOR_STATS) {
        warnings.push({ code: "FEW_DIALOGUE_SAMPLES", message: `只找到 ${draft.sampleCount} 句该角色的对白，句式指纹暂不统计。`, explanation: explain(
          `角色卡台词、粘贴样本${scanChapters > 0 ? `与最近 ${scannedChapters} 章正文` : ""}里一共只归到 ${draft.sampleCount} 句这个角色的对白，少于 ${MIN_DIALOGUE_LINES_FOR_STATS} 句。`,
          "句长、停顿、句尾习惯需要多句对白才能统计，样本太少时硬算会把偶然当习惯。",
          "在「对白样本」里粘贴至少 3 句该角色的原话，或在角色卡「经典台词」里补充后再生成。",
        ) });
      }

      let modelUsed = false;
      let modelStatus: VoiceModelStatus = "not-requested";
      if (body.useModel === true) {
        const { generateText, unavailable } = await resolveVoiceGenerator(options, c, bookId);
        if (!generateText) {
          modelStatus = "unavailable";
          warnings.push({ code: "MODEL_UNAVAILABLE", message: "当前没有可用模型，只生成了规则初稿。", explanation: explain(
            unavailable?.message ?? "这个入口没有接到可用的文本模型。",
            "规则初稿只能提取角色卡原句和对白统计，认知滤镜、情绪变化等描述性字段可能仍待补充。",
            unavailable
              ? `${unavailable.suggestedAction}也可以让叙述者读取角色卡后协助补充，或直接手填。`
              : "在设置里配置默认模型，或让叙述者读取角色卡后协助补充；也可以直接手填。",
          ) });
        } else {
          const lockedKeys = CHARACTER_VOICE_FIELD_KEYS.filter((key) => existing.fields[key].status === "confirmed");
          const enriched = await enrichCharacterVoiceWithModel({ card, dialogueSamples, draft, lockedKeys, generateText });
          if (enriched.outcome.status === "failed") {
            modelStatus = "failed";
            warnings.push(modelFailureWarning(enriched.outcome));
          } else {
            modelStatus = "applied";
            modelUsed = true;
            draft = enriched.draft;
            if (enriched.outcome.rejectedKeys.length > 0) {
              warnings.push({ code: "MODEL_EVIDENCE_REJECTED", message: `模型给出的「${labelList(enriched.outcome.rejectedKeys)}」找不到原文依据，已丢弃。`, explanation: explain(
                "这些字段附带的摘录在角色卡和对白样本里都找不到。",
                "没有原文依据的声线属于模型自行发挥，写进约束会让角色说出作者没设定过的话。",
                "如确有此特征，请在角色卡或对白样本里补上原文后重新生成，或直接手填。",
              ) });
            }
          }
        }
      }

      // 生成可能耗时：写入前以最新条目为准再核一次版本，并基于最新声线合并。
      const latest = await loadCharacterEntry(storage, bookId, entryId);
      assertVersion(latest, expectedVersion);
      const merged = mergeVoiceDraft(readVoice(latest), draft, now());
      let saved = latest;
      if (merged.appliedKeys.length > 0) {
        const updated = await createStoryJingweiEntryRepository(storage).update(bookId, entryId, {
          fieldsPatch: { voice: serializeCharacterVoice(merged.voice) },
          source: "ai-enrich",
          revisionReason: "character-voice-draft",
          changedBy: "character-voice",
          updatedAt: now(),
        });
        if (!updated) throw new VoiceRouteError(404, "JINGWEI_ENTRY_NOT_FOUND", `找不到经纬条目：${entryId}`, explain(
          "写入时角色卡已被删除。", "条目不存在时草稿无处存放。", "刷新经纬列表后重新打开角色卡。",
        ));
        saved = updated;
      }
      const summary = summarizeCharacterVoice(merged.voice);
      if (summary.missing > 0) warnings.push(missingFieldsWarning(summary.missingKeys, modelStatus));
      return c.json({
        ...serializeVoiceResponse(saved, merged.voice),
        draft: {
          appliedKeys: merged.appliedKeys,
          keptConfirmedKeys: merged.keptConfirmedKeys,
          sampleCount: draft.sampleCount,
          chapterSampleCount: chapterSamples.length,
          scannedChapters,
          modelUsed,
          /** not-requested / unavailable / failed / applied */
          modelStatus,
          stats: statsSummary(draft.stats),
        },
        warnings,
      });
    } catch (error) {
      return sendError(c, error);
    }
  });

  app.put(base, async (c) => {
    try {
      const bookId = c.req.param("bookId");
      const entryId = c.req.param("entryId");
      const body = bodyRecord(await c.req.json().catch(() => null));
      const expectedVersion = readExpectedVersion(body);
      const updates = parseFieldUpdates(body.fields);
      const storage = await resolveStorage(options);
      const entry = await loadCharacterEntry(storage, bookId, entryId);
      assertVersion(entry, expectedVersion);
      const next = applyVoiceFieldUpdates(readVoice(entry), updates, now());
      const updated = await createStoryJingweiEntryRepository(storage).update(bookId, entryId, {
        fieldsPatch: { voice: serializeCharacterVoice(next) },
        source: "user",
        revisionReason: "character-voice-confirm",
        changedBy: "user",
        updatedAt: now(),
      });
      if (!updated) throw new VoiceRouteError(404, "JINGWEI_ENTRY_NOT_FOUND", `找不到经纬条目：${entryId}`, explain(
        "写入时角色卡已被删除。", "条目不存在时声线无处存放。", "刷新经纬列表后重新打开角色卡。",
      ));
      return c.json(serializeVoiceResponse(updated, next));
    } catch (error) {
      return sendError(c, error);
    }
  });

  return app;
}
