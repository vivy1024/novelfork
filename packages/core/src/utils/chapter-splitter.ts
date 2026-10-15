export interface SplitChapter {
  readonly title: string;
  readonly content: string;
}

/** 用户可提供的分章正则长度上限（字符数）。 */
const MAX_SPLIT_PATTERN_LENGTH = 128;
/** 单次切分的正文长度上限（字符数），防止超大导入占满内存。导入入口需引用同一常量。 */
export const MAX_SPLIT_TEXT_LENGTH = 2_000_000;
/** 用户规则只对不超过这个长度的行尝试匹配：章节标题不会更长，更长的行直接视为不匹配。 */
const MAX_SPLIT_LINE_LENGTH = 200;
/** 无界量词（* + {n,}）个数上限。 */
const MAX_UNBOUNDED_QUANTIFIERS = 4;
/** 单行最坏回溯组合数的预算（见下方「防卡死的三层」）。 */
const MAX_SPLIT_PATTERN_COST = 50_000_000;
/** 一次切分逐行识别标题的累计耗时上限。 */
const SPLIT_TIME_LIMIT_MS = 1_500;

/*
 * 用户分章规则（splitPattern）防卡死的三层，缺一不可：
 *
 * 1. 静态校验（validateSplitPattern，一个小型解析器，不再「用正则判定正则」）：
 *    - 分组后面只允许 `?`，`*` `+` `{n}` `{n,}` `{n,m}` 一律拒绝。指数级回溯来自
 *      「被重复的子模式对同一段文字有多种拆法」，(a|aa)+、((a+))+、(a?){24} 都是这一类；
 *      禁掉重复分组后，剩下的每个量词都只作用在单个字符或字符类上，复杂度退化为多项式。
 *    - 拒绝反向引用（\1、\k<名>）与环视（(?= (?! (?<= (?<!），它们不受上面的多项式论证约束。
 *    - 无界量词最多 4 个，长度最多 128。
 *    - 仅此还不够：`a?a?…a?aaa…b`（24 个 a?）没有任何重复分组，回溯仍是 2^24；
 *      `.*.*.*.*x` 在 200 字的行上也有约 7000 万种拆法（实测单行 3.7 秒）。所以再加一道组合预算：
 *      把每个量词可取的次数、每处 `|` 的分支数、未用 ^ 锚定时的起点数相乘，并利用
 *      「各量词吃掉的字数之和不超过行长」收紧上界，超过 5000 万即拒绝。
 *      量词后面紧跟一个与它字符集不相交的必选字符时（如 `\s*第`、`\d+章`），量词停在哪里是唯一的，
 *      不计入组合——正常的章节标题规则因此几乎不占预算。
 * 2. 行长上限：用户规则只对 ≤200 字的行尝试（行尾的 \r 先去掉）。第 1 层的预算以行长为参数，
 *    行长有界时单行最坏回溯次数才有界（开发机实测每次组合约 1~3ns，预算上限对应单行百毫秒级）。
 * 3. 累计时限：每处理一行检查一次累计耗时，超过 1500ms 立即报错。单行耗时已由第 2 层封顶，
 *    所以整次切分最多比时限多出一行的耗时，不会把服务线程卡住。
 *
 * 默认规则（不填 splitPattern 时）是仓库内写死的，逐个确认过没有「相邻且可互相让字、后面还有
 * 约束」的量词，对任意长的行都是线性的；累计时限同样覆盖它，作为兜底。
 */

class SplitPatternError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SplitPatternError";
  }
}

function rejectPattern(reason: string): never {
  throw new SplitPatternError(`splitPattern 不可用：${reason}`);
}

// ---------------------------------------------------------------------------
// 字符集（只用于判断「量词后面的必选字符能否把量词钉住」，拿不准时一律当作“任意字符”）
// ---------------------------------------------------------------------------

type Range = readonly [number, number];
type CharSet =
  | { readonly kind: "any" }
  | { readonly kind: "set"; readonly negated: boolean; readonly ranges: readonly Range[] };

