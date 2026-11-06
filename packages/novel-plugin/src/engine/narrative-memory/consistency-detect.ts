import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import type { DiagnosticExplanation } from "../../handlers/diagnostic-explanation.js";
import { createStoryJingweiEntryRepository } from "../jingwei/repositories/entry-repo.js";
import { queryCurrentNarrativeLedger } from "./ledger.js";
import {
  ignoreKeyString,
  listConsistencyIgnores,
  runSceneChecks,
  SCENE_DEAD_ACTS,
  SCENE_LOCATION_JUMP,
  type ConsistencyIgnoreKey,
  type SceneCheckFinding,
} from "./scene-check.js";
import { readStoryTimeline, type StoryTimeConflict, type StoryTimeConflictKind } from "./story-time.js";

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

export type ConsistencyFindingKind = "realm-drift" | "orphan-location" | typeof SCENE_DEAD_ACTS | typeof SCENE_LOCATION_JUMP | StoryTimeConflictKind;

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
  /** 实体索引 id（场景校验给出；忽略键的一部分）。 */
  readonly entityId?: string;
  /** 矛盾出现的章（场景校验：被检查的那一章）。 */
  readonly chapterNumber?: number;
  /** 正文原文句子（场景校验的证据）。 */
  readonly evidenceText?: string;
  /** 地点跳变：本章的地点（蓝图场景的地点，或没有场景时本章首个「所在」）。 */
  readonly sceneLocation?: string;
  /**
   * 作者「忽略此条」用的裁决键（检测类型 + 实体 id + 章号 + 记忆事实 id）。
   * 前端原样回传，不自己拼。
   */
  readonly ignoreKey?: ConsistencyIgnoreKey;
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
  /** 场景校验只查这些章（结算后自动检测传本章）；缺省查截至 asOfChapter 的全部章。 */
  readonly sceneChapters?: readonly number[];
  /** 场景校验读正文（证据核对与人物首句）；缺省时地点跳变不报。 */
  readonly loadChapterText?: (chapterNumber: number) => Promise<string | undefined> | string | undefined;
}

export interface ConsistencyCheckResult {
  readonly bookId: string;
  /** 未被作者忽略的检出项。 */
  readonly findings: readonly ConsistencyFinding[];
  /** 作者已标「忽略此条」、本次仍检出的项（供撤销忽略）。 */
  readonly ignored: readonly ConsistencyFinding[];
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
          whatHappened: `设定里 ${entry.title} 的${fact.predicate}写着「${realm}」，${chapterText}结算出的叙事记忆写着「${fact.object}」，两边对不上。`,
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
        whatHappened: `${chapterText}结算出「${fact.subject} ${fact.predicate} ${fact.object}」，但设定里的 ${fact.object} 已标记为废弃/销毁。`,
        whyItMatters: "人物当前位置停在一个按设定已经不存在的地方。续写会继续在这个地点安排场景，时间线和地理关系会一起错下去。",
        suggestedAction: `核对正文：如果人物早已离开，把这条位置纠正为实际所在地；如果这个地点其实还在，就去经纬改掉 ${fact.object} 的废弃状态。地点抽错时直接作废这条记忆。`,
      },
    });
  }
  return findings;
}

/** 忽略键：检测类型 + 实体 id + 章号 + 记忆事实 id。旧检测器没有实体 id 时退回经纬条目 / 名字。 */
export function consistencyIgnoreKeyOf(finding: Omit<ConsistencyFinding, "ignoreKey">): ConsistencyIgnoreKey {
  return {
    kind: finding.kind,
    entityId: finding.entityId ?? (finding.jingweiEntryId ? `entry:${finding.jingweiEntryId}` : `name:${finding.entity}`),
    chapterNumber: finding.chapterNumber ?? finding.memoryChapter ?? 0,
    factId: finding.factId ?? "",
  };
}

function fromSceneFinding(finding: SceneCheckFinding): Omit<ConsistencyFinding, "ignoreKey"> {
  return {
    kind: finding.kind,
    severity: finding.severity,
    title: finding.title,
    detail: finding.detail,
    entity: finding.entity,
    entityId: finding.entityId,
    ...(finding.jingweiEntryId ? { jingweiEntryId: finding.jingweiEntryId } : {}),
    chapterNumber: finding.chapterNumber,
    evidenceText: finding.evidenceText,
    factId: finding.factId,
    memoryChapter: finding.memoryChapter,
    memoryPredicate: finding.memoryPredicate,
    memoryValue: finding.memoryValue,
    ...(finding.sceneLocation ? { sceneLocation: finding.sceneLocation } : {}),
    explanation: finding.explanation,
  };
}

