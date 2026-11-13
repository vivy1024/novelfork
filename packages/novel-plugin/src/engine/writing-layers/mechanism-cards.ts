import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { z } from "zod";
import { splitChapters } from "@vivy1024/novelfork-core";
import type { RuntimeTextGenerator } from "@vivy1024/novelfork-core/plugins";

import { decodeManuscriptBytes } from "../manuscript-import/manuscript-import.js";
import { writeFileAtomic } from "../writing-resource/atomic-write.js";
import { collectSourceTerms } from "./style-distillation-terms.js";

export const MECHANISM_CARDS_RELATIVE_PATH = join("story", "mechanism_cards.json");
export const MAX_MECHANISM_CARDS = 200;

const shortText = z.string().trim().min(1).max(400);
const longText = z.string().trim().min(1).max(2_000);

export const MechanismAbstractSlotSchema = z.object({
  slot: shortText,
  roleDescription: longText,
}).strict();

export const MechanismCardSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(200),
  sourceTitle: z.string().trim().min(1).max(200),
  sourceChapterRange: z.string().trim().min(1).max(120),
  readerDesire: longText,
  emotionChain: longText,
  triggerAndPayoff: longText,
  abstractSlots: z.array(MechanismAbstractSlotSchema).min(1).max(20),
  forbiddenSourceTerms: z.array(z.string().trim().min(1).max(120)).max(200).default([]),
  tags: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  status: z.enum(["needs-review", "confirmed"]),
  validationStatus: z.enum(["single_book", "cross_book"]).default("single_book"),
  corroboratingSources: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  needsTermSanitization: z.boolean().optional(),
  residualTerms: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  updatedAt: z.string().trim().min(1).max(80).optional(),
}).strict();

export const MechanismCardStoreSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  cards: z.array(MechanismCardSchema).max(MAX_MECHANISM_CARDS).default([]),
}).passthrough();

export type MechanismCard = z.infer<typeof MechanismCardSchema>;
export type MechanismCardStore = z.infer<typeof MechanismCardStoreSchema>;

export class MechanismCardError extends Error {
  constructor(
    message: string,
    readonly code:
      | "MECHANISM_CARD_INVALID_INPUT"
      | "MECHANISM_CARD_NOT_FOUND"
      | "MECHANISM_CARD_CORRUPTED"
      | "MECHANISM_CARD_CONFLICT",
  ) {
    super(message);
    this.name = "MechanismCardError";
  }
}

export interface LoadedMechanismCards {
  readonly cards: readonly MechanismCard[];
  readonly revision: string | null;
}

function revisionOf(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

const writes = new Map<string, Promise<void>>();
async function withMechanismWrite<T>(bookRoot: string, task: () => Promise<T>): Promise<T> {
  const absolute = resolve(bookRoot);
  const key = process.platform === "win32" ? absolute.toLowerCase() : absolute;
  const previous = writes.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((done) => { release = done; });
  const tail = previous.then(() => gate);
  writes.set(key, tail);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (writes.get(key) === tail) writes.delete(key);
  }
}

/**
 * 机械校验原著专名残留：检查 `forbiddenSourceTerms` 是否残留在 `name`、`triggerAndPayoff`、`abstractSlots` 正文中。
 * 若残留则标记 `needsTermSanitization: true`、列出 `residualTerms` 并降回 `needs-review`，绝不把带原著专名的机制当已确认模板注入。
 */
