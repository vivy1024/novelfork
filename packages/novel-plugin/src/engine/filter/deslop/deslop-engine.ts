/**
 * 去 AI 味主执行器。
 *
 * 流程：收集全部候选编辑 → 按位置排序并剔除重叠 → 一次性套用 → 收集需要
 * 语义判断的标注项。全过程不调模型，可在保存前同步跑完。
 */

import { tokenizeChineseText } from "../engine/tokenizer.js";
import {
  DELETABLE_TERMS,
  PHRASE_PATTERNS,
  PUNCTUATION_RULES,
  WEAK_ADVERBS,
} from "./dictionaries.js";
import {
  CONSECUTIVE_SUBJECTS,
  CONSECUTIVE_SUBJECT_INSTRUCTION,
  MANUAL_RULES,
} from "./manual-rules.js";
import type {
  DeslopEdit,
  DeslopManualFlag,
  DeslopOptions,
  DeslopResult,
} from "./types.js";

function isWhitelisted(fragment: string, whitelist: readonly string[]): boolean {
  return whitelist.some((entry) => entry.length > 0 && (entry.includes(fragment) || fragment.includes(entry)));
}

/** 收集可确定性删除的套词。 */
function collectDeletableEdits(text: string, whitelist: readonly string[]): DeslopEdit[] {
  const edits: DeslopEdit[] = [];
  for (const term of DELETABLE_TERMS) {
    let index = text.indexOf(term);
    while (index >= 0) {
      if (!isWhitelisted(term, whitelist)) {
        edits.push({
          start: index,
          end: index + term.length,
          original: term,
          replacement: "",
          rule: "deletable-term",
          reason: `「${term}」是 AI 高频套词，删除后语义不减`,
        });
      }
      index = text.indexOf(term, index + term.length);
    }
  }
  return edits;
}

/** 正则型确定性改写（句式 + 标点）。 */
function collectPatternEdits(text: string, whitelist: readonly string[]): DeslopEdit[] {
  const edits: DeslopEdit[] = [];
  for (const spec of [...PHRASE_PATTERNS, ...PUNCTUATION_RULES]) {
    for (const match of text.matchAll(spec.pattern)) {
      const start = match.index ?? 0;
      const original = match[0];
      if (isWhitelisted(original, whitelist)) continue;
      const replacement = spec.replace(match);
      if (replacement === original) continue;
      edits.push({
        start,
        end: start + original.length,
        original,
        replacement,
        rule: spec.rule,
        reason: spec.reason,
      });
    }
  }
  return edits;
}

/** 弱化副词按预算删超额部分，保留自然使用。 */
function collectWeakAdverbEdits(
  text: string,
  whitelist: readonly string[],
  budgetPer1000: number,
): DeslopEdit[] {
  const hits: Array<{ start: number; term: string }> = [];
  for (const term of WEAK_ADVERBS) {
    let index = text.indexOf(term);
    while (index >= 0) {
      if (!isWhitelisted(term, whitelist)) hits.push({ start: index, term });
      index = text.indexOf(term, index + term.length);
    }
  }
  // 密度语义是「每千字不超过 N 次」。不足千字时无法判断密度，因此预算取
  // `budgetPer1000` 作为下限 —— 否则短选段里的单次自然使用会被误删。
  const budget = Math.max(budgetPer1000, Math.ceil((text.length / 1000) * budgetPer1000));
  if (hits.length <= budget) return [];
  // 保留靠前的自然使用，删掉超额的后续复现。
  return hits
    .sort((a, b) => a.start - b.start)
    .slice(budget)
    .map((hit) => ({
      start: hit.start,
      end: hit.start + hit.term.length,
      original: hit.term,
      replacement: "",
      rule: "weak-adverb-budget",
      reason: `弱化副词超出每千字 ${budgetPer1000} 次预算，删除超额复现`,
    }));
}

/** 剔除重叠区间：同一段文字只允许一条规则改写，先到先得。 */
function resolveOverlaps(edits: readonly DeslopEdit[]): DeslopEdit[] {
  const sorted = [...edits].sort((a, b) => (a.start - b.start) || (b.end - b.start) - (a.end - a.start));
  const kept: DeslopEdit[] = [];
  let cursor = -1;
  for (const edit of sorted) {
    if (edit.start < cursor) continue;
    kept.push(edit);
    cursor = edit.end;
  }
  return kept;
}

function applyEdits(text: string, edits: readonly DeslopEdit[]): string {
  let result = "";
  let cursor = 0;
  for (const edit of edits) {
    result += text.slice(cursor, edit.start) + edit.replacement;
    cursor = edit.end;
  }
  result += text.slice(cursor);
  // 编辑后可能留下重复标点或首部逗号，做一次轻收敛。
  return result
    .replace(/，{2,}/gu, "，")
    .replace(/。{2,}/gu, "。")
    .replace(/([。！？])，/gu, "$1")
    .replace(/^[，。]+/gu, "");
}

function collectManualFlags(text: string): DeslopManualFlag[] {
  const flags: DeslopManualFlag[] = [];
  for (const spec of MANUAL_RULES) {
    for (const match of text.matchAll(spec.pattern)) {
      const start = match.index ?? 0;
      flags.push({
        start,
        end: start + match[0].length,
        excerpt: match[0],
        rule: spec.rule,
        reason: spec.reason,
        instruction: spec.instruction,
      });
    }
  }
  flags.push(...collectConsecutiveSubjectFlags(text));
  return flags.sort((a, b) => a.start - b.start);
}

/** 连续三句同词开头：只定位，改写交给语义层。 */
function collectConsecutiveSubjectFlags(text: string): DeslopManualFlag[] {
  const sentences = tokenizeChineseText(text).sentences;
  if (sentences.length < 3) return [];
  const flags: DeslopManualFlag[] = [];
  for (let i = 0; i <= sentences.length - 3; i += 1) {
    const window = [sentences[i], sentences[i + 1], sentences[i + 2]];
    const subject = CONSECUTIVE_SUBJECTS.find((candidate) =>
      window.every((sentence) => sentence.text.trim().startsWith(candidate)),
    );
    if (!subject) continue;
    flags.push({
      start: window[0].start,
      end: window[2].end,
      excerpt: window.map((sentence) => sentence.text).join(""),
      rule: "consecutive-subject",
      reason: `连续 3 句以「${subject}」开头`,
      instruction: CONSECUTIVE_SUBJECT_INSTRUCTION,
    });
  }
  return flags;
}

/** 纯规则去 AI 味：返回改写结果与需人工/叙述者处理的标注。 */
export function deslopText(text: string, options: DeslopOptions = {}): DeslopResult {
  const whitelist = options.whitelist ?? [];
  const budget = options.weakAdverbBudgetPer1000 ?? 3;
  const candidates = [
    ...collectPatternEdits(text, whitelist),
    ...collectDeletableEdits(text, whitelist),
    ...collectWeakAdverbEdits(text, whitelist, budget),
  ];
  const edits = resolveOverlaps(candidates);
  const result = applyEdits(text, edits);
  const manualFlags = collectManualFlags(text);

  return {
    original: text,
    text: result,
    edits,
    manualFlags,
    stats: {
      originalLength: text.length,
      resultLength: result.length,
      autoEditCount: edits.length,
      manualFlagCount: manualFlags.length,
    },
  };
}
