/**
 * 文风蒸馏「证据是否在原文中」比对专用的逐字归一。只用于比对，不改存储的原文证据：
 * 调用方按归一串定位后，回到原文按下标取逐字片段。
 *
 * 归一会删字（空白、引号），归一串与原文不再一一对应，所以同时产出「归一串第 i 个码点 → 原文起止下标」
 * 的映射，调用方据此取回原文原字（删掉的引号若落在片段中间，会随原文一并取回）。覆盖：
 * - 各类引号与括引号（“”‘’「」『』〈〉《》〔〕﹁﹂﹃﹄ 及半角 " '）一律忽略：模型常把引号改成别的样式，
 *   也常整个省掉（原文「說是〈外傳〉」写成「說是外傳」），两边都删掉才比得上；
 * - 全角 ASCII（Ｑ、１、，等 U+FF01–FF5E）转半角，再把常见半角标点统一回中文全角；
 * - ASCII 字母不分大小写；
 * - 模型常把繁体原文写成简体（或反之）：繁简表在 engine/text/zh-variants（与剧情线标题解析共用），两边同样处理。
 */

import { toSimplifiedChar } from "../text/zh-variants.js";

const QUOTE_CHARS = new Set([..."“”„‟〝〞＂\"'‘’‛′″「」『』﹁﹂﹃﹄〈〉《》〔〕〖〗【】＜＞‹›«»"]);

/** 半角标点统一到中文全角（全角 ASCII 先转半角，再经这里回到同一个全角字符）。 */
const PUNCTUATION_PAIRS: Readonly<Record<string, string>> = {
  ",": "，", ";": "；", ":": "：", "!": "！", "?": "？", "(": "（", ")": "）",
};

/** 单字归一：输入一个码点，输出一个码点；比对时忽略的字符（空白、引号与括引号）返回空串。 */
export function normalizeEvidenceChar(char: string): string {
  if (/^\s$/u.test(char)) return "";
  let value = char;
  const code = value.codePointAt(0)!;
  // 全角 ASCII（！到～）→ 半角
  if (code >= 0xff01 && code <= 0xff5e) value = String.fromCodePoint(code - 0xfee0);
  if (QUOTE_CHARS.has(value)) return "";
  const punctuation = PUNCTUATION_PAIRS[value];
  if (punctuation) return punctuation;
  if (/^[A-Z]$/u.test(value)) return value.toLowerCase();
  return toSimplifiedChar(value);
}

export interface NormalizedEvidenceText {
  readonly value: string;
  /** 归一串第 i 个码点在原文里的起止位置（UTF-16 下标）；被忽略的原文字符不占位。 */
  readonly starts: readonly number[];
  readonly ends: readonly number[];
}

/** 逐字归一并删去忽略字符，同时记下每个保留字符在原文里的位置，便于取回原文片段。 */
export function normalizeEvidenceWithMap(text: string): NormalizedEvidenceText {
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let offset = 0;
  for (const char of text) {
    const normalized = normalizeEvidenceChar(char);
    if (normalized) {
      chars.push(normalized);
      starts.push(offset);
      ends.push(offset + char.length);
    }
    offset += char.length;
  }
  return { value: chars.join(""), starts, ends };
}

export function normalizeEvidenceForMatch(text: string): string {
  return normalizeEvidenceWithMap(text).value;
}
