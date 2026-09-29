/**
 * 角色声线（T2.3）——纯函数模块。
 *
 * 权威源：经纬角色条目 `fields_json.voice`。声线是角色「当前设定」的一部分，
 * 不另建文件或表；本模块只负责校验、确定性初稿、模型增补与写对白约束文本。
 *
 * 纪律：
 * - 只从角色卡已有内容与该角色的对白样本**提取**，不创造；依据不足的字段标「待补充」。
 * - 机器产物（规则初稿、模型增补）一律 status=needs-review，作者逐项确认后才进入写作约束。
 * - 模型给出的每个字段必须附带能在材料里原样找到的摘录，否则丢弃。
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// 字段定义
// ---------------------------------------------------------------------------

export const CHARACTER_VOICE_FIELD_KEYS = [
  "positioning",
  "sentenceLength",
  "catchphrases",
  "pauses",
  "signaturePatterns",
  "cognitiveFilter",
  "forbiddenPatterns",
  "underAnger",
  "underTension",
  "whenLying",
] as const;

export type CharacterVoiceFieldKey = (typeof CHARACTER_VOICE_FIELD_KEYS)[number];

export interface CharacterVoiceFieldMeta {
  readonly key: CharacterVoiceFieldKey;
  readonly label: string;
  readonly kind: "text" | "list";
  /** 分组：声音定位 / 句式指纹 / 认知滤镜 / 禁区 / 情绪变化 */
  readonly group: "positioning" | "fingerprint" | "cognition" | "forbidden" | "emotion";
  readonly hint: string;
}

export const CHARACTER_VOICE_FIELD_META: readonly CharacterVoiceFieldMeta[] = [
  { key: "positioning", label: "声音定位", kind: "text", group: "positioning", hint: "一句话说清这个人开口是什么感觉，如：话少、语气平、爱用反问压人。" },
  { key: "sentenceLength", label: "长短句倾向", kind: "text", group: "fingerprint", hint: "短句为主、长句铺陈，还是长短混用。" },
  { key: "catchphrases", label: "口头禅", kind: "list", group: "fingerprint", hint: "反复出现的词或语气词，每行一个。" },
  { key: "pauses", label: "停顿习惯", kind: "text", group: "fingerprint", hint: "省略号吞半句、破折号打断、逗号一顿一顿等。" },
  { key: "signaturePatterns", label: "常用句式", kind: "list", group: "fingerprint", hint: "如：句尾常带「吧」、爱用反问收尾，每行一条。" },
  { key: "cognitiveFilter", label: "认知滤镜", kind: "text", group: "cognition", hint: "他用什么尺子看人看事，决定他先注意到什么、怎么评价。" },
  { key: "forbiddenPatterns", label: "绝不会说的句式", kind: "list", group: "forbidden", hint: "这个人嘴里绝不会出现的说法，每行一条。" },
  { key: "underAnger", label: "愤怒时", kind: "text", group: "emotion", hint: "生气时语言怎么变。" },
  { key: "underTension", label: "紧张时", kind: "text", group: "emotion", hint: "紧张、心虚、害怕时语言怎么变。" },
  { key: "whenLying", label: "撒谎时", kind: "text", group: "emotion", hint: "说谎时有什么破绽或习惯。" },
];

const META_BY_KEY = new Map(CHARACTER_VOICE_FIELD_META.map((meta) => [meta.key, meta] as const));

export function getVoiceFieldMeta(key: CharacterVoiceFieldKey): CharacterVoiceFieldMeta {
  return META_BY_KEY.get(key)!;
}

/** 缺字段时展示给作者与模型的统一占位文案。 */
export const VOICE_MISSING_LABEL = "待补充";

const TEXT_MAX = 400;
const LIST_ITEM_MAX = 80;
const LIST_MAX = 12;
const EVIDENCE_MAX = 200;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const CharacterVoiceFieldStatusSchema = z.enum(["missing", "needs-review", "confirmed"]);
export type CharacterVoiceFieldStatus = z.infer<typeof CharacterVoiceFieldStatusSchema>;

/** card=角色卡原文，dialogue=对白统计，model=模型增补，author=作者手填或改写 */
export const CharacterVoiceFieldSourceSchema = z.enum(["card", "dialogue", "model", "author"]);
export type CharacterVoiceFieldSource = z.infer<typeof CharacterVoiceFieldSourceSchema>;

export const CharacterVoiceFieldSchema = z.object({
  value: z.union([z.string().max(TEXT_MAX), z.array(z.string().trim().min(1).max(LIST_ITEM_MAX)).max(LIST_MAX)]),
  status: CharacterVoiceFieldStatusSchema,
  source: CharacterVoiceFieldSourceSchema.optional(),
  evidence: z.array(z.string().trim().min(1).max(EVIDENCE_MAX)).max(5).optional(),
  updatedAt: z.string().optional(),
}).strict();

export type CharacterVoiceField = z.infer<typeof CharacterVoiceFieldSchema>;

const voiceFieldsShape = Object.fromEntries(
  CHARACTER_VOICE_FIELD_KEYS.map((key) => [key, CharacterVoiceFieldSchema.optional()]),
) as Record<CharacterVoiceFieldKey, z.ZodOptional<typeof CharacterVoiceFieldSchema>>;

/** 存储形态：字段可缺省（读取时补成「待补充」），便于以后增删字段。 */
export const StoredCharacterVoiceSchema = z.object({
  schemaVersion: z.literal(1),
  fields: z.object(voiceFieldsShape).strict(),
}).strict().superRefine((voice, ctx) => {
  for (const key of CHARACTER_VOICE_FIELD_KEYS) {
    const field = voice.fields[key];
    if (!field) continue;
    const meta = getVoiceFieldMeta(key);
    const isList = Array.isArray(field.value);
    if ((meta.kind === "list") !== isList) {
      ctx.addIssue({ code: "custom", path: ["fields", key, "value"], message: `${meta.label}的值形态不对（应为${meta.kind === "list" ? "列表" : "文本"}）` });
      continue;
    }
    const empty = isEmptyValue(field.value);
    if (field.status === "missing" && !empty) {
      ctx.addIssue({ code: "custom", path: ["fields", key, "status"], message: `${meta.label}有内容却标为待补充` });
    }
    if (field.status !== "missing" && empty) {
      ctx.addIssue({ code: "custom", path: ["fields", key, "status"], message: `${meta.label}为空却标为${field.status === "confirmed" ? "已确认" : "待审"}` });
    }
  }
});

