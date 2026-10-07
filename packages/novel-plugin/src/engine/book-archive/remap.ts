/**
 * 导入时的 ID 重映射。
 *
 * 策略（导出 → 导入为新书，同一台机器上源书仍在也不冲突）：
 * 1. bookId 换成新生成的 bookId。
 * 2. 各表的自有主键（单列 TEXT 主键）逐个换新：
 *    - 主键里嵌着的「令牌」——旧 bookId（含其 URL 编码形式）与其中出现的每个 UUID——
 *      换成新 bookId / 新 UUID；同一个旧令牌在整份档案里始终换成同一个新值。
 *      例如 `scene:<旧书>:<uuid>` → `scene:<新书>:<新uuid>`，经纬条目 `<uuid>` → `<新uuid>`。
 *    - 不含任何令牌的主键（如 `prog-<时间戳>-1`）保持原样；只有与目标库已有行冲突时，
 *      才追加 `~imp<随机>` 后缀，并把「旧全值 → 新全值」也登记为令牌，保证复合 ID 里的引用一起改。
 * 3. 引用改写：
 *    - `book_id` 列 → 新 bookId；自有主键列 → 按上面的映射。
 *    - 名字像引用的列（id / *_id / *_ids / *_ref / *_refs）：先按全值查映射，查不到再做令牌替换。
 *    - JSON 列（*_json 及登记的少数列）：解析后逐个字符串叶子与对象键按同样规则改写，再序列化。
 *    - 正文、标题、摘要等自由文本列一律不动。
 *    令牌替换只作用于「像 ID 的」字符串（无空白、≤ 256 字符），避免误改作者文本。
 */
import { randomUUID } from "node:crypto";

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu;
const REFERENCE_COLUMN = /(?:^|_)(?:id|ids|ref|refs)$/u;
const EXTRA_JSON_COLUMNS = new Set(["revision_history"]);
const MAX_ID_LIKE_LENGTH = 256;
/** 按全值查映射时忽略过短的旧 ID，避免把 "main"、"1" 这类常见值误当成引用。 */
const MIN_EXACT_MATCH_LENGTH = 8;
/** 冲突改名后的旧全值只有足够长才登记为子串令牌。 */
const MIN_RENAMED_TOKEN_LENGTH = 12;

export function isReferenceColumn(column: string): boolean {
  return REFERENCE_COLUMN.test(column);
}

export function isJsonColumn(column: string): boolean {
  return column.endsWith("_json") || EXTRA_JSON_COLUMNS.has(column);
}

function isIdLike(value: string): boolean {
  return value.length > 0 && value.length <= MAX_ID_LIKE_LENGTH && !/\s/u.test(value);
}

export interface IdRemapStats {
  readonly remapped: number;
  readonly kept: number;
  readonly renamedOnCollision: number;
}

export class IdRemapper {
  readonly oldBookId: string;
  readonly newBookId: string;
  private readonly idMap = new Map<string, string>();
  private readonly uuidMap = new Map<string, string>();
  private readonly literalTokens = new Map<string, string>();
  private kept = 0;
  private renamed = 0;

  constructor(oldBookId: string, newBookId: string) {
    this.oldBookId = oldBookId;
    this.newBookId = newBookId;
    this.literalTokens.set(oldBookId, newBookId);
    const encodedOld = encodeURIComponent(oldBookId);
    if (encodedOld !== oldBookId) this.literalTokens.set(encodedOld, encodeURIComponent(newBookId));
  }

  /** 登记一个自有主键里的 UUID 令牌（第一遍扫描时调用）。 */
  collectTokens(ownedId: string): void {
    for (const match of ownedId.matchAll(UUID_PATTERN)) {
      const token = match[0];
      if (!this.uuidMap.has(token)) this.uuidMap.set(token, randomUUID());
    }
  }

  /** 替换字符串里的全部令牌。 */
  applyTokens(value: string): string {
    let result = value;
    for (const [from, to] of this.literalTokens) {
      if (result.includes(from)) result = result.split(from).join(to);
    }
    if (this.uuidMap.size > 0) {
      result = result.replace(UUID_PATTERN, (token) => this.uuidMap.get(token) ?? token);
    }
    return result;
  }

  /**
   * 为自有主键分配新值（第二遍）。`exists` 用来检查目标库同表是否已有同名主键。
   */
  assignOwnedId(oldId: string, exists: (candidate: string) => boolean): string {
    const existing = this.idMap.get(oldId);
    if (existing !== undefined) return existing;
    let candidate = this.applyTokens(oldId);
    if (candidate === oldId) {
      if (exists(candidate)) {
        do {
          candidate = `${oldId}~imp${randomUUID().slice(0, 8)}`;
        } while (exists(candidate));
        this.renamed += 1;
        if (oldId.length >= MIN_RENAMED_TOKEN_LENGTH) this.literalTokens.set(oldId, candidate);
      } else {
        this.kept += 1;
      }
    }
    this.idMap.set(oldId, candidate);
    return candidate;
  }

  ownedId(oldId: string): string | undefined {
    return this.idMap.get(oldId);
  }

  /** 引用值：全值命中映射优先，其次做令牌替换。 */
  remapReference(value: string): string {
    const exact = value.length >= MIN_EXACT_MATCH_LENGTH || value === this.oldBookId ? this.idMap.get(value) : undefined;
    if (exact !== undefined) return exact;
    if (value === this.oldBookId) return this.newBookId;
    return isIdLike(value) ? this.applyTokens(value) : value;
  }

  /** 递归改写 JSON 值里的字符串叶子与对象键。 */
  remapJsonValue(value: unknown): unknown {
    if (typeof value === "string") return this.remapReference(value);
    if (Array.isArray(value)) return value.map((item) => this.remapJsonValue(item));
    if (value && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        // 恶意 JSON 列可能带 "__proto__" 等键：直接赋值会去改原型或静默丢键。
        // defineProperty 始终把键落成自有可枚举属性，导入的列内容不变形、原型不污染。
        Object.defineProperty(result, this.remapReference(key), {
          value: this.remapJsonValue(item),
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
      return result;
    }
    return value;
  }

  /** JSON 文本：能解析就逐叶改写；解析不了按普通引用值处理。 */
  remapJsonText(text: string): string {
    const trimmed = text.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[") && !trimmed.startsWith("\"")) return this.remapReference(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return this.remapReference(text);
    }
    const remapped = this.remapJsonValue(parsed);
    // 没有任何改动时保留原文排版，避免无谓地改写作者可见的 JSON。
    return JSON.stringify(remapped) === JSON.stringify(parsed) ? text : JSON.stringify(remapped);
  }

  stats(): IdRemapStats {
    return { remapped: this.idMap.size - this.kept, kept: this.kept, renamedOnCollision: this.renamed };
  }
}