const ANY: CharSet = { kind: "any" };
const DIGIT: readonly Range[] = [[0x30, 0x39]];
const WORD: readonly Range[] = [[0x30, 0x39], [0x41, 0x5a], [0x5f, 0x5f], [0x61, 0x7a]];
const SPACE: readonly Range[] = [
  [0x09, 0x0d], [0x20, 0x20], [0xa0, 0xa0], [0x1680, 0x1680], [0x2000, 0x200a],
  [0x2028, 0x2029], [0x202f, 0x202f], [0x205f, 0x205f], [0x3000, 0x3000], [0xfeff, 0xfeff],
];
const LINE_TERMINATORS: readonly Range[] = [[0x0a, 0x0a], [0x0d, 0x0d], [0x2028, 0x2029]];
const DOT: CharSet = { kind: "set", negated: true, ranges: LINE_TERMINATORS };

function charSet(negated: boolean, ranges: readonly Range[]): CharSet {
  return { kind: "set", negated, ranges };
}

function single(code: number): CharSet {
  return charSet(false, [[code, code]]);
}

/** [lo, hi] 是否被 ranges 的并集完全覆盖。 */
function covered(ranges: readonly Range[], lo: number, hi: number): boolean {
  let cursor = lo;
  for (const [start, end] of [...ranges].sort((left, right) => left[0] - right[0])) {
    if (start > cursor) break;
    if (end >= cursor) cursor = end + 1;
    if (cursor > hi) return true;
  }
  return cursor > hi;
}

function disjoint(left: CharSet, right: CharSet): boolean {
  if (left.kind === "any" || right.kind === "any") return false;
  if (left.negated && right.negated) return false;
  if (!left.negated && !right.negated) {
    return left.ranges.every(([lo, hi]) => right.ranges.every(([lo2, hi2]) => hi < lo2 || hi2 < lo));
  }
  const [negative, positive] = left.negated ? [left, right] : [right, left];
  return positive.ranges.every(([lo, hi]) => covered(negative.ranges, lo, hi));
}

// ---------------------------------------------------------------------------
// 解析器
// ---------------------------------------------------------------------------

interface Quantifier {
  readonly min: number;
  readonly max: number;
}

type Atom =
  | { readonly kind: "char"; readonly set: CharSet }
  | { readonly kind: "assertion"; readonly lineStart: boolean }
  | { readonly kind: "group"; readonly branches: readonly Branch[] };

interface Term {
  readonly atom: Atom;
  readonly quantifier: Quantifier | null;
}

type Branch = readonly Term[];

const QUANTIFIER_BRACES = /^\{(\d+)(?:(,)(\d*))?\}/u;

class SplitPatternParser {
  private pos = 0;
  unboundedQuantifiers = 0;

  constructor(private readonly source: string) {}

  parse(): readonly Branch[] {
    const branches = this.alternation();
    if (this.pos < this.source.length) rejectPattern(`第 ${this.pos + 1} 个字符处的「)」没有对应的「(」。`);
    return branches;
  }

  private alternation(): Branch[] {
    const branches = [this.sequence()];
    while (this.source[this.pos] === "|") {
      this.pos += 1;
      branches.push(this.sequence());
    }
    return branches;
  }

  private sequence(): Term[] {
    const terms: Term[] = [];
    while (this.pos < this.source.length && this.source[this.pos] !== "|" && this.source[this.pos] !== ")") {
      terms.push(this.term());
    }
    return terms;
  }

  private term(): Term {
    const atom = this.atom();
    const quantifierStart = this.pos;
    const quantifier = this.quantifier();
    if (!quantifier) return { atom, quantifier: null };
    const text = this.source.slice(quantifierStart, this.pos);
    if (atom.kind === "assertion") rejectPattern(`「${text}」前面是 ^ $ \\b 这类位置断言，没有可重复的内容。`);
    if (atom.kind === "group" && !(quantifier.min === 0 && quantifier.max === 1)) {
      rejectPattern(
        `第 ${quantifierStart} 个字符处的分组后面接了「${text}」。分组后只允许 ?（可有可无）；`
        + "重复的分组会让匹配回溯爆炸、卡住服务。请把重复写在单个字符或字符类上，例如 [一二三]+ 而不是 (一|二|三)+。",
      );
    }
    if (quantifier.max === Number.POSITIVE_INFINITY) this.unboundedQuantifiers += 1;
    if (this.source[this.pos] === "?") this.pos += 1; // 惰性量词
    if (this.peekQuantifier()) rejectPattern(`第 ${this.pos + 1} 个字符处量词连用，请只保留一个。`);
    return { atom, quantifier };
  }

