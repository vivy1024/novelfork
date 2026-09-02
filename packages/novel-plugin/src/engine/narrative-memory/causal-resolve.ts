/**
 * 显式因果解析。
 *
 * 事件→事件的边，不写 narrative_relation（那张表是实体五元组，外键指向
 * narrative_entity）。因果前驱落在 narrative_event.caused_by_json。
 *
 * 宁可漏不可错：对不上唯一前驱就丢弃，不靠同参与者启发式冒充显式边。
 */

const HOOK_TYPES = new Set(["hook_planted", "hook_progressed", "hook_triggered", "hook_resolved"]);
const HOOK_PHASE: Record<string, number> = {
  hook_planted: 0,
  hook_progressed: 1,
  hook_triggered: 2,
  hook_resolved: 3,
};

export interface CausalEventRef {
  readonly id: string;
  readonly chapterNumber: number;
  readonly eventType: string;
  readonly subject: string;
  readonly predicate?: string;
  readonly object?: string;
  readonly evidenceText?: string;
  readonly causedBy?: readonly string[];
}

export function parseCausedBy(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim()
      ? (() => {
        try {
          const parsed: unknown = JSON.parse(value);
          return Array.isArray(parsed) ? parsed : [value];
        } catch {
          return [value];
        }
      })()
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const text = typeof item === "number" && Number.isInteger(item)
      ? String(item)
      : typeof item === "string"
        ? item.trim()
        : "";
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function normalizeName(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function earlierThan(left: CausalEventRef, right: CausalEventRef): boolean {
  if (left.chapterNumber !== right.chapterNumber) return left.chapterNumber < right.chapterNumber;
  const leftPhase = HOOK_PHASE[left.eventType] ?? 0;
  const rightPhase = HOOK_PHASE[right.eventType] ?? 0;
  if (leftPhase !== rightPhase) return leftPhase < rightPhase;
  return left.id.localeCompare(right.id) < 0;
}

/** 2–3 个纯汉字且不像器物/线索名，多半是人名，不能当伏笔身份。 */
function isWeakHookSubject(name: string): boolean {
  if (!/^[\u4e00-\u9fff]{2,3}$/u.test(name)) return false;
  return !/(瓶|阵|符|剑|鼎|镜|印|石|波形|线索|风险|禁地|药园)/u.test(name);
}

/**
 * 伏笔身份：优先用有辨识度的 subject；人名则退到 object 前缀。
 * 对不上就放弃，避免「薛行之」把无关伏笔串成一条。
 */
export function hookIdentity(event: CausalEventRef): string | null {
  const subject = normalizeName(event.subject);
  const object = normalizeName(event.object ?? "");
  if (!subject) return null;
  if (!isWeakHookSubject(subject)) return subject;
  const objectKey = object.replace(/\s+/gu, "").slice(0, 12);
  return objectKey.length >= 6 ? `obj:${objectKey}` : null;
}

/**
 * 伏笔三态链：同一伏笔身份上 planted → progressed → resolved。
 * 只连确定的同名伏笔，不把不同钩子捏在一起。
 */
export function inferHookCausalLinks(events: readonly CausalEventRef[]): Map<string, string[]> {
  const links = new Map<string, string[]>();
  const hooks = events
    .filter((event) => HOOK_TYPES.has(event.eventType) && hookIdentity(event))
    .sort((left, right) => {
      if (left.chapterNumber !== right.chapterNumber) return left.chapterNumber - right.chapterNumber;
      return (HOOK_PHASE[left.eventType] ?? 0) - (HOOK_PHASE[right.eventType] ?? 0) || left.id.localeCompare(right.id);
    });
  const lastByKey = new Map<string, CausalEventRef>();
  for (const event of hooks) {
    const key = hookIdentity(event);
    if (!key) continue;
    const previous = lastByKey.get(key);
    const currentPhase = HOOK_PHASE[event.eventType] ?? 0;
    const previousPhase = previous ? HOOK_PHASE[previous.eventType] ?? 0 : -1;
    if (previous && earlierThan(previous, event) && currentPhase >= previousPhase && event.eventType !== "hook_planted") {
      links.set(event.id, [previous.id]);
    }
    lastByKey.set(key, event);
  }
  return links;
}

function uniqueIds(ids: readonly string[], limit = 4): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 把 LLM 给的 causedBy（序号 / 事件 id / subject / subject|predicate）解析成已有事件 id。
 * 对不上或命中多于一条且无法用「最近前驱」唯一确定时丢弃该项。
 */
export function resolveCausedByRefs(input: {
  readonly refs: readonly string[];
  readonly current: CausalEventRef;
  readonly batch: readonly CausalEventRef[];
  readonly history?: readonly CausalEventRef[];
}): string[] {
  const pool = [...(input.history ?? []), ...input.batch].filter((event) => event.id !== input.current.id);
  const earlier = pool.filter((event) => earlierThan(event, input.current) || (
    event.chapterNumber === input.current.chapterNumber && event.id !== input.current.id
  ));
  const byId = new Map(earlier.map((event) => [event.id, event]));
  const resolved: string[] = [];

  for (const ref of input.refs) {
    const text = normalizeName(ref);
    if (!text) continue;
    const asId = byId.get(text);
    if (asId) {
      resolved.push(asId.id);
      continue;
    }
    if (/^\d+$/u.test(text)) {
      const index = Number(text);
      const zeroBased = input.batch[index];
      const oneBased = input.batch[index - 1];
      const candidate = zeroBased && zeroBased.id !== input.current.id
        ? zeroBased
        : oneBased && oneBased.id !== input.current.id
          ? oneBased
          : undefined;
      if (candidate && (earlierThan(candidate, input.current) || candidate.chapterNumber === input.current.chapterNumber)) {
        resolved.push(candidate.id);
      }
      continue;
    }
    const [subjectPart, predicatePart] = text.includes("|") ? text.split("|", 2) : [text, undefined];
    const subject = normalizeName(subjectPart ?? "");
    const predicate = predicatePart ? normalizeName(predicatePart) : "";
    if (!subject) continue;
    const matches = earlier.filter((event) => {
      if (normalizeName(event.subject) !== subject) return false;
      if (predicate && normalizeName(event.predicate ?? "") !== predicate) return false;
      return true;
    });
    if (matches.length === 0) continue;
    const latest = matches.reduce((best, event) => (earlierThan(best, event) ? event : best));
    resolved.push(latest.id);
  }

  return uniqueIds(resolved);
}

export function mergeExplicitCauses(...groups: Array<readonly string[] | undefined>): string[] {
  return uniqueIds(groups.flatMap((group) => group ?? []));
}