export interface CharacterVoice {
  readonly schemaVersion: 1;
  readonly fields: Readonly<Record<CharacterVoiceFieldKey, CharacterVoiceField>>;
}

export class CharacterVoiceError extends Error {
  constructor(message: string, readonly code: "CHARACTER_VOICE_CORRUPTED" | "CHARACTER_VOICE_INVALID") {
    super(message);
    this.name = "CharacterVoiceError";
  }
}

function isEmptyValue(value: string | readonly string[]): boolean {
  return Array.isArray(value) ? value.length === 0 : (value as string).trim().length === 0;
}

function emptyField(key: CharacterVoiceFieldKey): CharacterVoiceField {
  return { value: getVoiceFieldMeta(key).kind === "list" ? [] : "", status: "missing" };
}

export function createEmptyCharacterVoice(): CharacterVoice {
  return {
    schemaVersion: 1,
    fields: Object.fromEntries(CHARACTER_VOICE_FIELD_KEYS.map((key) => [key, emptyField(key)])) as Record<CharacterVoiceFieldKey, CharacterVoiceField>,
  };
}

/**
 * 读取条目 fields.voice。缺失视为全部待补充；形态非法抛 CORRUPTED，
 * 调用方不得静默覆盖（坏数据由作者从条目历史恢复）。
 */
export function parseCharacterVoice(raw: unknown): CharacterVoice {
  if (raw === undefined || raw === null) return createEmptyCharacterVoice();
  const parsed = StoredCharacterVoiceSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new CharacterVoiceError(`角色声线数据无法解析：${first?.message ?? "格式不符"}`, "CHARACTER_VOICE_CORRUPTED");
  }
  const fields = {} as Record<CharacterVoiceFieldKey, CharacterVoiceField>;
  for (const key of CHARACTER_VOICE_FIELD_KEYS) fields[key] = parsed.data.fields[key] ?? emptyField(key);
  return { schemaVersion: 1, fields };
}

/** 序列化为存储形态（去掉未设置的可选键，保持 fields_json 紧凑）。 */
export function serializeCharacterVoice(voice: CharacterVoice): z.infer<typeof StoredCharacterVoiceSchema> {
  const fields: Partial<Record<CharacterVoiceFieldKey, CharacterVoiceField>> = {};
  for (const key of CHARACTER_VOICE_FIELD_KEYS) {
    const field = voice.fields[key];
    fields[key] = {
      value: field.value,
      status: field.status,
      ...(field.source ? { source: field.source } : {}),
      ...(field.evidence && field.evidence.length > 0 ? { evidence: [...field.evidence] } : {}),
      ...(field.updatedAt ? { updatedAt: field.updatedAt } : {}),
    };
  }
  const stored = { schemaVersion: 1 as const, fields };
  const checked = StoredCharacterVoiceSchema.safeParse(stored);
  if (!checked.success) {
    throw new CharacterVoiceError(`角色声线不合法：${checked.error.issues[0]?.message ?? "格式不符"}`, "CHARACTER_VOICE_INVALID");
  }
  return checked.data;
}

export interface CharacterVoiceSummary {
  readonly confirmed: number;
  readonly needsReview: number;
  readonly missing: number;
  readonly missingKeys: readonly CharacterVoiceFieldKey[];
}

export function summarizeCharacterVoice(voice: CharacterVoice): CharacterVoiceSummary {
  const missingKeys = CHARACTER_VOICE_FIELD_KEYS.filter((key) => voice.fields[key].status === "missing");
  return {
    confirmed: CHARACTER_VOICE_FIELD_KEYS.filter((key) => voice.fields[key].status === "confirmed").length,
    needsReview: CHARACTER_VOICE_FIELD_KEYS.filter((key) => voice.fields[key].status === "needs-review").length,
    missing: missingKeys.length,
    missingKeys,
  };
}

// ---------------------------------------------------------------------------
// 文本工具
// ---------------------------------------------------------------------------

const HAN_OR_WORD = /[\p{Script=Han}A-Za-z0-9]/u;

function countChars(text: string): number {
  let count = 0;
  for (const char of text) if (HAN_OR_WORD.test(char)) count += 1;
  return count;
}

function clip(text: string, max = 60): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function uniq<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