  private peekQuantifier(): boolean {
    const char = this.source[this.pos];
    if (char === "*" || char === "+" || char === "?") return true;
    return char === "{" && QUANTIFIER_BRACES.test(this.source.slice(this.pos));
  }

  private quantifier(): Quantifier | null {
    const char = this.source[this.pos];
    if (char === "*" || char === "+" || char === "?") {
      this.pos += 1;
      return char === "*" ? { min: 0, max: Number.POSITIVE_INFINITY }
        : char === "+" ? { min: 1, max: Number.POSITIVE_INFINITY }
          : { min: 0, max: 1 };
    }
    if (char !== "{") return null;
    const match = QUANTIFIER_BRACES.exec(this.source.slice(this.pos));
    if (!match) return null; // 旧式语法里不构成量词的 { 是普通字符
    this.pos += match[0].length;
    const min = Number(match[1]);
    const max = match[2] === undefined ? min : match[3] === "" ? Number.POSITIVE_INFINITY : Number(match[3]);
    return { min, max };
  }

  private atom(): Atom {
    const char = this.source[this.pos]!;
    switch (char) {
      case "^":
      case "$":
        this.pos += 1;
        return { kind: "assertion", lineStart: char === "^" };
      case ".":
        this.pos += 1;
        return { kind: "char", set: DOT };
      case "[":
        return { kind: "char", set: this.characterClass() };
      case "(":
        return this.group();
      case "\\": {
        const escaped = this.escape(false);
        if (escaped === "boundary") return { kind: "assertion", lineStart: false };
        return { kind: "char", set: typeof escaped === "number" ? single(escaped) : escaped };
      }
      case "*":
      case "+":
      case "?":
        return rejectPattern(`第 ${this.pos + 1} 个字符「${char}」前面没有可重复的内容。`);
      default:
        if (char === "{" && this.peekQuantifier()) rejectPattern(`第 ${this.pos + 1} 个字符处的量词前面没有可重复的内容。`);
        this.pos += 1;
        return { kind: "char", set: single(char.charCodeAt(0)) };
    }
  }

  private group(): Atom {
    const start = this.pos;
    this.pos += 1;
    if (this.source[this.pos] === "?") {
      const next = this.source[this.pos + 1];
      if (next === ":") {
        this.pos += 2;
      } else if (next === "=" || next === "!") {
        rejectPattern(`不支持环视「${this.source.slice(start, start + 3)}」。请直接写出标题行本身的样子，例如 ^第\\d+章。`);
      } else if (next === "<") {
        const after = this.source[this.pos + 2];
        if (after === "=" || after === "!") {
          rejectPattern(`不支持环视「${this.source.slice(start, start + 4)}」。请直接写出标题行本身的样子，例如 ^第\\d+章。`);
        }
        const close = this.source.indexOf(">", this.pos + 2);
        if (close < 0) rejectPattern("命名分组缺少「>」。");
        this.pos = close + 1;
      } else {
        rejectPattern(`不支持的分组写法「(?${next ?? ""}」，只支持 (…)、(?:…) 与 (?<名字>…)。`);
      }
    }
    const branches = this.alternation();
    if (this.source[this.pos] !== ")") rejectPattern(`第 ${start + 1} 个字符处的「(」没有闭合。`);
    this.pos += 1;
    return { kind: "group", branches };
  }

