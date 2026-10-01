/**
 * 写法记忆（T3.5）——作者说「记住这种写法」之后的手动沉淀通道。
 *
 * - 预览：对一段示例文本做纯统计与启发式分析（不调模型），产出候选写法规则、
 *   原文例句与适用场景标签，每条规则都带原文证据；推断宁缺毋滥，判不出就只保留例句，
 *   不编造规则。
 * - 确认：把作者确认的规则与例句写入本书文风预设的「手动写法记忆」来源，
 *   与「作者改稿」来源同级（confirmed + 可迁移、排在来源最前，版本号沿用预设的
 *   冲突机制）。普通聊天不写入：这里只服务作者在文风面板里显式的「记住这种写法」。
 */

import { createHash } from "node:crypto";

import { distillStyleProfile } from "../tools/import/style-distiller.js";
import { sampleSceneType } from "./style-distillation.js";
import { normalizedRuleKey } from "./style-distillation-runner.js";
import { splitSentences } from "./style-vault.js";
import { createStylePreset, STYLE_SCENE_TYPES, type StylePreset } from "./style-preset.js";
import { loadStylePreset, saveStylePreset, type LoadedStylePreset } from "./style-preset-store.js";

/** 「手动写法记忆」在文风预设里的固定来源 ID；与「作者改稿」同级，写入时排在来源最前。 */
export const MANUAL_STYLE_MEMORY_SOURCE_ID = "manual-style-memories";
export const MANUAL_STYLE_MEMORY_SOURCE_TITLE = "手动写法记忆";

export const STYLE_MEMORY_MAX_TEXT_CHARS = 20_000;
export const STYLE_MEMORY_MAX_NOTE_CHARS = 500;
export const STYLE_MEMORY_MAX_RULES = 20;
export const STYLE_MEMORY_MAX_SAMPLES = 20;

export type StyleMemorySceneType = (typeof STYLE_SCENE_TYPES)[number];

export interface StyleMemoryPreviewRule {
  readonly text: string;
  readonly evidence: string;
  /** note：作者注解原文；inferred：确定性推断。 */
  readonly origin: "note" | "inferred";
}

export interface StyleMemoryPreviewSample {
  readonly text: string;
  readonly sceneType: StyleMemorySceneType;
}

export interface StyleMemoryPreviewStats {
  readonly charCount: number;
  readonly sentenceCount: number;
  readonly avgSentenceLength: number;
  readonly shortSentenceRatio: number;
  readonly longSentenceRatio: number;
  readonly dialogueRatio: number;
}

export interface StyleMemoryPreview {
  readonly note: string;
  readonly rules: readonly StyleMemoryPreviewRule[];
  readonly samples: readonly StyleMemoryPreviewSample[];
  readonly sceneTypes: readonly StyleMemorySceneType[];
  readonly stats: StyleMemoryPreviewStats;
  readonly warnings: readonly string[];
}