export function auditMechanismCardResiduals(card: Omit<MechanismCard, "needsTermSanitization" | "residualTerms">): {
  readonly card: MechanismCard;
  readonly warnings: readonly string[];
} {
  const body = [
    card.name,
    card.readerDesire,
    card.emotionChain,
    card.triggerAndPayoff,
    ...card.abstractSlots.flatMap((slot) => [slot.slot, slot.roleDescription]),
  ].join("\n");
  const residuals = [...new Set(
    card.forbiddenSourceTerms
      .map((term) => term.trim())
      .filter((term) => term.length >= 2 && body.includes(term)),
  )];
  if (residuals.length === 0) {
    return {
      card: {
        ...card,
        needsTermSanitization: undefined,
        residualTerms: undefined,
      },
      warnings: [],
    };
  }
  return {
    card: {
      ...card,
      status: "needs-review",
      needsTermSanitization: true,
      residualTerms: residuals,
    },
    warnings: [
      `机制卡「${card.name}」正文残留来源《${card.sourceTitle}》专名（${residuals.join("、")}），已标记需清洗并保持待审状态。`,
    ],
  };
}

export async function loadMechanismCards(bookRoot: string): Promise<LoadedMechanismCards> {
  const path = join(bookRoot, MECHANISM_CARDS_RELATIVE_PATH);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { cards: [], revision: null };
    throw error;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const normalized = Array.isArray(parsed)
      ? MechanismCardStoreSchema.parse({ schemaVersion: 1, cards: parsed })
      : MechanismCardStoreSchema.parse(parsed);
    return { cards: normalized.cards, revision: revisionOf(raw) };
  } catch {
    throw new MechanismCardError("机制卡文件损坏，已保留原文件；请修复或恢复后重试。", "MECHANISM_CARD_CORRUPTED");
  }
}

async function persistCards(bookRoot: string, cards: readonly MechanismCard[]): Promise<LoadedMechanismCards> {
  await mkdir(join(bookRoot, "story"), { recursive: true });
  const payload = { schemaVersion: 1 as const, cards: cards.slice(0, MAX_MECHANISM_CARDS) };
  const raw = `${JSON.stringify(payload, null, 2)}\n`;
  await writeFileAtomic(join(bookRoot, MECHANISM_CARDS_RELATIVE_PATH), raw);
  return { cards: payload.cards, revision: revisionOf(raw) };
}

function structureSignature(card: Pick<MechanismCard, "name" | "triggerAndPayoff" | "tags">): string {
  return `${card.name}${card.triggerAndPayoff}${card.tags.join("")}`
    .replace(/[\s\p{P}\p{S}\d]+/gu, "")
    .toLowerCase();
}