  /** 读一个转义。单个字符返回码位；字符类返回字符集；\b \B 在类外返回 "boundary"。 */
  private escape(inClass: boolean): number | CharSet | "boundary" {
    this.pos += 1;
    const char = this.source[this.pos];
    if (char === undefined) return rejectPattern("规则以单独的 \\ 结尾。");
    this.pos += 1;
    if (char >= "1" && char <= "9") {
      rejectPattern(`不支持反向引用（\\${char}）。反向引用无法保证匹配在限定时间内结束，章节标题规则也用不到它，请删掉。`);
    }
    if (char === "k" && this.source[this.pos] === "<") {
      rejectPattern("不支持反向引用（\\k<名字>）。反向引用无法保证匹配在限定时间内结束，章节标题规则也用不到它，请删掉。");
    }
    switch (char) {
      case "d": return charSet(false, DIGIT);
      case "D": return charSet(true, DIGIT);
      case "w": return charSet(false, WORD);
      case "W": return charSet(true, WORD);
      case "s": return charSet(false, SPACE);
      case "S": return charSet(true, SPACE);
      case "b": return inClass ? 0x08 : "boundary";
      case "B": return inClass ? 0x42 : "boundary";
      case "t": return 0x09;
      case "n": return 0x0a;
      case "v": return 0x0b;
      case "f": return 0x0c;
      case "r": return 0x0d;
      case "0": return ANY; // \0 与旧式八进制：保守按任意字符处理
      case "x":
      case "u": {
        const width = char === "x" ? 2 : 4;
        const hex = this.source.slice(this.pos, this.pos + width);
        if (new RegExp(`^[0-9a-fA-F]{${width}}$`, "u").test(hex)) {
          this.pos += width;
          return Number.parseInt(hex, 16);
        }
        return char.charCodeAt(0);
      }
      case "c": {
        const letter = this.source[this.pos];
        if (letter !== undefined && /^[A-Za-z]$/u.test(letter)) {
          this.pos += 1;
          return letter.charCodeAt(0) % 32;
        }
        return ANY;
      }
      default:
        return char.charCodeAt(0);
    }
  }

  private classAtom(): number | CharSet {
    if (this.source[this.pos] === "\\") {
      const escaped = this.escape(true);
      return escaped === "boundary" ? ANY : escaped;
    }
    const code = this.source.charCodeAt(this.pos);
    this.pos += 1;
    return code;
  }

  private characterClass(): CharSet {
    const start = this.pos;
    this.pos += 1;
    let negated = false;
    if (this.source[this.pos] === "^") {
      negated = true;
      this.pos += 1;
    }
    const ranges: Range[] = [];
    let unknown = false;
    const add = (item: number | CharSet): void => {
      if (typeof item === "number") ranges.push([item, item]);
      else if (item.kind === "set" && !item.negated) ranges.push(...item.ranges);
      else unknown = true;
    };
    for (;;) {
      const char = this.source[this.pos];
      if (char === undefined) rejectPattern(`第 ${start + 1} 个字符处的「[」没有闭合。`);
      if (char === "]") {
        this.pos += 1;
        break;
      }
      const left = this.classAtom();
      if (this.source[this.pos] === "-" && this.pos + 1 < this.source.length && this.source[this.pos + 1] !== "]") {
        this.pos += 1;
        const right = this.classAtom();
        if (typeof left === "number" && typeof right === "number") {
          if (right < left) rejectPattern("字符区间前后颠倒。");
          ranges.push([left, right]);
        } else {
          add(left);
          add(0x2d);
          add(right);
        }
        continue;
      }
      add(left);
    }
    return unknown ? ANY : charSet(negated, ranges);
  }
}

// ---------------------------------------------------------------------------
// 组合预算
// ---------------------------------------------------------------------------

/** 不带量词、只有一个分支的分组对回溯是透明的，展开后才能看到「量词后面紧跟的字符」。 */
function flatten(terms: Branch): Term[] {
  const flat: Term[] = [];
  for (const term of terms) {
    if (term.atom.kind === "group" && !term.quantifier && term.atom.branches.length === 1) {
      flat.push(...flatten(term.atom.branches[0]!));
    } else {
      flat.push(term);
    }
  }
  return flat;
}

/** 量词后面紧跟一个与它不相交的必选字符：量词只能停在该字符前，停止位置唯一。 */
function pinnedBy(set: CharSet, next: Term | undefined): boolean {
  if (!next || next.atom.kind !== "char") return false;
  if (next.quantifier && next.quantifier.min < 1) return false;
  return disjoint(set, next.atom.set);
}

const COST_CEILING = 1e30;

/** 各量词额外重复次数 r_i ∈ [0, cap_i] 且 Σ r_i ≤ total 的取法数（单字符量词每次重复至少吃一个字）。 */
function countSplits(caps: readonly number[], total: number): number {
  let ways = new Array<number>(total + 1).fill(0);
  ways[0] = 1;
  for (const cap of caps) {
    const next = new Array<number>(total + 1).fill(0);
    for (let sum = 0; sum <= total; sum += 1) {
      let value = 0;
      for (let taken = 0; taken <= Math.min(cap, sum); taken += 1) value += ways[sum - taken]!;
      next[sum] = Math.min(value, COST_CEILING);
    }
    ways = next;
  }
  return Math.min(ways.reduce((sum, value) => sum + value, 0), COST_CEILING);
}