const DIALOGUE_SENTENCE = /[“"「][^”"」]*[”"」]/u;

/** 金库的切句在引号内按标点断开（为人工占比服务）；例句要整句，按引号闭合把碎片接回去。 */
function hasUnclosedQuote(text: string): boolean {
  let curly = 0;
  let corner = 0;
  let straight = 0;
  for (const char of text) {
    if (char === "“") curly += 1; else if (char === "”") curly -= 1;
    else if (char === "「") corner += 1; else if (char === "」") corner -= 1;
    else if (char === "\"") straight += 1;
  }
  return curly > 0 || corner > 0 || straight % 2 === 1;
}

function splitExampleSentences(text: string): string[] {
  const merged: string[] = [];
  for (const piece of splitSentences(text)) {
    const index = merged.length - 1;
    if (index >= 0 && hasUnclosedQuote(merged[index]!)) {
      merged[index] = merged[index]! + piece;
    } else {
      merged.push(piece);
    }
  }
  return merged;
}

function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function excerpt(sentence: string): string {
  return sentence.length > 300 ? `${sentence.slice(0, 300)}…` : sentence;
}

function paragraphsOf(text: string): string[] {
  return text.split(/\r?\n/u).map((item) => item.trim()).filter((item) => item.length > 1);
}

/**
 * 确定性预览：统计指纹 + 启发式规则推断。所有证据必须来自示例原文；
 * 任何一项特征没有达到阈值就跳过，而不是给出猜的规则。
 */
export function previewStyleMemory(input: { readonly text: string; readonly note?: string }): StyleMemoryPreview {
  const text = input.text.trim();
  const note = (input.note ?? "").trim().slice(0, STYLE_MEMORY_MAX_NOTE_CHARS);
  const sentences = splitExampleSentences(text);
  const profile = distillStyleProfile([text]);
  const sceneType = sampleSceneType(text);

  const rules: StyleMemoryPreviewRule[] = [];
  if (note) rules.push({ text: note, evidence: "作者注解", origin: "note" });

  const inferred: StyleMemoryPreviewRule[] = [];
  const shortest = sentences.length > 0 ? sentences.reduce((a, b) => (b.length < a.length ? b : a)) : "";
  const longest = sentences.length > 0 ? sentences.reduce((a, b) => (b.length > a.length ? b : a)) : "";
  const dialogueSentence = sentences.find((sentence) => DIALOGUE_SENTENCE.test(sentence));
  const questionSentences = sentences.filter((sentence) => /[？?]$/u.test(sentence));
  const exclamationSentences = sentences.filter((sentence) => /[！!]$/u.test(sentence));
  const paragraphs = paragraphsOf(text);
  const avgParagraphLength = paragraphs.length > 0
    ? Math.round((paragraphs.reduce((sum, item) => sum + item.length, 0) / paragraphs.length) * 10) / 10
    : 0;

  if (sentences.length >= 4 && profile.shortSentenceRatio >= 0.5) {
    inferred.push({
      text: `句子以短句为主：约 ${percent(profile.shortSentenceRatio)} 的句子不超过 8 字，平均句长约 ${profile.avgSentenceLength} 字，节奏快。`,
      evidence: `例：${excerpt(shortest)}`,
      origin: "inferred",
    });
  }
  if (sentences.length >= 4 && profile.longSentenceRatio >= 0.25) {
    inferred.push({
      text: `穿插 30 字以上的长句（约占 ${percent(profile.longSentenceRatio)}）铺陈信息或情绪，长短错落。`,
      evidence: `例：${excerpt(longest)}`,
      origin: "inferred",
    });
  }
  if (dialogueSentence && profile.dialogueRatio >= 0.3) {
    inferred.push({
      text: `对话密度高：引文约占 ${percent(profile.dialogueRatio)}，以对话推进场景。`,
      evidence: `例：${excerpt(dialogueSentence)}`,
      origin: "inferred",
    });
  }
  if (questionSentences.length >= 2 && questionSentences.length / sentences.length >= 0.2) {
    inferred.push({
      text: `常用问句（本段 ${questionSentences.length} 句）推进对话或制造悬念。`,
      evidence: `例：${excerpt(questionSentences[0]!)}`,
      origin: "inferred",
    });
  }
  if (exclamationSentences.length >= 2 && exclamationSentences.length / sentences.length >= 0.2) {
    inferred.push({
      text: `常用感叹句（本段 ${exclamationSentences.length} 句）外化情绪。`,
      evidence: `例：${excerpt(exclamationSentences[0]!)}`,
      origin: "inferred",
    });
  }
  if (paragraphs.length >= 3 && avgParagraphLength > 0 && avgParagraphLength <= 50) {
    inferred.push({
      text: `段落短促：平均约 ${avgParagraphLength} 字一段，频繁分段切换节拍。`,
      evidence: `例：${excerpt(paragraphs.reduce((a, b) => (b.length < a.length ? b : a)))}`,
      origin: "inferred",
    });
  }
  rules.push(...inferred);

  // 例句只取原文真实句子：优先一句对话句，再加一句最能代表平均节奏、一句最长的，去重后最多 3 句。
  const picks: string[] = [];
  const pushPick = (sentence: string | undefined) => {
    if (sentence && !picks.includes(sentence) && picks.length < 3) picks.push(sentence);
  };
  pushPick(dialogueSentence);
  if (sentences.length > 0) {
    const typical = sentences.reduce((a, b) =>
      Math.abs(b.length - profile.avgSentenceLength) < Math.abs(a.length - profile.avgSentenceLength) ? b : a);
    pushPick(typical);
    pushPick(longest);
  }
  const samples: StyleMemoryPreviewSample[] = picks.map((sentence) => ({
    text: excerpt(sentence),
    sceneType,
  }));

  const warnings: string[] = [];
  if (text.length < 50) warnings.push("示例文本很短，统计推断可能不稳定；确认前请人工核对。");
  if (inferred.length === 0) warnings.push("没有从示例中提取到可量化的写法特征；可以只保存注解与例句。");
  if (!note) warnings.push("未写注解；用一句话记下「为什么要记住这种写法」，日后更好辨认。");

  return {
    note,
    rules,
    samples,
    sceneTypes: [sceneType],
    stats: {
      charCount: text.length,
      sentenceCount: sentences.length,
      avgSentenceLength: profile.avgSentenceLength,
      shortSentenceRatio: profile.shortSentenceRatio,
      longSentenceRatio: profile.longSentenceRatio,
      dialogueRatio: profile.dialogueRatio,
    },
    warnings,
  };
}

// ─── 确认写入预设 ──────────────────────────────────────────────────────────

export interface StyleMemoryRuleInput {
  readonly text: string;
  readonly evidence?: string;
}

export interface StyleMemorySampleInput {
  readonly text: string;
  readonly sceneType: StyleMemorySceneType;
}

export interface StyleMemoryAdoptInput {
  readonly note?: string;
  readonly rules?: readonly StyleMemoryRuleInput[];
  readonly samples?: readonly StyleMemorySampleInput[];
}

function composeEvidence(note: string, excerptText?: string): string {
  const parts: string[] = [];
  if (note) parts.push(`作者注解：${note}`);
  if (excerptText?.trim()) parts.push(`原文：${excerptText.trim().slice(0, 300)}`);
  return (parts.join("；") || "手动写法记忆").slice(0, 4_000);
}

function memorySampleId(text: string): string {
  return `mem-${createHash("sha256").update(text.trim()).digest("hex").slice(0, 10)}`;
}

/**
 * 把作者确认的写法写进预设的「手动写法记忆」来源（confirmed + 可迁移，排在来源最前）。
 * 内容去重沿用蒸馏的规则口径与金库的范文 ID 口径；版本不符由 saveStylePreset 抛冲突。
 */
export async function adoptStyleMemories(
  bookRoot: string,
  input: StyleMemoryAdoptInput,
  expectedRevision: string | null,
): Promise<LoadedStylePreset> {
  const note = (input.note ?? "").trim().slice(0, STYLE_MEMORY_MAX_NOTE_CHARS);
  const rules = (input.rules ?? [])
    .map((rule) => ({
      text: rule.text.trim().slice(0, 4_000),
      evidence: composeEvidence(note, rule.evidence),
      transfer: "transferable" as const,
      status: "confirmed" as const,
    }))
    .filter((rule) => rule.text.length > 0)
    .slice(0, STYLE_MEMORY_MAX_RULES);
  const samples = (input.samples ?? [])
    .map((sample) => ({
      id: memorySampleId(sample.text),
      sceneType: sample.sceneType,
      text: sample.text.trim().slice(0, 4_000),
      evidence: composeEvidence(note),
      transfer: "transferable" as const,
      status: "confirmed" as const,
    }))
    .filter((sample) => sample.text.length > 0)
    .slice(0, STYLE_MEMORY_MAX_SAMPLES);
  const invalidScene = samples.some((sample) => !(STYLE_SCENE_TYPES as readonly string[]).includes(sample.sceneType));
  if (invalidScene) throw new Error("写法记忆例句的场景类型无效。");
  if (rules.length === 0 && samples.length === 0) {
    throw new Error("没有可写入的写法规则或例句。");
  }

  const loaded = await loadStylePreset(bookRoot);
  const preset: StylePreset = loaded.preset ?? createStylePreset();
  const existing = preset.sources.find((source) => source.id === MANUAL_STYLE_MEMORY_SOURCE_ID);

  const keptRules = [...(existing?.rules ?? [])];
  const knownRules = new Set(keptRules.map((rule) => normalizedRuleKey(rule.text)));
  for (const rule of rules) {
    const key = normalizedRuleKey(rule.text);
    if (knownRules.has(key)) continue;
    knownRules.add(key);
    keptRules.push(rule);
  }
  const keptSamples = [...(existing?.samples ?? [])];
  const knownSamples = new Set(keptSamples.map((sample) => sample.id));
  for (const sample of samples) {
    if (knownSamples.has(sample.id)) continue;
    knownSamples.add(sample.id);
    keptSamples.push(sample);
  }

  // 预设单来源规则与范文各限 100 条：超出时保留最新写入的（顺序即写入先后）。
  const source = {
    id: MANUAL_STYLE_MEMORY_SOURCE_ID,
    title: MANUAL_STYLE_MEMORY_SOURCE_TITLE,
    rules: keptRules.slice(-100),
    samples: keptSamples.slice(-100),
  };
  const next: StylePreset = {
    ...preset,
    sources: [source, ...preset.sources.filter((item) => item.id !== MANUAL_STYLE_MEMORY_SOURCE_ID)],
  };
  return saveStylePreset(bookRoot, next, expectedRevision);
}