function bigramOverlap(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const grams = (text: string) => {
    const set = new Set<string>();
    for (let i = 0; i < text.length - 1; i += 1) set.add(text.slice(i, i + 2));
    return set;
  };
  const a = grams(left);
  const b = grams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const g of a) if (b.has(g)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

/**
 * 单书同构归并与跨书聚合标记：
 * - 同一本书内同构机制合并，扩充专名黑名单与标签；
 * - 不同来源书出现同构机制时自动升级 `validationStatus: "cross_book"` 并记录佐证来源。
 */
export function mergeMechanismCardList(
  existing: readonly MechanismCard[],
  incoming: readonly MechanismCard[],
): { readonly cards: MechanismCard[]; readonly warnings: string[] } {
  const merged: MechanismCard[] = existing.map((card) => ({ ...card }));
  const warnings: string[] = [];

  for (const rawCandidate of incoming) {
    const audited = auditMechanismCardResiduals(rawCandidate);
    warnings.push(...audited.warnings);
    const candidate = audited.card;
    const candidateSig = structureSignature(candidate);
    const matchIndex = merged.findIndex((item) => {
      if (item.id === candidate.id) return true;
      const itemSig = structureSignature(item);
      const sharedTags = item.tags.filter((tag) => candidate.tags.includes(tag)).length;
      return bigramOverlap(itemSig, candidateSig) >= 0.58
        || (sharedTags >= 2 && bigramOverlap(itemSig, candidateSig) >= 0.36);
    });

    if (matchIndex < 0) {
      merged.push(candidate);
      continue;
    }

    const prev = merged[matchIndex]!;
    const differentBook = prev.sourceTitle.trim() !== candidate.sourceTitle.trim();
    const corroboratingSources = [...new Set([
      ...(prev.corroboratingSources ?? [prev.sourceTitle]),
      candidate.sourceTitle,
    ])];
    const reaudited = auditMechanismCardResiduals({
      ...prev,
      forbiddenSourceTerms: [...new Set([...prev.forbiddenSourceTerms, ...candidate.forbiddenSourceTerms])].slice(0, 200),
      tags: [...new Set([...prev.tags, ...candidate.tags])].slice(0, 30),
      validationStatus: differentBook || prev.validationStatus === "cross_book" ? "cross_book" : "single_book",
      ...(corroboratingSources.length > 1 ? { corroboratingSources } : {}),
      updatedAt: candidate.updatedAt ?? new Date().toISOString(),
    });
    warnings.push(...reaudited.warnings);
    merged[matchIndex] = reaudited.card;
  }

  return { cards: merged.slice(0, MAX_MECHANISM_CARDS), warnings };
}

export interface ExtractMechanismCardsInput {
  readonly bookRoot: string;
  readonly sourceTitle?: string;
  readonly filePath?: string;
  readonly text?: string;
  readonly chapterRange?: { readonly from?: number; readonly to?: number };
  readonly extraForbiddenTerms?: readonly string[];
  readonly generateText?: RuntimeTextGenerator;
}

export interface ExtractMechanismCardsResult {
  readonly extracted: readonly MechanismCard[];
  readonly allCards: readonly MechanismCard[];
  readonly warnings: readonly string[];
  readonly revision: string | null;
  readonly sourceChapterRange: string;
  readonly usedModel: boolean;
}

interface SlicedChapter {
  readonly number: number;
  readonly title: string;
  readonly content: string;
}

async function resolveMechanismSourceChapters(input: ExtractMechanismCardsInput): Promise<{
  readonly sourceTitle: string;
  readonly chapters: readonly SlicedChapter[];
  readonly sourceChapterRange: string;
}> {
  let rawText = input.text?.trim() ?? "";
  let inferredTitle = input.sourceTitle?.trim() ?? "";

  if (!rawText && input.filePath?.trim()) {
    const bytes = await readFile(input.filePath.trim());
    rawText = decodeManuscriptBytes(Uint8Array.from(bytes)).text.trim();
    if (!inferredTitle) {
      inferredTitle = basename(input.filePath.trim()).replace(/\.[^.]+$/u, "") || "参考书";
    }
  }
  if (!rawText) {
    throw new MechanismCardError("请提供待拆解的 text 文本或本地 filePath。", "MECHANISM_CARD_INVALID_INPUT");
  }
  const sourceTitle = inferredTitle || "参考作品";
  const split = splitChapters(rawText);
  const allChapters: SlicedChapter[] = split.length > 0
    ? split.map((ch, idx) => ({
      number: idx + 1,
      title: ch.title || `第${idx + 1}章`,
      content: ch.content,
    }))
    : [{ number: 1, title: "第1章", content: rawText }];

  const from = input.chapterRange?.from ?? allChapters[0]!.number;
  const to = input.chapterRange?.to ?? allChapters.at(-1)!.number;
  const selected = allChapters.filter((ch) => ch.number >= from && ch.number <= to);
  if (selected.length === 0) {
    throw new MechanismCardError(`指定章节范围 ${from}-${to} 内没有切出有效章节。`, "MECHANISM_CARD_INVALID_INPUT");
  }
  const actualFrom = selected[0]!.number;
  const actualTo = selected.at(-1)!.number;
  return {
    sourceTitle,
    chapters: selected,
    sourceChapterRange: actualFrom === actualTo ? `第${actualFrom}章` : `第${actualFrom}-${actualTo}章`,
  };
}

function sanitizeTermsFromText(text: string, terms: readonly string[]): string {
  let out = text;
  const sorted = [...terms].filter((t) => t.length >= 2).sort((a, b) => b.length - a.length);
  for (const term of sorted) {
    out = out.replaceAll(term, "【对应设定槽】");
  }
  return out;
}

const DETERMINISTIC_ARCHETYPES: ReadonlyArray<{
  readonly match: RegExp;
  readonly name: string;
  readonly readerDesire: string;
  readonly emotionChain: string;
  readonly triggerAndPayoff: string;
  readonly abstractSlots: ReadonlyArray<{ readonly slot: string; readonly roleDescription: string }>;
  readonly tags: readonly string[];
}> = [
  {
    match: /灵石|账单|欠款|贷款|工钱|打工|学分|学费|成本|收益|套利|预算|罚款/u,
    name: "底层生存账单驱动与规则降维实用化",
    readerDesire: "看主角在高压账单与资源匮乏下，把高高在上的体系技能拆成低成本实用工具破局搞钱",
    emotionChain: "生存缺口紧逼 → 常规路径亏损受阻 → 发现规则盲区降维改造 → 账面收益与实力双兑现",
    triggerAndPayoff: "硬性债务或资源考核触发危机 → 拆解既有制度/功法的高耗低效环节进行实用化重组 → 当场算清进账并反超同侪",
    abstractSlots: [
      { slot: "硬性账单压力源", roleDescription: "可量化的定期债务、考核指标或资源消耗缺口" },
      { slot: "可降维改造的基础技艺", roleDescription: "原本用于高大上用途、但可被主角拆作民用/套利的基础能力" },
      { slot: "账面兑现锚点", roleDescription: "直观数字化的收入、节省成本或等级晋升凭证" },
    ],
    tags: ["制度套利", "开局破局", "生存算账", "实用化改造"],
  },
  {
    match: /道基|配伍|君臣|推演|古籍|残卷|反噬|灵机|仙基|晋升|境界|死局/u,
    name: "体系配伍相克死局与冷门古法逆推破局",
    readerDesire: "看角色在严密残酷的力量体系限制下，靠逻辑推演从废案或残卷里抠出一线生机",
    emotionChain: "晋升死局显露 → 主流方案暗藏致命代价 → 交叉比对残缺线索逆推机制 → 险中求胜完成晋升闭环",
    triggerAndPayoff: "常规进阶路径存在隐性相克或受制于人 → 利用体系底层生克规则重新配伍要素 → 避开暗坑达成独有优势定位",
    abstractSlots: [
      { slot: "显性进阶路径陷阱", roleDescription: "表面稳妥但暗藏上限锁死或受制于上位者的标准方案" },
      { slot: "底层配伍约束规则", roleDescription: "多要素之间互斥、主次制衡或代价守恒的硬法则" },
      { slot: "逆推破局支点", roleDescription: "被旁人忽视的残缺旧法、偏门器物或跨层信息差" },
    ],
    tags: ["功法推演", "体系博弈", "破局设计", "设定兑现"],
  },
];

function deterministicExtractMechanisms(input: {
  readonly sourceTitle: string;
  readonly sourceChapterRange: string;
  readonly corpus: string;
  readonly forbiddenTerms: readonly string[];
}): MechanismCard[] {
  const hits = DETERMINISTIC_ARCHETYPES.filter((item) => item.match.test(input.corpus));
  const selected = hits.length > 0
    ? hits
    : [{
      name: "困境约束倒逼下的信息差破局闭环",
      readerDesire: "看主角在不对称劣势中抓住局部规则漏洞，以小博大扭转局面",
      emotionChain: "外部强压降临 → 正面对抗无望 → 锁定对方机制盲点设局 → 筹码反转兑现阶段收益",
      triggerAndPayoff: "强敌或硬性规矩封死常规退路 → 利用局部信息差与资源错位反制 → 拿到阶段主动权并留下新钩子",
      abstractSlots: [
        { slot: "外部高压封锁", roleDescription: "迫使主角必须在限定时间内给出解法的冲突源" },
        { slot: "机制盲区支点", roleDescription: "对手或既有规矩因傲慢、惯性而忽略的执行缝隙" },
        { slot: "阶段结算筹码", roleDescription: "破局后落袋为安的具体权益、地位或关键情报" },
      ],
      tags: ["开局破局", "信息差博弈", "冲突兑现"],
    }];

  const now = new Date().toISOString();
  return selected.map((item) => ({
    id: `mech-${randomUUID().slice(0, 8)}`,
    name: sanitizeTermsFromText(item.name, input.forbiddenTerms),
    sourceTitle: input.sourceTitle,
    sourceChapterRange: input.sourceChapterRange,
    readerDesire: sanitizeTermsFromText(item.readerDesire, input.forbiddenTerms),
    emotionChain: sanitizeTermsFromText(item.emotionChain, input.forbiddenTerms),
    triggerAndPayoff: sanitizeTermsFromText(item.triggerAndPayoff, input.forbiddenTerms),
    abstractSlots: item.abstractSlots.map((slot) => ({
      slot: sanitizeTermsFromText(slot.slot, input.forbiddenTerms),
      roleDescription: sanitizeTermsFromText(slot.roleDescription, input.forbiddenTerms),
    })),
    forbiddenSourceTerms: [...input.forbiddenTerms].slice(0, 200),
    tags: [...item.tags],
    status: "needs-review",
    validationStatus: "single_book",
    updatedAt: now,
  }));
}

const LlmMechanismResponseSchema = z.object({
  cards: z.array(z.object({
    name: z.string().trim().min(2).max(160),
    readerDesire: z.string().trim().min(4).max(1_000),
    emotionChain: z.string().trim().min(4).max(1_000),
    triggerAndPayoff: z.string().trim().min(4).max(1_200),
    abstractSlots: z.array(z.object({
      slot: z.string().trim().min(1).max(120),
      roleDescription: z.string().trim().min(2).max(600),
    })).min(1).max(12),
    forbiddenSourceTerms: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
    tags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  })).min(1).max(8),
});

function parseJsonObject(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1];
  const candidate = (fenced ?? raw).match(/\{[\s\S]*\}/u)?.[0];
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

export async function extractAndSaveMechanismCards(
  input: ExtractMechanismCardsInput,
): Promise<ExtractMechanismCardsResult> {
  const resolved = await resolveMechanismSourceChapters(input);
  const detectedTerms = collectSourceTerms(resolved.chapters).terms.map((t) => t.term);
  const baseForbiddenTerms = [...new Set([
    ...(input.extraForbiddenTerms ?? []).map((t) => t.trim()).filter(Boolean),
    ...detectedTerms,
  ])].slice(0, 200);

  const corpusExcerpt = resolved.chapters
    .map((ch) => `### 第${ch.number}章 ${ch.title}\n${ch.content.slice(0, 4_000)}`)
    .join("\n\n")
    .slice(0, 16_000);

  let rawCards: MechanismCard[] | null = null;
  let usedModel = false;

  if (input.generateText) {
    try {
      const response = await input.generateText({
        messages: [
          {
            role: "system",
            content: [
              "你是网文中观剧情与设定机制拆解器（EM/CBA 机制卡提取）。",
              "任务：从参考章节中剥离具体人名、地名、门派、专有器物名，提炼出跨题材可迁移的「爽点与冲突运转机制卡」。",
              "硬性禁令：name、readerDesire、emotionChain、triggerAndPayoff、abstractSlots 内严禁残留原著专有名词！原著专名一律塞进 forbiddenSourceTerms。",
              `已知高频原著专名（严禁出现在正文，必须列入 forbiddenSourceTerms）：${baseForbiddenTerms.slice(0, 40).join("、") || "由你从文中识别"}`,
              "只输出 JSON：{\"cards\":[{\"name\":\"...\",\"readerDesire\":\"...\",\"emotionChain\":\"缺口 -> 延迟/加码 -> 释放兑现\",\"triggerAndPayoff\":\"困境触发 -> 规则机制利用 -> 兑现闭环\",\"abstractSlots\":[{\"slot\":\"...\",\"roleDescription\":\"...\"}],\"forbiddenSourceTerms\":[\"...\"],\"tags\":[\"...\"]}]}。",
            ].join("\n"),
          },
          {
            role: "user",
            content: `参考作品：《${resolved.sourceTitle}》（${resolved.sourceChapterRange}）\n\n${corpusExcerpt}`,
          },
        ],
        temperature: 0.2,
        maxTokens: 2_400,
      });
      const parsed = LlmMechanismResponseSchema.safeParse(parseJsonObject(response.text));
      if (parsed.success) {
        const now = new Date().toISOString();
        rawCards = parsed.data.cards.map((card) => ({
          id: `mech-${randomUUID().slice(0, 8)}`,
          name: card.name,
          sourceTitle: resolved.sourceTitle,
          sourceChapterRange: resolved.sourceChapterRange,
          readerDesire: card.readerDesire,
          emotionChain: card.emotionChain,
          triggerAndPayoff: card.triggerAndPayoff,
          abstractSlots: card.abstractSlots,
          forbiddenSourceTerms: [...new Set([...baseForbiddenTerms, ...(card.forbiddenSourceTerms ?? [])])].slice(0, 200),
          tags: card.tags ?? [],
          status: "needs-review" as const,
          validationStatus: "single_book" as const,
          updatedAt: now,
        }));
        usedModel = true;
      }
    } catch {
      rawCards = null;
    }
  }

  const candidateCards = rawCards ?? deterministicExtractMechanisms({
    sourceTitle: resolved.sourceTitle,
    sourceChapterRange: resolved.sourceChapterRange,
    corpus: resolved.chapters.map((c) => c.content).join("\n"),
    forbiddenTerms: baseForbiddenTerms,
  });

  return withMechanismWrite(input.bookRoot, async () => {
    const current = await loadMechanismCards(input.bookRoot);
    const merged = mergeMechanismCardList(current.cards, candidateCards);
    const saved = await persistCards(input.bookRoot, merged.cards);
    const auditedExtracted = candidateCards.map((c) => auditMechanismCardResiduals(c).card);
    return {
      extracted: auditedExtracted,
      allCards: saved.cards,
      warnings: merged.warnings,
      revision: saved.revision,
      sourceChapterRange: resolved.sourceChapterRange,
      usedModel,
    };
  });
}

export async function updateMechanismCard(
  bookRoot: string,
  cardId: string,
  patch: Partial<Pick<MechanismCard, "name" | "readerDesire" | "emotionChain" | "triggerAndPayoff" | "abstractSlots" | "forbiddenSourceTerms" | "tags" | "status">>,
): Promise<{ readonly card: MechanismCard; readonly warnings: readonly string[]; readonly revision: string | null }> {
  return withMechanismWrite(bookRoot, async () => {
    const current = await loadMechanismCards(bookRoot);
    const index = current.cards.findIndex((item) => item.id === cardId);
    if (index < 0) {
      throw new MechanismCardError(`找不到机制卡「${cardId}」。`, "MECHANISM_CARD_NOT_FOUND");
    }
    const base = current.cards[index]!;
    const mergedCard: MechanismCard = MechanismCardSchema.parse({
      ...base,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.readerDesire !== undefined ? { readerDesire: patch.readerDesire } : {}),
      ...(patch.emotionChain !== undefined ? { emotionChain: patch.emotionChain } : {}),
      ...(patch.triggerAndPayoff !== undefined ? { triggerAndPayoff: patch.triggerAndPayoff } : {}),
      ...(patch.abstractSlots !== undefined ? { abstractSlots: patch.abstractSlots } : {}),
      ...(patch.forbiddenSourceTerms !== undefined ? { forbiddenSourceTerms: patch.forbiddenSourceTerms } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      updatedAt: new Date().toISOString(),
    });
    const audited = auditMechanismCardResiduals(mergedCard);
    const nextCards = current.cards.map((item, i) => (i === index ? audited.card : item));
    const saved = await persistCards(bookRoot, nextCards);
    return { card: audited.card, warnings: audited.warnings, revision: saved.revision };
  });
}

export async function deleteMechanismCard(
  bookRoot: string,
  cardId: string,
): Promise<{ readonly deletedId: string; readonly revision: string | null }> {
  return withMechanismWrite(bookRoot, async () => {
    const current = await loadMechanismCards(bookRoot);
    if (!current.cards.some((item) => item.id === cardId)) {
      throw new MechanismCardError(`找不到机制卡「${cardId}」。`, "MECHANISM_CARD_NOT_FOUND");
    }
    const saved = await persistCards(bookRoot, current.cards.filter((item) => item.id !== cardId));
    return { deletedId: cardId, revision: saved.revision };
  });
}

// ─── 规划期召回（严格物理隔离：仅供细纲蓝图与卷纲规划使用，严禁接入 write.preflight / style 通道） ───

export interface PlanningMechanismReference {
  readonly id: string;
  readonly name: string;
  readonly readerDesire: string;
  readonly emotionChain: string;
  readonly triggerAndPayoff: string;
  readonly abstractSlots: ReadonlyArray<{ readonly slot: string; readonly roleDescription: string }>;
  readonly tags: readonly string[];
  readonly validationStatus: "single_book" | "cross_book";
}

function tokenizeQuery(input: string | readonly string[]): string[] {
  const raw = Array.isArray(input) ? input.join(" ") : String(input);
  const tokens = raw
    .split(/[\s,，、；;。！？!?\n|/]+/u)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 2);
  return [...new Set(tokens)];
}