function estimateBacktracking(branches: readonly Branch[]): number {
  const caps: number[] = [];
  let factor = 1;
  const visitAlternation = (alternatives: readonly Branch[]): void => {
    if (alternatives.length > 1) factor = Math.min(factor * alternatives.length, COST_CEILING);
    for (const branch of alternatives) visitSequence(flatten(branch));
  };
  const visitSequence = (terms: readonly Term[]): void => {
    terms.forEach((term, index) => {
      if (term.atom.kind === "group") {
        if (term.quantifier) factor = Math.min(factor * 2, COST_CEILING); // 只可能是 ?：走与不走
        visitAlternation(term.atom.branches);
        return;
      }
      if (term.atom.kind !== "char" || !term.quantifier) return;
      const extra = Math.min(term.quantifier.max, MAX_SPLIT_LINE_LENGTH) - Math.min(term.quantifier.min, MAX_SPLIT_LINE_LENGTH);
      if (extra <= 0 || pinnedBy(term.atom.set, terms[index + 1])) return;
      caps.push(extra);
    });
  };
  visitAlternation(branches);
  // 不是每个分支都以 ^ 开头时，引擎会从行内每个位置各试一次，相当于前面多一个可变长度。
  const anchored = branches.every((branch) => {
    const first = flatten(branch)[0];
    return first?.atom.kind === "assertion" && first.atom.lineStart;
  });
  if (!anchored) caps.push(MAX_SPLIT_LINE_LENGTH);
  return Math.min(countSplits(caps, MAX_SPLIT_LINE_LENGTH) * factor, COST_CEILING);
}

function formatCount(value: number): string {
  if (value >= COST_CEILING) return "天文数字";
  if (value >= 1e8) return `${(value / 1e8).toFixed(1)} 亿`;
  if (value >= 1e4) return `${Math.round(value / 1e4)} 万`;
  return String(Math.round(value));
}

/** 校验用户分章规则并编译。拒绝时抛出的消息说明了哪条规则不满足、为什么、怎么改。 */
function validateSplitPattern(pattern: string): RegExp {
  if (pattern.length > MAX_SPLIT_PATTERN_LENGTH) {
    rejectPattern(`规则长度 ${pattern.length} 超过 ${MAX_SPLIT_PATTERN_LENGTH} 字符上限。请缩短规则，或留空使用自动识别。`);
  }
  let regex: RegExp;
  try {
    // 不加 m：^ $ 只认行首行尾。逐行匹配前已去掉行尾 \r，CRLF 正文照常命中。
    regex = new RegExp(pattern);
  } catch (error) {
    return rejectPattern(`不是有效的正则表达式（${error instanceof Error ? error.message : String(error)}）。请检查括号与转义，或留空使用自动识别。`);
  }
  const parser = new SplitPatternParser(pattern);
  const branches = parser.parse();
  if (parser.unboundedQuantifiers > MAX_UNBOUNDED_QUANTIFIERS) {
    rejectPattern(
      `无界量词（* + {n,}）用了 ${parser.unboundedQuantifiers} 个，最多 ${MAX_UNBOUNDED_QUANTIFIERS} 个。`
      + "请删去多余的 .* \\s* 之类写法。",
    );
  }
  const cost = estimateBacktracking(branches);
  if (cost > MAX_SPLIT_PATTERN_COST) {
    rejectPattern(
      `规则里可变长度的部分组合过多（单行最坏约 ${formatCount(cost)} 种拆法，上限 ${formatCount(MAX_SPLIT_PATTERN_COST)}），`
      + "可能让匹配卡住。请减少相邻的 .* / ? / {m,n} / |，或在开头加 ^ 锚定行首。",
    );
  }
  return regex;
}

// ---------------------------------------------------------------------------
// 执行
// ---------------------------------------------------------------------------