/** 故事时间矛盾 → 体检项（忽略键：实体 id 用 time:<人物>，记忆事实 id 用时间锚 id）。 */
export function fromStoryTimeConflict(conflict: StoryTimeConflict): Omit<ConsistencyFinding, "ignoreKey"> {
  return {
    kind: conflict.kind,
    severity: conflict.severity,
    title: conflict.title,
    detail: conflict.detail,
    entity: conflict.entity,
    entityId: `time:${conflict.entity}`,
    chapterNumber: conflict.chapterNumber,
    evidenceText: conflict.evidenceText,
    factId: conflict.anchorId,
    memoryChapter: conflict.otherChapter,
    explanation: conflict.explanation,
  };
}

export async function runConsistencyCheck(storage: StorageDatabase, input: ConsistencyCheckInput): Promise<ConsistencyCheckResult> {
  let jingweiFindings: ConsistencyFinding[];
  try {
    jingweiFindings = [
      ...(await detectRealmDrift(storage, input)),
      ...(await detectOrphanLocation(storage, input)),
    ];
  } catch {
    // 经纬旧表结构缺列时 entry-repo 会失败；一致性检测是软提醒，静默降级。
    jingweiFindings = [];
  }
  let sceneFindings: Omit<ConsistencyFinding, "ignoreKey">[];
  try {
    sceneFindings = (await runSceneChecks(storage, {
      bookId: input.bookId,
      ...(input.asOfChapter !== undefined ? { asOfChapter: input.asOfChapter } : {}),
      ...(input.sceneChapters ? { chapters: input.sceneChapters } : {}),
      ...(input.loadChapterText ? { loadChapterText: input.loadChapterText } : {}),
    })).map(fromSceneFinding);
  } catch {
    // 场景校验只提示不拦截；读失败时按「未检出」降级，不影响经纬侧检测。
    sceneFindings = [];
  }
  let timeFindings: Omit<ConsistencyFinding, "ignoreKey">[];
  try {
    timeFindings = readStoryTimeline(storage, input.bookId, input.asOfChapter).conflicts
      .filter((conflict) => !input.sceneChapters || input.sceneChapters.includes(conflict.chapterNumber))
      .map(fromStoryTimeConflict);
  } catch {
    // 时间线读失败按「未检出」降级。
    timeFindings = [];
  }
  let ignoredKeys: Set<string>;
  try {
    ignoredKeys = new Set(listConsistencyIgnores(storage, input.bookId).map(ignoreKeyString));
  } catch {
    ignoredKeys = new Set();
  }
  const findings: ConsistencyFinding[] = [];
  const ignored: ConsistencyFinding[] = [];
  for (const raw of [...jingweiFindings, ...sceneFindings, ...timeFindings]) {
    const finding: ConsistencyFinding = { ...raw, ignoreKey: consistencyIgnoreKeyOf(raw) };
    (ignoredKeys.has(ignoreKeyString(finding.ignoreKey!)) ? ignored : findings).push(finding);
  }
  const ignoredNote = ignored.length > 0 ? `另有 ${ignored.length} 处已被你标为忽略。` : "";
  return {
    bookId: input.bookId,
    findings,
    ignored,
    summary: findings.length === 0
      ? `经纬设定、叙事记忆现状、场景衔接与故事时间未发现纰漏。${ignoredNote}`
      : `发现 ${findings.length} 处设定、现状、场景衔接或故事时间上的可能矛盾。${ignoredNote}`,
  };
}

export interface ChapterSceneCheckInput {
  readonly bookId: string;
  readonly chapterNumber: number;
  /** 本章正文（结算时手上就有）。 */
  readonly content: string;
}

export interface ChapterSceneCheckResult {
  /** 未被作者忽略的检出项数。 */
  readonly found: number;
  /** 作者已忽略、本次仍检出的项数。 */
  readonly ignored: number;
  /** 结算结果里展示的一行摘要。 */
  readonly summary: string;
}

/**
 * 结算后自动检测：只查本章，用本章新状态对照截至上一章的状态。
 * 只读、只提示；结果不落盘，作者在叙事体检面板里查看与处置。
 */
export async function runChapterSceneCheck(storage: StorageDatabase, input: ChapterSceneCheckInput): Promise<ChapterSceneCheckResult> {
  const raw = (await runSceneChecks(storage, {
    bookId: input.bookId,
    chapters: [input.chapterNumber],
    loadChapterText: (chapter) => (chapter === input.chapterNumber ? input.content : undefined),
  })).map(fromSceneFinding);
  const ignoredKeys = new Set(listConsistencyIgnores(storage, input.bookId).map(ignoreKeyString));
  const ignored = raw.filter((finding) => ignoredKeys.has(ignoreKeyString(consistencyIgnoreKeyOf(finding)))).length;
  const found = raw.length - ignored;
  return {
    found,
    ignored,
    summary: found > 0
      ? `场景校验：发现 ${found} 处可能矛盾，详见叙事体检。`
      : "场景校验：未发现死亡后行动或地点跳变。",
  };
}