/**
 * 仅在规划环节（`scene.spec` 蓝图辅助参考、`outline.volume` 卷纲建议）召回匹配的已确认且无专名残留的机制卡。
 * 绝不返回 `sourceTitle` 原文段落，也绝不进入 `write.preflight` 的正文 `style` 通道。
 */
export async function recallMechanismCardsForPlanning(
  bookRoot: string,
  queryTextOrTags: string | readonly string[],
  maxCards = 4,
): Promise<PlanningMechanismReference[]> {
  if (!bookRoot?.trim()) return [];
  const limit = Math.max(0, Math.min(8, Math.trunc(maxCards)));
  if (limit === 0) return [];
  let loaded: LoadedMechanismCards;
  try {
    loaded = await loadMechanismCards(bookRoot);
  } catch {
    return [];
  }
  const eligible = loaded.cards.filter((card) =>
    card.status === "confirmed" && !card.needsTermSanitization);
  if (eligible.length === 0) return [];

  const queryTokens = tokenizeQuery(queryTextOrTags);
  const rawQuery = (typeof queryTextOrTags === "string" ? queryTextOrTags : queryTextOrTags.join(" ")).trim().toLowerCase();

  const scored = eligible.map((card, index) => {
    let score = card.validationStatus === "cross_book" ? 2 : 0;
    const searchable = [card.name, card.readerDesire, card.triggerAndPayoff, ...card.tags].join(" ").toLowerCase();
    for (const tag of card.tags) {
      const lowerTag = tag.toLowerCase();
      if (rawQuery && rawQuery.includes(lowerTag)) score += 6;
      if (queryTokens.some((tok) => tok.includes(lowerTag) || lowerTag.includes(tok))) score += 4;
    }
    for (const tok of queryTokens) {
      if (searchable.includes(tok)) score += 2;
    }
    return { card, score, index };
  });

  const matched = queryTokens.length > 0
    ? scored.filter((item) => item.score > (item.card.validationStatus === "cross_book" ? 2 : 0))
    : scored;
  const pool = matched.length > 0 ? matched : scored;

  return pool
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ card }) => ({
      id: card.id,
      name: card.name,
      readerDesire: card.readerDesire,
      emotionChain: card.emotionChain,
      triggerAndPayoff: card.triggerAndPayoff,
      abstractSlots: card.abstractSlots,
      tags: card.tags,
      validationStatus: card.validationStatus,
    }));
}
