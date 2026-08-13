import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import type { DiagnosticExplanation } from "../../handlers/diagnostic-explanation.js";
import { createStoryJingweiEntryRepository } from "../jingwei/repositories/entry-repo.js";
import { queryCurrentNarrativeLedger } from "./ledger.js";

/**
 * 经纬 × 叙事记忆 一致性检测（纰漏检测 v1）。
 *
 * 只读两边，不写任何一边：把「设定（经纬 canon）应然」与「现状（叙事记忆
 * 实然）」的分歧摆给作者看。检测器是确定性的纯规则对照，不调用 LLM。
 *
 * 经纬读取走 entry-repo（引擎内正统读法，方向正确）。经纬表存在两套结构
 * （core 完整表 vs 历史简化表），entry-repo 只兼容完整表；检测器对外层
 * try/catch 兜底，旧表结构下静默降级为「无检测结果」，不阻断软提醒。
 */

export type ConsistencyFindingKind = "realm-drift" | "orphan-location";

export interface ConsistencyFinding {
  readonly kind: ConsistencyFindingKind;
  readonly severity: "warning" | "info";
  readonly title: string;
  readonly detail: string;
  readonly entity: string;
  /** 经纬侧的说法。 */
  readonly jingweiValue?: string;
  /** 叙事记忆侧的说法。 */
  readonly memoryValue?: string;
  readonly jingweiEntryId?: string;
  readonly factId?: string;
  /** 叙事记忆侧那条事实的谓词（纠正时要沿用，不能让前端猜）。 */
  readonly memoryPredicate?: string;
  /** 叙事记忆侧那条事实的生效章号，供「看第 X 章」跳转用。 */
  readonly memoryChapter?: number;
  /**
   * 人话层：发生了什么 / 为什么要看 / 建议怎么做。
   *
   * 纪律：前端与叙述者一律转述这三段，不得按 kind 自造文案。
   */
  readonly explanation: DiagnosticExplanation;
}

export interface ConsistencyCheckInput {
  readonly bookId: string;
  readonly asOfChapter?: number;
}

export interface ConsistencyCheckResult {
  readonly bookId: string;
  readonly findings: readonly ConsistencyFinding[];
  readonly summary: string;
}

const REALM_PREDICATES = ["境界", "修为", "职级", "realm", "等级", "修为境界", "实力"];

function normalize(text: string): string {
  return text.trim().replace(/\s+/gu, " ").toLowerCase();
}

function isRealmPredicate(predicate: string): boolean {
  const normalized = normalize(predicate);
  return REALM_PREDICATES.some((keyword) => normalized.includes(normalize(keyword)));
}

function realmValueFrom(fields: Record<string, unknown>): string | undefined {
  const realm = fields.realm ?? fields["realm"] ?? fields.roleType ?? fields["roleType"];
  if (typeof realm === "string" && realm.trim()) return realm.trim();
  return undefined;
}

function statusText(fields: Record<string, unknown>): string {
  const value = fields.status ?? fields["status"];
  return typeof value === "string" ? value : "";
}

function descriptionText(fields: Record<string, unknown>): string {
  const value = fields.description ?? fields["description"];
  return typeof value === "string" ? value : "";
}

/** 检测经纬 characters 的 realm/roleType 设定与叙事记忆 character_state 现状是否一致。 */
export async function detectRealmDrift(storage: StorageDatabase, input: ConsistencyCheckInput): Promise<ConsistencyFinding[]> {
  const entries = (await createStoryJingweiEntryRepository(storage).listByBook(input.bookId))
    .filter((entry) => entry.category === "characters" && entry.status === "confirmed" && entry.lifecycle === "active");
  const ledger = queryCurrentNarrativeLedger(storage, {
    bookId: input.bookId,
    asOfChapter: input.asOfChapter,
    categories: ["character_state"],
    limit: 500,
  });

  const findings: ConsistencyFinding[] = [];
  for (const entry of entries) {
    const realm = realmValueFrom(entry.fields);
    if (!realm) continue;
    const names = new Set([entry.title, ...entry.aliases].map(normalize).filter(Boolean));
    const memoryFacts = ledger.items.filter((fact) =>
      names.has(normalize(fact.subject)) && isRealmPredicate(fact.predicate),
    );
    for (const fact of memoryFacts) {
      if (normalize(fact.object) === normalize(realm)) continue;
      const chapter = fact.validFromChapter ?? fact.sourceChapter;
      const chapterText = chapter !== undefined ? `第 ${chapter} 章` : "近期章节";
      findings.push({
        kind: "realm-drift",
        severity: "warning",
        title: `设定与现状不一致：${entry.title} 的境界/职级`,
        detail: `经纬设定为「${realm}」，叙事记忆当前为「${fact.object}」。需要作者确认改哪一边。`,
        entity: entry.title,
        jingweiValue: realm,
        memoryValue: fact.object,
        jingweiEntryId: entry.id,
        factId: fact.id,
        memoryPredicate: fact.predicate,
        ...(chapter !== undefined ? { memoryChapter: chapter } : {}),
        explanation: {
          whatHappened: `经纬里 ${entry.title} 的${fact.predicate}写着「${realm}」，${chapterText}结算出的叙事记忆写着「${fact.object}」，两边对不上。`,
          whyItMatters: "续写时写手读的是叙事记忆的现状。设定与现状分岔后，同一个人物的实力会在不同章节忽高忽低，读者会当成崩设定。",
          suggestedAction: `确认哪一边是对的：正文没写过跌落就把这条记忆纠正为「${realm}」；如果正文真的写了变化，就去经纬把 ${entry.title} 的设定改成「${fact.object}」。抽错人物时可直接作废这条记忆。`,
        },
      });
    }
  }
  return findings;
}