const DEFAULT_CHAPTER_PATTERN = /^#{0,2}\s*(?:第[零〇○Ｏ０一二三四五六七八九十百千万\d]+(?:章|回)(?:[:：]|\s+)?\s*(.*)|Chapter\s+(?:\d+|[IVXLCDM]+)(?:\.|:|\s+)?\s*(.*))/i;
/**
 * 卷标题行。标题取「卷」之后到行尾的全部文字，交给调用方 trim。
 * 旧写法 `\s*(.*?)[ 　]*\r?$` 里惰性 .*? 与后面的空白量词互相让字，长空白行上是二次回溯
 * （6 万空格实测 3 秒）；这里改为一个吃到行尾的否定字符类，对任意长的行都是线性的。
 */
const VOLUME_HEADING_PATTERN = /^#{0,2}\s*第[零〇○Ｏ０一二三四五六七八九十百千万\d]+卷([^\r\n\p{Zl}\p{Zp}]*)\r?$/iu;

type LineMatcher = (line: string) => RegExpExecArray | null;

function createChapterMatcher(userPattern: string | undefined): LineMatcher {
  if (userPattern === undefined) return (line) => DEFAULT_CHAPTER_PATTERN.exec(line);
  const regex = validateSplitPattern(userPattern);
  return (line) => {
    const candidate = line.endsWith("\r") ? line.slice(0, -1) : line;
    return candidate.length <= MAX_SPLIT_LINE_LENGTH ? regex.exec(candidate) : null;
  };
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** 逐行调用；累计耗时超过时限即抛错。 */
function createDeadline(userPattern: string | undefined): (processedLines: number) => void {
  const startedAt = now();
  return (processedLines) => {
    if (now() - startedAt <= SPLIT_TIME_LIMIT_MS) return;
    throw new Error(userPattern === undefined
      ? `分章执行超时：逐行识别章节标题超过 ${SPLIT_TIME_LIMIT_MS}ms（已处理 ${processedLines} 行），正文可能过大或格式异常，请分批导入。`
      : `分章规则执行超时，请简化规则或不填写（逐行匹配 ${processedLines} 行已超过 ${SPLIT_TIME_LIMIT_MS}ms）。`);
  };
}

function assertTextSize(text: string): void {
  if (text.length > MAX_SPLIT_TEXT_LENGTH) {
    throw new Error(`正文超过 ${MAX_SPLIT_TEXT_LENGTH} 字符上限，请分批导入`);
  }
}

/**
 * Split a single text file into chapters by matching title lines.
 *
 * Default pattern matches:
 * - "第一章 xxxx" / "第1章 xxxx"
 * - "第一回 xxxx" / "第1回 xxxx"
 * - "# 第1章 xxxx" / "## 第23章 xxxx"
 * - "CHAPTER I." / "CHAPTER II."
 *
 * Each match marks the start of a new chapter. Content between matches
 * belongs to the preceding chapter.
 *
 * 自定义 pattern 的校验与执行限制见文件开头「防卡死的三层」；splitChaptersWithVolumes 走同一套。
 */
export function splitChapters(
  text: string,
  pattern?: string,
): ReadonlyArray<SplitChapter> {
  const userPattern = pattern || undefined;
  const matchChapter = createChapterMatcher(userPattern);
  assertTextSize(text);
  const checkDeadline = createDeadline(userPattern);

  const lines = text.split("\n");
  const chapters: Array<{ title: string; startLine: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const match = matchChapter(lines[i]!);
    if (match) {
      chapters.push({
        title: (match[1] ?? match[2] ?? "").trim(),
        startLine: i,
      });
    }
    checkDeadline(i + 1);
  }

  if (chapters.length === 0) {
    return [];
  }

  const result: SplitChapter[] = [];

  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i]!;
    const nextStart = i + 1 < chapters.length ? chapters[i + 1]!.startLine : lines.length;

    // Content starts after the title line
    const contentLines = lines.slice(chapter.startLine + 1, nextStart);
    const content = stripTrailingLicense(contentLines.join("\n")).trim();

    result.push({
      title: chapter.title || inferFallbackTitle(lines[chapter.startLine] ?? "", i + 1),
      content,
    });
  }

  return result;
}

/**
 * 去掉 Project Gutenberg 尾注。行首空白只认不跨行的空白：旧写法 `^\s*` 会吞掉后面所有空行，
 * 每个行首都重扫一遍，10 万空行实测 4 秒以上（二次复杂度）。全角缩进仍然认得。
 */