/** 去掉首尾引号与空白，得到一句对白的正文。 */
export function cleanDialogueLine(line: string): string {
  return line.trim().replace(/^[“"「『‘']+/u, "").replace(/[”"」』’']+$/u, "").trim();
}

function splitSentences(text: string): string[] {
  return text.split(/[。！？!?；;\n]+/u).map((part) => part.trim()).filter((part) => countChars(part) > 0);
}

function normalizeForMatch(text: string): string {
  return text.replace(/^【[^】]{1,8}】/u, "").replace(/[\s“”"「」『』‘’'《》【】]/gu, "");
}

// ---------------------------------------------------------------------------
// 角色卡材料
// ---------------------------------------------------------------------------

/** 草稿需要的角色卡快照（来自经纬条目，不含 voice 本身）。 */
export interface CharacterCardSource {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly fields: Readonly<Record<string, unknown>>;
  readonly contentMd?: string;
}

/** 不参与声线提取的字段：标识、出场记录与声线自身。 */
const CARD_SKIP_KEYS = new Set(["name", "aliases", "firstChapter", "appearanceLog", "voice", "classic_quotes", "category", "layer", "status", "subcategory"]);

const CARD_FIELD_LABELS: Record<string, string> = {
  personality: "性格",
  roleType: "角色定位",
  core_motive: "核心动机",
  core_fear: "最深恐惧",
  core_obsession: "执念",
  core_belief: "信奉",
  goal: "目标",
  currentState: "当前状态",
  secret: "秘密",
  relationship_summary: "羁绊",
  realm: "境界/职级",
};

function readCardString(fields: Readonly<Record<string, unknown>>, key: string): string {
  const value = fields[key];
  return typeof value === "string" ? value.trim() : "";
}

function readCardList(fields: Readonly<Record<string, unknown>>, key: string): string[] {
  const value = fields[key];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  if (typeof value === "string" && value.trim()) return value.split(/\n+/u).map((item) => item.trim()).filter(Boolean);
  return [];
}

/** 角色卡里可用于提取的文本：按「标签：原文」列出，供规则与模型共用。 */
export function collectCardMaterial(card: CharacterCardSource): { label: string; text: string }[] {
  const material: { label: string; text: string }[] = [];
  for (const [key, value] of Object.entries(card.fields)) {
    if (CARD_SKIP_KEYS.has(key) || typeof value !== "string" || !value.trim()) continue;
    material.push({ label: CARD_FIELD_LABELS[key] ?? key, text: value.trim() });
  }
  const content = (card.contentMd ?? "").trim();
  if (content) material.push({ label: "详细背景", text: content });
  return material;
}

/** 角色卡里的经典台词就是该角色的对白样本。 */
export function cardDialogueSamples(card: CharacterCardSource): string[] {
  return readCardList(card.fields, "classic_quotes").map(cleanDialogueLine).filter(Boolean);
}

// ---------------------------------------------------------------------------
// 对白统计
// ---------------------------------------------------------------------------

export const MIN_DIALOGUE_LINES_FOR_STATS = 3;

export interface DialogueVoiceStats {
  readonly lineCount: number;
  readonly sentenceCount: number;
  readonly avgSentenceLength: number;
  readonly shortSentenceRatio: number;
  readonly longSentenceRatio: number;
  readonly questionRatio: number;
  readonly exclamationRatio: number;
  readonly ellipsisPerLine: number;
  readonly dashPerLine: number;
  readonly commaPerSentence: number;
  /** 句尾语气词 → 出现句数 */
  readonly finalParticles: Readonly<Record<string, number>>;
}

const SHORT_SENTENCE = 8;
const LONG_SENTENCE = 25;
const FINAL_PARTICLES = new Set(["吧", "呢", "啊", "呀", "嘛", "啦", "哦", "哈", "嗯", "罢", "咯", "哟", "呗", "么"]);
const INTERJECTIONS = new Set(["啧", "哼", "嗯", "哦", "呵", "嘿", "喂", "唉", "哎", "呸", "切", "嗐", "嚯"]);
const COMMON_GRAMS = new Set([
  "我们", "你们", "他们", "她们", "什么", "这个", "那个", "一个", "没有", "不是", "就是", "自己", "知道", "可以", "现在",
  "怎么", "为什么", "这么", "那么", "已经", "还是", "如果", "因为", "所以", "但是", "不要", "不会", "我的", "你的", "他的",
  "她的", "是我", "是你", "我是", "你是", "我不", "你不", "这是", "那是", "一下", "一点", "的人", "了吗",
]);

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

export function analyzeDialogueSamples(samples: readonly string[]): DialogueVoiceStats | null {
  const lines = samples.map(cleanDialogueLine).filter((line) => countChars(line) > 0);
  if (lines.length === 0) return null;
  const sentences = lines.flatMap(splitSentences);
  const lengths = sentences.map(countChars);
  const sentenceCount = Math.max(1, sentences.length);
  const finalParticles: Record<string, number> = {};
  for (const sentence of sentences) {
    const stripped = sentence.replace(/[^\p{Script=Han}A-Za-z0-9]+$/u, "");
    const last = stripped.slice(-1);
    if (FINAL_PARTICLES.has(last)) finalParticles[last] = (finalParticles[last] ?? 0) + 1;
  }
  return {
    lineCount: lines.length,
    sentenceCount: sentences.length,
    avgSentenceLength: round(lengths.reduce((sum, value) => sum + value, 0) / sentenceCount, 1),
    shortSentenceRatio: round(lengths.filter((value) => value <= SHORT_SENTENCE).length / sentenceCount),
    longSentenceRatio: round(lengths.filter((value) => value >= LONG_SENTENCE).length / sentenceCount),
    questionRatio: round(lines.filter((line) => /[？?]/u.test(line)).length / lines.length),
    exclamationRatio: round(lines.filter((line) => /[！!]/u.test(line)).length / lines.length),
    ellipsisPerLine: round(lines.reduce((sum, line) => sum + countMatches(line, /……|…|\.{3,}/gu), 0) / lines.length),
    dashPerLine: round(lines.reduce((sum, line) => sum + countMatches(line, /——|--/gu), 0) / lines.length),
    commaPerSentence: round(lines.reduce((sum, line) => sum + countMatches(line, /[，,、]/gu), 0) / sentenceCount),
    finalParticles,
  };
}

/** 在多句对白里反复出现的词：至少 2 句含有（双字词至少 3 句），取最长的不重叠候选。 */
export function findRepeatedPhrases(samples: readonly string[], limit = 5): { phrase: string; lines: string[] }[] {
  const lines = samples.map(cleanDialogueLine).filter(Boolean);
  const occurrences = new Map<string, Set<number>>();
  lines.forEach((line, index) => {
    const grams = new Set<string>();
    for (const segment of line.split(/[^\p{Script=Han}]+/u)) {
      for (let size = 2; size <= 6; size += 1) {
        for (let start = 0; start + size <= segment.length; start += 1) grams.add(segment.slice(start, start + size));
      }
    }
    // 句首感叹词（啧、哼……）单字也算口癖。
    const first = line.match(/^\p{Script=Han}/u)?.[0];
    if (first && INTERJECTIONS.has(first)) grams.add(first);
    for (const gram of grams) {
      const set = occurrences.get(gram) ?? new Set<number>();
      set.add(index);
      occurrences.set(gram, set);
    }
  });
  const candidates = [...occurrences.entries()]
    .map(([phrase, set]) => ({ phrase, count: set.size, indexes: [...set] }))
    .filter(({ phrase, count }) => {
      if (count < 2 || COMMON_GRAMS.has(phrase)) return false;
      if (phrase.length === 1) return INTERJECTIONS.has(phrase);
      if (phrase.length === 2) return count >= 3;
      return true;
    })
    .sort((left, right) => right.phrase.length - left.phrase.length || right.count - left.count);
  const accepted: typeof candidates = [];
  for (const candidate of candidates) {
    const covered = accepted.some((longer) => longer.phrase.includes(candidate.phrase) && longer.count >= candidate.count);
    if (!covered) accepted.push(candidate);
  }
  return accepted
    .sort((left, right) => right.count - left.count || right.phrase.length - left.phrase.length)
    .slice(0, limit)
    .map(({ phrase, indexes }) => ({ phrase, lines: indexes.slice(0, 2).map((index) => clip(lines[index]!)) }));
}

// ---------------------------------------------------------------------------
// 确定性初稿
// ---------------------------------------------------------------------------

export interface VoiceDraftField {
  readonly value: string | readonly string[];
  readonly source: Exclude<CharacterVoiceFieldSource, "author">;
  readonly evidence: readonly string[];
}

export interface CharacterVoiceDraft {
  readonly fields: Partial<Record<CharacterVoiceFieldKey, VoiceDraftField>>;
  readonly stats: DialogueVoiceStats | null;
  readonly sampleCount: number;
}

/** 性格描述里与「怎么说话」直接相关的词 → 声音线索。只收说话层面的，不做性格推演。 */
const SPEECH_TRAIT_CUES: readonly { pattern: RegExp; cue: string }[] = [
  { pattern: /寡言|沉默|话少|少言|不爱说话|惜字如金/u, cue: "话少，能短则短" },
  { pattern: /话多|话痨|絮叨|啰嗦|唠叨/u, cue: "话多，爱絮叨" },
  { pattern: /毒舌|刻薄|尖酸|嘴毒|损人/u, cue: "说话带刺，惯于挖苦" },
  { pattern: /温和|温柔|和气|随和|温润/u, cue: "语气温和，少说重话" },
  { pattern: /直爽|直率|豪爽|心直口快|快人快语/u, cue: "直来直去，不绕弯子" },
  { pattern: /冷淡|冷漠|高冷|清冷/u, cue: "语气冷淡，少带情绪词" },
  { pattern: /傲慢|倨傲|自负|狂妄/u, cue: "居高临下，惯用断言和命令" },
  { pattern: /圆滑|世故|八面玲珑|滴水不漏/u, cue: "说话圆滑，留余地" },
  { pattern: /腼腆|害羞|内向|怯懦/u, cue: "说话犹豫，常半句收住" },
  { pattern: /暴躁|易怒|火爆|脾气大/u, cue: "语气冲，一急就拔高" },
  { pattern: /嘴硬|傲娇|口是心非/u, cue: "嘴硬，好话反着说" },
  { pattern: /幽默|诙谐|贫嘴|油嘴滑舌|爱开玩笑/u, cue: "爱开玩笑、贫嘴" },
  { pattern: /严谨|一丝不苟|较真|刻板/u, cue: "用词讲究准确，爱较真" },
];

const EXPLICIT_VOICE = /说话|语气|口吻|嗓音|谈吐|措辞|开口|腔调|说起话/u;
const EXPLICIT_COGNITION = /看待|眼里|在他看来|在她看来|总觉得|习惯先|凡事|第一反应/u;
const EXPLICIT_FORBIDDEN = /(从不|绝不|从来不|不会|不肯|不屑|从没)[^。！？\n]{0,6}(说|讲|叫|称呼|开口|骂|求|道歉|认错)/u;
const EXPLICIT_ANGER = /(生气|愤怒|发怒|动怒|发火|恼怒|怒极|暴怒)[^。！？\n]{0,3}(时|的时候|起来|之下)/u;
const EXPLICIT_TENSION = /(紧张|慌|害怕|心虚|局促|不安|窘迫)[^。！？\n]{0,3}(时|的时候|起来|之下)/u;
const EXPLICIT_LYING = /(撒谎|说谎|扯谎|骗人|编瞎话|说假话)[^。！？\n]{0,3}(时|的时候|前|之前)/u;
const CATCHPHRASE_DECLARATION = /口头禅[是为：:\s]*[“"「『]([^”"」』]{1,20})[”"」』]/gu;

function cardSentences(card: CharacterCardSource): { label: string; sentence: string }[] {
  return collectCardMaterial(card).flatMap(({ label, text }) => splitSentences(text).map((sentence) => ({ label, sentence })));
}

function evidenceLine(label: string, text: string): string {
  return clip(`${label}：${text}`, EVIDENCE_MAX);
}

function pickSentences(sentences: { label: string; sentence: string }[], pattern: RegExp, limit: number) {
  return sentences.filter(({ sentence }) => pattern.test(sentence)).slice(0, limit);
}

function describeSentenceLength(stats: DialogueVoiceStats): string {
  const avg = stats.avgSentenceLength;
  const shortPct = Math.round(stats.shortSentenceRatio * 100);
  const longPct = Math.round(stats.longSentenceRatio * 100);
  if (stats.shortSentenceRatio >= 0.6) return `短句为主：对白平均每句 ${avg} 字，${SHORT_SENTENCE} 字以内的短句占 ${shortPct}%`;
  if (stats.longSentenceRatio >= 0.35 || avg >= 20) return `长句偏多：对白平均每句 ${avg} 字，${LONG_SENTENCE} 字以上的长句占 ${longPct}%`;
  return `长短句混用：对白平均每句 ${avg} 字（短句 ${shortPct}%，长句 ${longPct}%）`;
}

function describePauses(stats: DialogueVoiceStats): string {
  const parts: string[] = [];
  if (stats.ellipsisPerLine >= 0.3) parts.push(`常用省略号吞半句（平均每句对白 ${stats.ellipsisPerLine} 处）`);
  if (stats.dashPerLine >= 0.2) parts.push(`常用破折号打断或转折（平均每句对白 ${stats.dashPerLine} 处）`);
  if (stats.commaPerSentence >= 2) parts.push("逗号多，一句话断成几截说");
  if (parts.length === 0 && stats.lineCount >= 5 && stats.ellipsisPerLine === 0 && stats.dashPerLine === 0) {
    parts.push("对白里几乎不用省略号和破折号，话说得干脆");
  }
  return parts.join("；");
}

function linesMatching(samples: readonly string[], test: (line: string) => boolean): string[] {
  return samples.map(cleanDialogueLine).filter(test).slice(0, 2).map((line) => clip(line));
}

/**
 * 确定性初稿：角色卡原句 + 对白统计。依据不足的字段不出现在结果里（即「待补充」）。
 * dialogueSamples 应只包含该角色本人的对白；角色卡的经典台词会自动并入。
 */
export function draftCharacterVoice(input: {
  readonly card: CharacterCardSource;
  readonly dialogueSamples?: readonly string[];
}): CharacterVoiceDraft {
  const samples = uniq([...cardDialogueSamples(input.card), ...(input.dialogueSamples ?? []).map(cleanDialogueLine)]).filter((line) => countChars(line) > 0);
  const sentences = cardSentences(input.card);
  const fields: Partial<Record<CharacterVoiceFieldKey, VoiceDraftField>> = {};

  // 声音定位：先取角色卡里直接描述说话方式的原句，其次取性格里的说话线索。
  // 情绪变化与禁区句另有字段承接，不重复算进声音定位。
  const situational = [EXPLICIT_ANGER, EXPLICIT_TENSION, EXPLICIT_LYING, EXPLICIT_FORBIDDEN];
  const explicitVoice = pickSentences(
    sentences.filter(({ sentence }) => !situational.some((pattern) => pattern.test(sentence))),
    EXPLICIT_VOICE,
    2,
  );
  if (explicitVoice.length > 0) {
    fields.positioning = {
      value: clip(explicitVoice.map(({ sentence }) => sentence).join("；"), TEXT_MAX),
      source: "card",
      evidence: explicitVoice.map(({ label, sentence }) => evidenceLine(label, sentence)),
    };
  } else {
    const traitText = [readCardString(input.card.fields, "personality"), readCardString(input.card.fields, "roleType")].filter(Boolean).join("；");
    const matched = SPEECH_TRAIT_CUES.filter(({ pattern }) => pattern.test(traitText));
    if (matched.length > 0) {
      const evidence = uniq(matched.map(({ pattern }) => traitText.match(pattern)?.[0] ?? "").filter(Boolean));
      fields.positioning = {
        value: matched.slice(0, 3).map(({ cue }) => cue).join("；"),
        source: "card",
        evidence: [evidenceLine("性格", evidence.join("、"))],
      };
    }
  }

  const stats = samples.length >= MIN_DIALOGUE_LINES_FOR_STATS ? analyzeDialogueSamples(samples) : null;
  if (stats) {
    fields.sentenceLength = {
      value: describeSentenceLength(stats),
      source: "dialogue",
      evidence: samples.slice(0, 2).map((line) => clip(line)),
    };
    const pauses = describePauses(stats);
    if (pauses) {
      fields.pauses = {
        value: pauses,
        source: "dialogue",
        evidence: (() => {
          const matched = linesMatching(samples, (line) => /……|…|——|，.*，/u.test(line));
          // 「几乎不停顿」这类结论以普通对白为证。
          return matched.length > 0 ? matched : samples.slice(0, 2).map((line) => clip(line));
        })(),
      };
    }
  }

  // 口头禅：角色卡里明写的「口头禅是『……』」优先，其次是对白里反复出现的词。
  const declared: string[] = [];
  const declaredEvidence: string[] = [];
  for (const { label, text } of collectCardMaterial(input.card)) {
    for (const match of text.matchAll(CATCHPHRASE_DECLARATION)) {
      declared.push(match[1]!.trim());
      declaredEvidence.push(evidenceLine(label, match[0]));
    }
  }
  const repeated = samples.length >= 2 ? findRepeatedPhrases(samples) : [];
  const catchphrases = uniq([...declared, ...repeated.map(({ phrase }) => phrase)]).slice(0, 6);
  if (catchphrases.length > 0) {
    fields.catchphrases = {
      value: catchphrases,
      source: declared.length > 0 ? "card" : "dialogue",
      evidence: [...declaredEvidence, ...repeated.flatMap(({ lines }) => lines)].slice(0, 3),
    };
  }

  // 常用句式：句尾语气词、问句 / 感叹句占比，都需要足够的对白。
  if (stats) {
    const patterns: string[] = [];
    const patternEvidence: string[] = [];
    for (const [particle, count] of Object.entries(stats.finalParticles).sort((left, right) => right[1] - left[1])) {
      if (count >= 2 && count / Math.max(1, stats.sentenceCount) >= 0.25) {
        patterns.push(`句尾常带「${particle}」`);
        patternEvidence.push(...linesMatching(samples, (line) => line.includes(particle)));
      }
    }
    if (stats.questionRatio >= 0.4) {
      patterns.push(`常以问句或反问说话（${Math.round(stats.questionRatio * 100)}% 的对白带问号）`);
      patternEvidence.push(...linesMatching(samples, (line) => /[？?]/u.test(line)));
    }
    if (stats.exclamationRatio >= 0.4) {
      patterns.push(`感叹句多（${Math.round(stats.exclamationRatio * 100)}% 的对白带叹号）`);
      patternEvidence.push(...linesMatching(samples, (line) => /[！!]/u.test(line)));
    }
    if (patterns.length > 0) {
      fields.signaturePatterns = { value: patterns.slice(0, 5), source: "dialogue", evidence: uniq(patternEvidence).slice(0, 3) };
    }
  }

  // 认知滤镜：角色卡里写明「怎么看事情」的原句优先；否则用信奉 / 执念 / 恐惧原文做尺子。
  const explicitCognition = pickSentences(sentences, EXPLICIT_COGNITION, 2);
  if (explicitCognition.length > 0) {
    fields.cognitiveFilter = {
      value: clip(explicitCognition.map(({ sentence }) => sentence).join("；"), TEXT_MAX),
      source: "card",
      evidence: explicitCognition.map(({ label, sentence }) => evidenceLine(label, sentence)),
    };
  } else {
    const belief = readCardString(input.card.fields, "core_belief");
    const obsession = readCardString(input.card.fields, "core_obsession");
    const fear = readCardString(input.card.fields, "core_fear");
    const parts = [
      belief ? `以「${clip(belief, 40)}」为尺子评判人和事` : "",
      obsession ? `话题一碰到「${clip(obsession, 40)}」就放不下` : "",
      fear ? `对「${clip(fear, 40)}」相关的事格外敏感` : "",
    ].filter(Boolean);
    if (parts.length > 0) {
      fields.cognitiveFilter = {
        value: parts.join("；"),
        source: "card",
        evidence: [
          belief ? evidenceLine("信奉", belief) : "",
          obsession ? evidenceLine("执念", obsession) : "",
          fear ? evidenceLine("最深恐惧", fear) : "",
        ].filter(Boolean),
      };
    }
  }

  const forbidden = pickSentences(sentences, EXPLICIT_FORBIDDEN, 4);
  if (forbidden.length > 0) {
    fields.forbiddenPatterns = {
      value: forbidden.map(({ sentence }) => clip(sentence, LIST_ITEM_MAX)),
      source: "card",
      evidence: forbidden.slice(0, 3).map(({ label, sentence }) => evidenceLine(label, sentence)),
    };
  }

  const emotionFields: [CharacterVoiceFieldKey, RegExp][] = [
    ["underAnger", EXPLICIT_ANGER],
    ["underTension", EXPLICIT_TENSION],
    ["whenLying", EXPLICIT_LYING],
  ];
  for (const [key, pattern] of emotionFields) {
    const hits = pickSentences(sentences, pattern, 2);
    if (hits.length === 0) continue;
    fields[key] = {
      value: clip(hits.map(({ sentence }) => sentence).join("；"), TEXT_MAX),
      source: "card",
      evidence: hits.map(({ label, sentence }) => evidenceLine(label, sentence)),
    };
  }

  return { fields, stats, sampleCount: samples.length };
}

// ---------------------------------------------------------------------------
// 章节对白抽取（启发式，宁缺毋滥）
// ---------------------------------------------------------------------------

const SPEECH_VERB = /(说|道|问|喊|叫|笑|骂|嘀咕|吼|答|哼|低语|开口)/u;
const QUOTE_PATTERN = /[“「]([^”」\n]{1,300})[”」]/gu;

/**
 * 从正文里抽出能明确归给该角色的对白：引号前同句内出现本人名字且以说话动词收尾，
 * 或引号后紧跟本人名字与说话动词。前后文同时出现其他角色名的跳过，不猜。
 */
export function extractCharacterDialogue(
  text: string,
  options: { readonly names: readonly string[]; readonly otherNames?: readonly string[]; readonly limit?: number },
): string[] {
  const names = uniq(options.names.map((name) => name.trim()).filter((name) => name.length >= 1));
  if (names.length === 0) return [];
  const others = uniq((options.otherNames ?? []).map((name) => name.trim()).filter((name) => name.length >= 1 && !names.includes(name)));
  const limit = options.limit ?? 60;
  const result: string[] = [];
  for (const match of text.matchAll(QUOTE_PATTERN)) {
    if (result.length >= limit) break;
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const beforeRaw = text.slice(Math.max(0, start - 24), start);
    const before = beforeRaw.split(/[。！？\n”」]/u).pop() ?? "";
    const afterRaw = text.slice(end, end + 24);
    const after = afterRaw.split(/[。！？\n“「]/u)[0] ?? "";
    const mentions = (segment: string, list: readonly string[]) => list.some((name) => segment.includes(name));
    const beforeHit = mentions(before, names) && SPEECH_VERB.test(before) && /[：:，,]?\s*$/u.test(before);
    const afterHit = names.some((name) => {
      const index = after.indexOf(name);
      return index >= 0 && index <= 2 && SPEECH_VERB.test(after.slice(index + name.length, index + name.length + 8));
    });
    if (!beforeHit && !afterHit) continue;
    const context = beforeHit ? before : after;
    if (mentions(context, others)) continue;
    const line = cleanDialogueLine(match[1]!);
    if (countChars(line) > 0) result.push(line);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 合并草稿与作者编辑
// ---------------------------------------------------------------------------

export interface MergeVoiceDraftResult {
  readonly voice: CharacterVoice;
  /** 这次写入为待审的字段 */
  readonly appliedKeys: readonly CharacterVoiceFieldKey[];
  /** 已确认、因此未被草稿覆盖的字段 */
  readonly keptConfirmedKeys: readonly CharacterVoiceFieldKey[];
}

/** 草稿只写未确认的字段；已确认的作者设定一律保留。 */
export function mergeVoiceDraft(existing: CharacterVoice, draft: CharacterVoiceDraft, now: Date = new Date()): MergeVoiceDraftResult {
  const fields = { ...existing.fields } as Record<CharacterVoiceFieldKey, CharacterVoiceField>;
  const appliedKeys: CharacterVoiceFieldKey[] = [];
  const keptConfirmedKeys: CharacterVoiceFieldKey[] = [];
  for (const key of CHARACTER_VOICE_FIELD_KEYS) {
    const drafted = draft.fields[key];
    if (!drafted || isEmptyValue(drafted.value)) continue;
    if (existing.fields[key].status === "confirmed") {
      keptConfirmedKeys.push(key);
      continue;
    }
    fields[key] = {
      value: Array.isArray(drafted.value) ? [...drafted.value] : drafted.value as string,
      status: "needs-review",
      source: drafted.source,
      evidence: [...drafted.evidence].slice(0, 5),
      updatedAt: now.toISOString(),
    };
    appliedKeys.push(key);
  }
  return { voice: { schemaVersion: 1, fields }, appliedKeys, keptConfirmedKeys };
}

export interface VoiceFieldUpdate {
  readonly value: string | readonly string[];
  readonly status: "confirmed" | "needs-review";
}

function normalizeFieldValue(key: CharacterVoiceFieldKey, value: unknown): string | string[] {
  const meta = getVoiceFieldMeta(key);
  if (meta.kind === "list") {
    const items = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : typeof value === "string" ? value.split(/\n+/u) : [];
    return uniq(items.map((item) => item.trim()).filter(Boolean));
  }
  if (typeof value !== "string") throw new CharacterVoiceError(`${meta.label}必须是文本`, "CHARACTER_VOICE_INVALID");
  return value.trim();
}

/**
 * 作者逐项确认 / 改写。值未变时保留原来源与证据（确认的是机器草稿本身）；
 * 值变了记为作者来源；清空即退回「待补充」。
 */
export function applyVoiceFieldUpdates(
  existing: CharacterVoice,
  updates: Partial<Record<CharacterVoiceFieldKey, VoiceFieldUpdate>>,
  now: Date = new Date(),
): CharacterVoice {
  const fields = { ...existing.fields } as Record<CharacterVoiceFieldKey, CharacterVoiceField>;
  for (const [rawKey, update] of Object.entries(updates)) {
    if (!(CHARACTER_VOICE_FIELD_KEYS as readonly string[]).includes(rawKey)) {
      throw new CharacterVoiceError(`未知的声线字段：${rawKey}`, "CHARACTER_VOICE_INVALID");
    }
    if (!update) continue;
    const key = rawKey as CharacterVoiceFieldKey;
    if (update.status !== "confirmed" && update.status !== "needs-review") {
      throw new CharacterVoiceError(`${getVoiceFieldMeta(key).label}的状态只能是已确认或待审`, "CHARACTER_VOICE_INVALID");
    }
    const value = normalizeFieldValue(key, update.value);
    if (isEmptyValue(value)) {
      fields[key] = { ...emptyField(key), updatedAt: now.toISOString() };
      continue;
    }
    const previous = existing.fields[key];
    const unchanged = JSON.stringify(previous.value) === JSON.stringify(value);
    fields[key] = {
      value,
      status: update.status,
      source: unchanged && previous.source ? previous.source : "author",
      ...(unchanged && previous.evidence?.length ? { evidence: [...previous.evidence] } : {}),
      updatedAt: now.toISOString(),
    };
  }
  const voice: CharacterVoice = { schemaVersion: 1, fields };
  serializeCharacterVoice(voice); // 校验长度与形态，非法时抛 INVALID
  return voice;
}

// ---------------------------------------------------------------------------
// 模型增补（可选）
// ---------------------------------------------------------------------------

/** 与章后结算、张力评分同形的文本生成能力，由宿主注入。 */
export type CharacterVoiceGenerateText = (request: {
  messages: ReadonlyArray<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  maxTokens?: number;
}) => Promise<{ text: string }>;

const ModelVoiceResponseSchema = z.object({
  fields: z.record(z.string(), z.object({
    value: z.union([z.string(), z.array(z.string())]),
    evidence: z.array(z.string()).optional(),
  })),
});

export interface VoiceModelOutcome {
  readonly status: "applied" | "failed";
  readonly acceptedKeys: readonly CharacterVoiceFieldKey[];
  /** 模型给了值但证据在材料里找不到、因此丢弃的字段 */
  readonly rejectedKeys: readonly CharacterVoiceFieldKey[];
  readonly reason?: string;
}

const VOICE_EXTRACT_SYSTEM_PROMPT = [
  "你负责整理网文角色的说话方式（声线），供写对白时约束用。",
  "只依据给出的角色卡与对白样本，把已经体现出来的说话特征归纳成字段；材料里看不出来的字段留空，不补设定、不编新例句。",
  "",
  "输出要求：",
  "- 只输出一个 JSON 对象：{\"fields\": {\"字段键\": {\"value\": 值, \"evidence\": [\"摘录\"]}}}，不要任何解释。",
  "- 文本字段的 value 是字符串，不超过 80 字；列表字段的 value 是字符串数组，每项不超过 20 字。",
  "- 每个非空字段必须带 1–3 条 evidence，evidence 必须是从材料原样复制的片段（角色卡原句或对白原句）。复制不出原文的字段直接留空。",
  "- 留空写法：文本字段 \"\"，列表字段 []。",
].join("\n");

function formatFieldCatalog(keys: readonly CharacterVoiceFieldKey[]): string {
  return keys.map((key) => {
    const meta = getVoiceFieldMeta(key);
    return `- ${key}（${meta.label}，${meta.kind === "list" ? "列表" : "文本"}）：${meta.hint}`;
  }).join("\n");
}

function formatDraftForPrompt(draft: CharacterVoiceDraft): string {
  const lines = CHARACTER_VOICE_FIELD_KEYS.flatMap((key) => {
    const field = draft.fields[key];
    if (!field) return [];
    const value = Array.isArray(field.value) ? field.value.join("、") : field.value;
    return [`- ${getVoiceFieldMeta(key).label}：${value}`];
  });
  return lines.length > 0 ? lines.join("\n") : "（无）";
}

export function buildVoiceExtractionMessages(input: {
  readonly card: CharacterCardSource;
  readonly dialogueSamples: readonly string[];
  readonly draft: CharacterVoiceDraft;
  readonly targetKeys: readonly CharacterVoiceFieldKey[];
}): { role: "system" | "user"; content: string }[] {
  const material = collectCardMaterial(input.card).map(({ label, text }) => `【${label}】${text.slice(0, 1_200)}`).join("\n");
  const samples = input.dialogueSamples.slice(0, 40).map((line, index) => `${index + 1}. ${line}`).join("\n");
  const user = [
    `角色：${input.card.name}${input.card.aliases?.length ? `（别名：${input.card.aliases.join("、")}）` : ""}`,
    "",
    "角色卡：",
    material || "（空）",
    "",
    "该角色的对白样本：",
    samples || "（无）",
    "",
    "规则统计已得到的初稿（可修正措辞，但不要与统计相矛盾）：",
    formatDraftForPrompt(input.draft),
    "",
    "需要整理的字段：",
    formatFieldCatalog(input.targetKeys),
  ].join("\n");
  return [
    { role: "system", content: VOICE_EXTRACT_SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

function extractJsonObject(text: string): unknown {
  const withoutFence = text.replace(/```(?:json)?/giu, "");
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型输出里没有 JSON 对象");
  return JSON.parse(withoutFence.slice(start, end + 1));
}

/** 统计类字段以实测为准，模型不覆盖。 */
const MEASURED_KEYS = new Set<CharacterVoiceFieldKey>(["sentenceLength", "pauses"]);

/**
 * 用模型增补初稿。任何失败都收敛为 status=failed 并原样返回规则初稿，不抛出、不阻断。
 * 模型字段必须有能在材料里找到的摘录；列表项本身也须在材料里出现（口头禅）或有摘录支撑。
 */
export async function enrichCharacterVoiceWithModel(input: {
  readonly card: CharacterCardSource;
  readonly dialogueSamples: readonly string[];
  readonly draft: CharacterVoiceDraft;
  /** 已确认、不需要模型处理的字段 */
  readonly lockedKeys?: readonly CharacterVoiceFieldKey[];
  readonly generateText: CharacterVoiceGenerateText;
}): Promise<{ draft: CharacterVoiceDraft; outcome: VoiceModelOutcome }> {
  const locked = new Set(input.lockedKeys ?? []);
  const targetKeys = CHARACTER_VOICE_FIELD_KEYS.filter((key) => !locked.has(key) && !(MEASURED_KEYS.has(key) && input.draft.fields[key]));
  if (targetKeys.length === 0) {
    return { draft: input.draft, outcome: { status: "applied", acceptedKeys: [], rejectedKeys: [] } };
  }
  const samples = uniq([...cardDialogueSamples(input.card), ...input.dialogueSamples.map(cleanDialogueLine)]).filter(Boolean);
  const materialText = normalizeForMatch([
    ...collectCardMaterial(input.card).map(({ text }) => text),
    ...samples,
  ].join("\n"));
  const appearsInMaterial = (snippet: string, minLength = 2) => {
    const normalized = normalizeForMatch(snippet.replace(/^[^：:]{1,8}[：:]/u, ""));
    return normalized.length >= minLength && materialText.includes(normalized);
  };
  let parsed: z.infer<typeof ModelVoiceResponseSchema>;
  try {
    const response = await input.generateText({
      messages: buildVoiceExtractionMessages({ card: input.card, dialogueSamples: samples, draft: input.draft, targetKeys }),
      temperature: 0.2,
      maxTokens: 1_200,
    });
    parsed = ModelVoiceResponseSchema.parse(extractJsonObject(response.text));
  } catch (error) {
    return {
      draft: input.draft,
      outcome: { status: "failed", acceptedKeys: [], rejectedKeys: [], reason: error instanceof Error ? error.message : String(error) },
    };
  }

  const fields = { ...input.draft.fields };
  const acceptedKeys: CharacterVoiceFieldKey[] = [];
  const rejectedKeys: CharacterVoiceFieldKey[] = [];
  for (const key of targetKeys) {
    const candidate = parsed.fields[key];
    if (!candidate) continue;
    const meta = getVoiceFieldMeta(key);
    let value: string | string[];
    if (meta.kind === "list") {
      const items = Array.isArray(candidate.value) ? candidate.value : candidate.value.split(/[\n、]+/u);
      value = uniq(items.map((item) => clip(item, LIST_ITEM_MAX)).filter(Boolean)).slice(0, LIST_MAX);
      // 口头禅必须是材料里真实出现过的词。
      if (key === "catchphrases") value = value.filter((item) => appearsInMaterial(item, 1));
    } else {
      value = typeof candidate.value === "string" ? clip(candidate.value, TEXT_MAX) : clip(candidate.value.join("；"), TEXT_MAX);
    }
    if (isEmptyValue(value)) continue;
    const evidence = uniq((candidate.evidence ?? []).map((item) => clip(item, EVIDENCE_MAX)).filter((item) => appearsInMaterial(item))).slice(0, 3);
    if (evidence.length === 0) {
      rejectedKeys.push(key);
      continue;
    }
    fields[key] = { value, source: "model", evidence };
    acceptedKeys.push(key);
  }
  return { draft: { ...input.draft, fields }, outcome: { status: "applied", acceptedKeys, rejectedKeys } };
}

// ---------------------------------------------------------------------------
// 写对白约束文本（供 T2.4 写作注入）
// ---------------------------------------------------------------------------

export interface CharacterVoiceProfile {
  /** 经纬角色条目 id */
  readonly characterId: string;
  readonly name: string;
  readonly voice: CharacterVoice;
}

/** 从经纬角色条目读出声线；坏数据的条目单独列出，不抛出、不静默当成空。 */
export function readCharacterVoiceProfiles(entries: readonly {
  readonly id: string;
  readonly title: string;
  readonly fields: Readonly<Record<string, unknown>>;
}[]): { profiles: CharacterVoiceProfile[]; corruptedIds: string[] } {
  const profiles: CharacterVoiceProfile[] = [];
  const corruptedIds: string[] = [];
  for (const entry of entries) {
    try {
      profiles.push({ characterId: entry.id, name: entry.title, voice: parseCharacterVoice(entry.fields.voice) });
    } catch {
      corruptedIds.push(entry.id);
    }
  }
  return { profiles, corruptedIds };
}

function formatConstraintValue(key: CharacterVoiceFieldKey, value: string | readonly string[]): string {
  if (!Array.isArray(value)) return value as string;
  if (key === "catchphrases") return `${value.map((item) => `「${item}」`).join("")}（自然带出，不要句句都用）`;
  return value.join("；");
}

/**
 * 写对话时注入的高优先级约束。只收本场出场角色、只收作者已确认的字段；
 * 待审与待补充的字段不注入，避免把未确认的机器草稿当设定。没有可用声线时返回空串。
 */
export function buildVoiceConstraintText(
  voices: readonly CharacterVoiceProfile[],
  presentCharacterIds: readonly string[],
): string {
  const byId = new Map(voices.map((profile) => [profile.characterId, profile] as const));
  const blocks: string[] = [];
  for (const id of uniq(presentCharacterIds)) {
    const profile = byId.get(id);
    if (!profile) continue;
    const lines = CHARACTER_VOICE_FIELD_META.flatMap((meta) => {
      const field = profile.voice.fields[meta.key];
      if (field.status !== "confirmed" || isEmptyValue(field.value)) return [];
      return [`- ${meta.label}：${formatConstraintValue(meta.key, field.value)}`];
    });
    if (lines.length > 0) blocks.push(`### ${profile.name}\n${lines.join("\n")}`);
  }
  if (blocks.length === 0) return "";
  const header = [
    "【角色声线｜高优先级】写本场对白时必须遵守；与泛化文风要求冲突时以此为准。",
    "只列作者已确认的项；没列出的方面按角色卡性格处理，不要自造新口癖。",
  ];
  const footer = blocks.length > 1
    ? ["", "区分要求：去掉说话人标签后，读者仍应能从句长、用词和语气分出是谁在说。"]
    : [];
  return [...header, "", blocks.join("\n\n"), ...footer].join("\n");
}