/** 检测叙事记忆 location 事实指向的经纬 locations 是否已废弃/销毁。 */
export async function detectOrphanLocation(storage: StorageDatabase, input: ConsistencyCheckInput): Promise<ConsistencyFinding[]> {
  const locations = (await createStoryJingweiEntryRepository(storage).listByBook(input.bookId))
    .filter((entry) => entry.category === "locations");
  const destroyedNames = new Map<string, string>();
  for (const entry of locations) {
    const haystack = normalize([statusText(entry.fields), descriptionText(entry.fields)].join(" "));
    if (/(毁|废|灭|消失|坍塌|荒废|废弃)/u.test(haystack)) {
      const names = [entry.title, ...entry.aliases].map(normalize).filter(Boolean);
      for (const name of names) destroyedNames.set(name, entry.id);
    }
  }
  if (destroyedNames.size === 0) return [];

  const ledger = queryCurrentNarrativeLedger(storage, {
    bookId: input.bookId,
    asOfChapter: input.asOfChapter,
    categories: ["location"],
    limit: 500,
  });

  const findings: ConsistencyFinding[] = [];
  for (const fact of ledger.items) {
    const objectName = normalize(fact.object);
    const entryId = destroyedNames.get(objectName);
    if (!entryId) continue;
    const chapter = fact.validFromChapter ?? fact.sourceChapter;
    const chapterText = chapter !== undefined ? `第 ${chapter} 章` : "近期章节";
    findings.push({
      kind: "orphan-location",
      severity: "warning",
      title: `当前位置指向已废弃地点：${fact.object}`,
      detail: "叙事记忆里当前位置仍指向经纬中已标记为废弃/销毁的地点，可能存在时间线或地点引用错误。",
      entity: fact.subject,
      memoryValue: fact.object,
      jingweiEntryId: entryId,
      factId: fact.id,
      memoryPredicate: fact.predicate,
      ...(chapter !== undefined ? { memoryChapter: chapter } : {}),
      explanation: {
        whatHappened: `${chapterText}结算出「${fact.subject} ${fact.predicate} ${fact.object}」，但经纬里的 ${fact.object} 已标记为废弃/销毁。`,
        whyItMatters: "人物当前位置停在一个按设定已经不存在的地方。续写会继续在这个地点安排场景，时间线和地理关系会一起错下去。",
        suggestedAction: `核对正文：如果人物早已离开，把这条位置纠正为实际所在地；如果这个地点其实还在，就去经纬改掉 ${fact.object} 的废弃状态。地点抽错时直接作废这条记忆。`,
      },
    });
  }
  return findings;
}

export async function runConsistencyCheck(storage: StorageDatabase, input: ConsistencyCheckInput): Promise<ConsistencyCheckResult> {
  let findings: ConsistencyFinding[];
  try {
    findings = [
      ...(await detectRealmDrift(storage, input)),
      ...(await detectOrphanLocation(storage, input)),
    ];
  } catch {
    // 经纬旧表结构缺列时 entry-repo 会失败；一致性检测是软提醒，静默降级。
    findings = [];
  }
  return {
    bookId: input.bookId,
    findings,
    summary: findings.length === 0
      ? "经纬设定与叙事记忆现状一致，未发现纰漏。"
      : `发现 ${findings.length} 处经纬设定与叙事记忆现状的分歧。`,
  };
}