function stripTrailingLicense(content: string): string {
  const trailerMatch = content.match(/^[^\S\r\n\p{Zl}\p{Zp}]*Project Gutenberg(?:™|\(TM\))?.*$/imu);
  if (!trailerMatch || trailerMatch.index === undefined) {
    return content;
  }

  return content.slice(0, trailerMatch.index).trimEnd();
}

function inferFallbackTitle(headingLine: string, chapterNumber: number): string {
  if (/chapter\s+(?:\d+|[ivxlcdm]+)/i.test(headingLine)) {
    return `Chapter ${chapterNumber}`;
  }

  if (/第[零一二三四五六七八九十百千万\d]+回/.test(headingLine)) {
    return `第${chapterNumber}回`;
  }

  return `第${chapterNumber}章`;
}

export interface SplitVolume {
  /** 卷序号（1 起始；原文没有卷标题的旧稿整体算一卷）。 */
  readonly index: number;
  /** 卷标题正文（如「光与影」）；无名卷为 "未命名卷"。 */
  readonly title: string;
}

export interface SplitChapterWithVolume extends SplitChapter {
  /** 该章所属卷（1 起始）。 */
  readonly volumeIndex: number;
}

/**
 * 带卷捕获的切章：除了按 splitChapters 同一特征切章，还认「第N卷 卷标题」行，
 * 记录每章所属卷，并把卷标题行从上一章正文末尾剔除（splitChapters 会把卷标题吃进上一章正文）。
 * 原文没有卷标题时整体归为一卷（index=1），与旧行为相容。
 */
export function splitChaptersWithVolumes(
  text: string,
  pattern?: string,
): { volumes: readonly SplitVolume[]; chapters: readonly SplitChapterWithVolume[] } {
  const userPattern = pattern || undefined;
  const matchChapter = createChapterMatcher(userPattern);
  assertTextSize(text);
  const checkDeadline = createDeadline(userPattern);

  const lines = text.split("\n");
  const volumeMarkers: Array<{ title: string; line: number }> = [];
  const chapterMarkers: Array<{ title: string; line: number }> = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    const volumeMatch = userPattern === undefined ? VOLUME_HEADING_PATTERN.exec(line) : null;
    if (volumeMatch) {
      volumeMarkers.push({ title: (volumeMatch[1] ?? "").trim(), line: lineIndex });
    } else {
      const chapterMatch = matchChapter(line);
      if (chapterMatch) {
        chapterMarkers.push({ title: (chapterMatch[1] ?? chapterMatch[2] ?? "").trim(), line: lineIndex });
      }
    }
    checkDeadline(lineIndex + 1);
  }

  if (chapterMarkers.length === 0) return { volumes: [], chapters: [] };

  const volumes: SplitVolume[] = [];
  volumeMarkers.forEach((marker, index) => {
    volumes.push({ index: index + 1, title: marker.title || "未命名卷" });
  });

  // 章节标记按行号递增，卷标记同样递增：用一个游标线性推进
  // （旧写法对每章遍历全部卷再 indexOf，上千卷时是三次方级）。
  let volumesBefore = 0;
  const chapters: SplitChapterWithVolume[] = [];
  for (let index = 0; index < chapterMarkers.length; index += 1) {
    const marker = chapterMarkers[index]!;
    while (volumesBefore < volumeMarkers.length && volumeMarkers[volumesBefore]!.line <= marker.line) volumesBefore += 1;
    const contentStart = marker.line + 1;
    const contentEnd = index + 1 < chapterMarkers.length ? chapterMarkers[index + 1]!.line : lines.length;
    // 本段正文（卷标题行自然落在段内时从尾部剔除）
    const tail = lines.slice(contentStart, contentEnd);
    let cutIndex = tail.length;
    for (let lineIndex = tail.length - 1; lineIndex >= 0; lineIndex -= 1) {
      if (VOLUME_HEADING_PATTERN.test(tail[lineIndex]!)) cutIndex = lineIndex;
    }
    const content = stripTrailingLicense(tail.slice(0, cutIndex).join("\n")).trim();
    chapters.push({
      title: marker.title || inferFallbackTitle(lines[marker.line] ?? "", index + 1),
      content,
      volumeIndex: volumesBefore === 0 ? 1 : volumesBefore,
    });
  }

  return { volumes, chapters };
}
