/**
 * 实体名启发式：把「薛行之」这类名字和「自费转诊 / 指尖电流与异常感知」
 * 这类事件短语分开。未命中经纬字典时才走这里，宁可漏不可错并。
 */

const COMPOSITE_SEPARATORS = /[、，,]|与|和|及|跟/u;

/**
 * 明显不是实体的主体（整句话/事件描述），不该进实体表。
 * 实测 relationship 的 object 经常是「建立按项目结算的七天事故复核协作」这类动宾短语。
 */
const NON_ENTITY_HINTS = [
  /风险$/u, /情况$/u, /记忆$/u, /安置$/u, /筛查$/u, /之夜/u,
  /协作$/u, /约定$/u, /条款$/u, /后果$/u, /线索$/u, /悬案$/u,
];
const ACTION_PREFIXES = /^(建立|交付|安排|协议|认可|录用|追加|补充|携带|启动)/u;
/**
 * 事件/情节短语，不是实体。实测未命中提及里占比最大的正是这类：
 * 「故事主线时间」「驻场体检」「B-17数据抢救」「李文彬对薛行之的旧怨」。
 */
const EVENT_PHRASE_HINTS = [
  /时间$/u, /线索$/u, /后果$/u, /旧怨$/u, /悬案$/u, /抢救$/u, /清理$/u, /掩盖$/u,
  /离职$/u, /体检$/u, /方案$/u, /数据$/u, /记录$/u, /场强$/u, /衰减$/u, /层级$/u,
  /故障$/u, /波形$/u, /感知$/u, /电流$/u, /协作$/u, /转诊$/u, /综合征/u,
  /[一二三四五六七八九十百千万\d]+元/u,
  /^\d/u,
  /^\d{4}[.\-年]/u,
  /^[A-Za-z]-?\d{2}/u,
];

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/**
 * 复合主体拆分：「薛行之与方工」→ ["薛行之", "方工"]。
 * 括号内视为别名/说明，不参与拆分（「陈默（权威合并版）」是一个人）。
 */
export function splitCompositeName(subject: string): { names: string[]; composite: boolean } {
  const trimmed = clean(subject);
  if (!trimmed) return { names: [], composite: false };
  if (/[（(].*[）)]/u.test(trimmed)) {
    const stripped = trimmed.replace(/[（(][^（()）]*[）)]/gu, "").trim();
    const outer = stripped.split(COMPOSITE_SEPARATORS).map((part) => part.trim()).filter(Boolean);
    if (outer.length <= 1) return { names: [trimmed], composite: false };
    return { names: outer, composite: true };
  }
  const parts = trimmed.split(COMPOSITE_SEPARATORS).map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 1) return { names: [trimmed], composite: false };
  if (parts.some((part) => part.length > 12 || NON_ENTITY_HINTS.some((hint) => hint.test(part)))) {
    return { names: [trimmed], composite: false };
  }
  return { names: parts, composite: true };
}

/**
 * 是否像「事件/情节短语」而非具体实体。
 * 未命中字典时用于从共现图里剔除脏节点；字典命中的长标题不走这里。
 */
export function looksLikeEventPhrase(name: string): boolean {
  const normalized = clean(name);
  if (!normalized) return false;
  if (/[一二三四五六七八九十两\d]+层$/u.test(normalized)) return true;
  return EVENT_PHRASE_HINTS.some((hint) => hint.test(normalized));
}

/**
 * 是否像一个实体名（排除整句话被当主体的脏数据）。
 *
 * 未命中字典时才走这条启发式，所以宁可严：人名/地名通常 2–8 字；
 * 超过 10 字还没命中字典的，几乎都是事件描述。字典命中的长标题不经过这里。
 */
export function looksLikeEntity(name: string): boolean {
  const normalized = clean(name);
  if (!normalized || normalized.length > 10) return false;
  if (/[。！？；]/u.test(normalized)) return false;
  if (ACTION_PREFIXES.test(normalized)) return false;
  if (looksLikeEventPhrase(normalized)) return false;
  return !NON_ENTITY_HINTS.some((hint) => hint.test(normalized));
}
