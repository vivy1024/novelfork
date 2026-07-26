/**
 * 引号遮罩 —— 只扫叙述层，不扫台词。
 *
 * 台词、系统播报、弹幕天然短促且允许口语重复，把它们计入 AI 味统计会产生大量误报。
 * 遮罩用等长占位符，保持字符偏移不变，这样命中位置仍可回指原文。
 */

/** 中文与英文引号对（含书名号外的成对符号）。 */
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["“", "”"],
  ["‘", "’"],
  ["「", "」"],
  ["『", "』"],
  ["\"", "\""],
];

const PLACEHOLDER = "\u3000";

/**
 * 把引号内内容替换为等长占位符。
 *
 * 未闭合的引号只遮到行尾，避免一个孤立引号把后文全部吞掉。
 */
export function maskQuoted(text: string): string {
  const chars = [...text];
  const out = [...chars];
  let index = 0;

  while (index < chars.length) {
    const char = chars[index]!;
    const pair = QUOTE_PAIRS.find(([open]) => open === char);
    if (!pair) {
      index += 1;
      continue;
    }
    const [, close] = pair;
    let cursor = index + 1;
    let closed = false;
    while (cursor < chars.length) {
      const current = chars[cursor]!;
      if (current === "\n") break;
      if (current === close) {
        closed = true;
        break;
      }
      cursor += 1;
    }
    const end = closed ? cursor : Math.min(cursor, chars.length);
    for (let i = index + 1; i < end; i += 1) {
      out[i] = PLACEHOLDER;
    }
    index = closed ? end + 1 : end;
  }

  return out.join("");
}

/** 正文汉字数（不含空白与占位符），用于密度分母。 */
export function countNarrativeChars(masked: string): number {
  let count = 0;
  for (const char of masked) {
    if (char === PLACEHOLDER) continue;
    if (/\s/u.test(char)) continue;
    count += 1;
  }
  return count;
}

/** 取文末窗口（按字符数），用于章尾预告腔这类只在结尾生效的规则。 */
export function tailWindow(text: string, size = 600): string {
  const chars = [...text];
  return chars.length <= size ? text : chars.slice(chars.length - size).join("");
}
