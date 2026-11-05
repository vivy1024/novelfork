/**
 * 引号内对白区间（纯函数，按 UTF-16 下标，与 String.slice 一致）。
 *
 * 自审与人文化都约定「对白不动」：规则只看叙述层，命中落在引号内的一律不报，
 * 交给叙述者的清单里也不出现对白句。
 */

/** 成对引号。半角双引号开闭同形，按同一行内配对。 */
const QUOTE_PAIRS: ReadonlyMap<string, string> = new Map([
  ["“", "”"],
  ["「", "」"],
  ["『", "』"],
  ["‘", "’"],
  ["\"", "\""],
]);

/** 遮罩占位符：全角空格，宽度与汉字一致，不会被规则当成文字或句末标点。 */
export const DIALOGUE_MASK_CHAR = "\u3000";

export interface DialogueRange {
  /** 开引号下标（含）。 */
  readonly start: number;
  /** 闭引号之后的下标（不含）；未闭合时到行尾。 */
  readonly end: number;
}

/**
 * 找出最外层引号区间（含引号本身）。嵌套的『』‘’ 随外层一起覆盖。
 * 未闭合的引号只算到行尾：网文里跨段长对白每段只开不闭，同时也防止一个孤立引号吞掉后文。
 */
export function findDialogueRanges(text: string): DialogueRange[] {
  const ranges: DialogueRange[] = [];
  let index = 0;
  while (index < text.length) {
    const close = QUOTE_PAIRS.get(text[index]!);
    if (!close) {
      index += 1;
      continue;
    }
    let cursor = index + 1;
    let depth = 0;
    let closedAt = -1;
    const open = text[index]!;
    while (cursor < text.length) {
      const char = text[cursor]!;
      if (char === "\n") break;
      if (char === close && depth === 0) {
        closedAt = cursor;
        break;
      }
      // 同种引号嵌套（“…“…”…”）少见但存在，按深度配对；半角双引号开闭同形不计深度。
      if (open !== close) {
        if (char === open) depth += 1;
        else if (char === close) depth -= 1;
      }
      cursor += 1;
    }
    const end = closedAt >= 0 ? closedAt + 1 : cursor;
    ranges.push({ start: index, end });
    index = end;
  }
  return ranges;
}

/** [start, end) 与任一对白区间有交集。 */
export function overlapsDialogue(ranges: readonly DialogueRange[], start: number, end: number): boolean {
  return ranges.some((range) => range.start < end && range.end > start);
}

/** 把对白区间（含引号）替换成等长占位符，字符偏移不变，命中仍可回指原文。 */
export function maskDialogue(text: string, ranges: readonly DialogueRange[] = findDialogueRanges(text)): string {
  if (ranges.length === 0) return text;
  let result = "";
  let cursor = 0;
  for (const range of ranges) {
    result += text.slice(cursor, range.start) + DIALOGUE_MASK_CHAR.repeat(range.end - range.start);
    cursor = range.end;
  }
  return result + text.slice(cursor);
}

/**
 * `fragment` 在 `sentence` 里的每一处出现都落在对白内（或根本找不到）。
 * 给只拿到原句与命中文字、拿不到下标的调用方（如交叙述者的清单）兜底判断用。
 */
export function fragmentOnlyInDialogue(sentence: string, fragment: string): boolean {
  if (!fragment) return false;
  const ranges = findDialogueRanges(sentence);
  if (ranges.length === 0) return false;
  let index = sentence.indexOf(fragment);
  if (index < 0) return false;
  while (index >= 0) {
    if (!ranges.some((range) => range.start <= index && range.end >= index + fragment.length)) return false;
    index = sentence.indexOf(fragment, index + 1);
  }
  return true;
}
