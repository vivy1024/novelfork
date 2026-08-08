/**
 * write.preflight — 写章前最小上下文包与硬门。
 *
 * 把「focus / 近章事实 / 伏笔 / 用户一句指示」从叙述者自觉变成可机器校验的就绪检查。
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { getStorageDatabase } from "@vivy1024/novelfork-core";
import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { ensureNarrativeMemorySchema, listHighRiskPendingNarrativeEvents } from "../engine/narrative-memory/storage.js";
import { ensureJingweiLedgerSchema } from "./jingwei-ledger-store.js";
import { listStaleChapters } from "./audit-freshness.js";
import { loadNarrativeMemoryConfig } from "../engine/narrative-memory/config.js";
import { explainDiagnostic, type DiagnosticExplanation } from "./diagnostic-explanation.js";
import {
  createCockpitService,
  type CockpitChapterSummaryItem,
  type CockpitCurrentFocusSummary,
  type CockpitHookItem,
  type CockpitSnapshot,
  type CockpitState,
} from "./cockpit-service.js";
import { loadActiveWritingSkillsForBook } from "./writing-skill-handlers.js";
import {
  describeWritingSkillAcknowledgementRequirement,
  explainWritingSkillAcknowledgementVerdict,
  verifyWritingSkillAcknowledgements,
  type AcknowledgeableWritingSkill,
  type WritingSkillAcknowledgement,
  type WritingSkillAcknowledgementRequirement,
} from "./writing-skill-acknowledgement.js";

export type MemoryChannelHealth = "ok" | "empty" | "missing" | "disabled";

export interface WritePreflightBlocker {
  readonly code:
    | "missing-directive"
    | "empty-recent-progress"
    | "high-risk-pending"
    | "book-not-found"
    | "skills-not-acknowledged";
  readonly message: string;
  /** 人话三段式：发生了什么 / 为什么要看 / 建议怎么做。前端不得按 code 自造文案。 */
  readonly explanation?: DiagnosticExplanation;
  readonly kind?: "persistent" | "advisory";
}

export interface WritePreflightInput {
  readonly bookId: string;
  readonly chapterNumber?: number;
  /** 用户一句本章指示；可空，空时尝试用 currentFocus 生成默认句。 */
  readonly userDirectives?: string;
  /**
   * 当仅有 focus 默认句、没有用户句时，是否接受默认句继续。
   * 仅影响 needsUserConfirm；硬门仍要求至少有一句 resolvedDirective。
   */
  readonly acceptFocusDefault?: boolean;
  /** Trusted book root injected by Runtime when available. */
  readonly bookRoot?: string;
  readonly storage?: StorageDatabase;
  readonly cockpitState?: CockpitState;
  readonly now?: () => Date;
  /**
   * 对已启用 Writing Skills 的原文引用确认。缺失或对不上时 preflight 会以
   * skills-not-acknowledged 阻断，避免模型跳过技能直接写章。
   */
  readonly acknowledgedSkills?: readonly WritingSkillAcknowledgement[];
}

export interface WritePreflightWarning {
  readonly code:
    | "style-disabled"
    | "hooks-overdue"
    | "volume-focus-missing"
    | "short-directive"
    | "focus-default-only"
    | "high-risk-pending"
    | "empty-chapter-summary"
    | "platform-target-mismatch"
    | "audit-stale"
    | "volume-range-drift"
    | "other";
  readonly message: string;
  readonly explanation?: DiagnosticExplanation;
  readonly kind?: "persistent" | "advisory";
}

export interface WritePreflightResult {
  readonly ok: boolean;
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly currentFocus: CockpitCurrentFocusSummary;
  readonly resolvedDirective: string | null;
  readonly needsUserConfirm: boolean;
  readonly recentChapters: readonly { readonly number: number; readonly summary: string }[];
  readonly openHooksForChapter: readonly CockpitHookItem[];
  readonly overdueHooks: readonly CockpitHookItem[];
  readonly currentVolume: { readonly title: string; readonly goal: string } | null;
  readonly platform: {
    readonly platform: string;
    readonly label: string;
    readonly chapterTargetStatus: "ok" | "below-min" | "above-max" | "unknown";
    readonly recommendedChapterWords?: { readonly min: number; readonly ideal: number; readonly max: number };
    readonly notes: readonly string[];
  } | null;
  readonly formalChapterCount: number;
  readonly memoryHealth: {
    readonly timeline: MemoryChannelHealth;
    readonly facts: MemoryChannelHealth;
    readonly style: MemoryChannelHealth;
    readonly hooks: MemoryChannelHealth;
    readonly events: MemoryChannelHealth;
  };
  readonly blockers: readonly WritePreflightBlocker[];
  /**
   * 本书已启用、需要在写章前提交原文引用的 Writing Skills。
   * 只给 slug/name/最小引用长度，不给正文：否则模型可以照抄 preflight 输出蒙过去。
   */
  readonly requiredSkillAcknowledgements: readonly WritingSkillAcknowledgementRequirement[];
  /** 兼容旧字段：纯文本 warnings */
  readonly warnings: readonly string[];
  /** 结构化 warnings（主链硬化） */
  readonly warningItems: readonly WritePreflightWarning[];
  readonly cockpit: Pick<
    CockpitSnapshot,
    "status" | "progress" | "currentFocus" | "recentChapterSummaries" | "openHooks" | "recentChapterResults"
  > | null;
}

const MIN_DIRECTIVE_CHARS = 8;

function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 找出「审计结论已不对应当前正文」的章节。
 *
 * 数据不全时一律返回空：这只是提醒项，宁可漏报也不要因为读不到表就报假警。
 */
function findStaleAuditChapters(
  storage: StorageDatabase,
  bookId: string,
  snapshot: CockpitSnapshot,
): number[] {
  const chapterTimes = new Map<number, string>();
  for (const item of snapshot.recentChapterResults.items) {
    const updatedAt = trimText(item.updatedAt);
    if (item.chapterNumber > 0 && updatedAt) chapterTimes.set(item.chapterNumber, updatedAt);
  }
  if (chapterTimes.size === 0) return [];

  try {
    const rows = storage.sqlite.prepare(`
      SELECT chapter_number AS chapterNumber, MAX(audited_at) AS auditedAt
      FROM chapter_audit_log
      WHERE book_id = ?
      GROUP BY chapter_number
    `).all(bookId) as Array<{ chapterNumber: number; auditedAt: string | null }>;

    const audits = new Map(rows.map((row) => [Number(row.chapterNumber), row.auditedAt]));
    return listStaleChapters(
      [...chapterTimes.entries()].map(([chapterNumber, chapterUpdatedAt]) => ({
        chapterNumber,
        chapterUpdatedAt,
        auditedAt: audits.get(chapterNumber) ?? null,
      })),
    ).map((item) => item.chapterNumber).sort((left, right) => left - right);
  } catch {
    // 审计表可能尚未建立（新书/新库）
    return [];
  }
}

function firstNonEmptyLine(text: string, max = 120): string {
  const line = text
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .find((item) => item.length > 0);
  if (!line) return "";
  return line.length > max ? `${line.slice(0, max).trimEnd()}…` : line;
}

function directiveFromFocus(focus: CockpitCurrentFocusSummary): string | null {
  if (focus.status !== "available" || !focus.content?.trim()) return null;
  const line = firstNonEmptyLine(focus.content);
  if (!line) return null;
  return `按当前焦点推进：${line}`;
}

function healthFromCount(count: number | null): MemoryChannelHealth {
  if (count === null) return "missing";
  return count > 0 ? "ok" : "empty";
}

function countRows(
  storage: StorageDatabase,
  sql: string,
  params: readonly unknown[],
): number | null {
  try {
    const row = storage.sqlite.prepare(sql).get(...params) as { c?: number } | undefined;
    return typeof row?.c === "number" ? row.c : 0;
  } catch {
    return null;
  }
}

function listRecentMemoryChapterSummaries(
  storage: StorageDatabase,
  bookId: string,
  limit = 2,
): Array<{ number: number; summary: string }> {
  try {
    const rows = storage.sqlite.prepare(`
      SELECT chapter_number AS chapterNumber, subject, predicate, object, evidence_text AS evidenceText
      FROM narrative_event
      WHERE book_id = ?
        AND status IN ('applied', 'pending')
        AND chapter_number IS NOT NULL
      ORDER BY chapter_number DESC, created_at DESC
      LIMIT 40
    `).all(bookId) as Array<{
      chapterNumber: number;
      subject?: string;
      predicate?: string;
      object?: string;
      evidenceText?: string;
    }>;

    const byChapter = new Map<number, string>();
    for (const row of rows) {
      const n = Number(row.chapterNumber);
      if (!Number.isFinite(n) || byChapter.has(n)) continue;
      const summary = [
        row.subject,
        row.predicate,
        row.object,
      ].filter((part) => typeof part === "string" && part.trim()).join(" · ")
        || firstNonEmptyLine(row.evidenceText ?? "", 160)
        || `第${n}章已有结算事件`;
      byChapter.set(n, summary);
      if (byChapter.size >= limit) break;
    }
    return [...byChapter.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([number, summary]) => ({ number, summary }));
  } catch {
    return [];
  }
}

function mergeRecentChapters(
  jingwei: readonly CockpitChapterSummaryItem[],
  memory: readonly { number: number; summary: string }[],
  limit = 2,
): Array<{ number: number; summary: string }> {
  const map = new Map<number, string>();
  for (const item of jingwei) {
    if (item.number > 0 && item.summary.trim()) map.set(item.number, item.summary.trim());
  }
  for (const item of memory) {
    if (item.number > 0 && item.summary.trim() && !map.has(item.number)) {
      map.set(item.number, item.summary.trim());
    }
  }
  return [...map.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, limit)
    .map(([number, summary]) => ({ number, summary }));
}

function pushWarning(
  warnings: string[],
  warningItems: WritePreflightWarning[],
  code: WritePreflightWarning["code"],
  message: string,
): void {
  warnings.push(message);
  const explained = explainDiagnostic(code, message);
  warningItems.push({
    code,
    message,
    explanation: explained.explanation,
    kind: explained.kind,
  });
}

/** blocker 一律带人话解释；前端读 explanation 而不是按 code 自造文案。 */
function makeBlocker(
  code: WritePreflightBlocker["code"],
  message: string,
): WritePreflightBlocker {
  const explained = explainDiagnostic(code, message);
  return { code, message, explanation: explained.explanation, kind: explained.kind };
}

/**
 * 当前卷的读取已收敛到 outline-volume 的 loadCurrentVolumeContext，
 * 这里不再保留第二份推导实现（曾经的重复导致卷目标进不了生成上下文）。
 */

export async function handleWritePreflight(input: WritePreflightInput): Promise<WritePreflightResult> {
  const bookId = trimText(input.bookId);
  const warnings: string[] = [];
  const warningItems: WritePreflightWarning[] = [];
  const blockers: WritePreflightBlocker[] = [];

  if (!bookId) {
    return {
      ok: false,
      bookId: "",
      chapterNumber: 1,
      currentFocus: { status: "missing", content: null, reason: "缺少 bookId" },
      resolvedDirective: null,
      needsUserConfirm: false,
      recentChapters: [],
      openHooksForChapter: [],
      overdueHooks: [],
      currentVolume: null,
      platform: null,
      formalChapterCount: 0,
      memoryHealth: {
        timeline: "missing",
        facts: "missing",
        style: "missing",
        hooks: "missing",
        events: "missing",
      },
      blockers: [makeBlocker("book-not-found", "缺少 bookId。")],
      requiredSkillAcknowledgements: [],
      warnings: [],
      warningItems: [],
      cockpit: null,
    };
  }

  const storage = input.storage ?? getStorageDatabase();
  ensureNarrativeMemorySchema(storage);
  ensureJingweiLedgerSchema(storage);

  let cockpitState = input.cockpitState;
  if (!cockpitState) {
    if (!input.bookRoot?.trim()) {
      // Fallback: still allow focus/memory checks without full chapter index.
      cockpitState = {
        loadBookConfig: async () => {
          throw new Error("book-root-unavailable");
        },
        loadChapterIndex: async () => [],
        bookDir: () => input.bookRoot ?? "",
      };
    } else {
      const bookRoot = input.bookRoot;
      cockpitState = {
        bookDir: () => bookRoot,
        loadBookConfig: async () => {
          const raw = await readFile(join(bookRoot, "book.json"), "utf8");
          return JSON.parse(raw);
        },
        loadChapterIndex: async () => {
          try {
            const raw = await readFile(join(bookRoot, "chapters", "index.json"), "utf8");
            return JSON.parse(raw);
          } catch {
            return [];
          }
        },
      };
    }
  }

  const cockpit = createCockpitService({
    state: cockpitState,
    now: input.now,
  });

  let snapshot: CockpitSnapshot;
  try {
    snapshot = await cockpit.getSnapshot({ bookId });
  } catch (error) {
    blockers.push(makeBlocker("book-not-found", `无法读取书籍驾驶舱：${error instanceof Error ? error.message : String(error)}`));
    return {
      ok: false,
      bookId,
      chapterNumber: typeof input.chapterNumber === "number" && input.chapterNumber > 0 ? input.chapterNumber : 1,
      currentFocus: { status: "missing", content: null, reason: "cockpit 读取失败" },
      resolvedDirective: null,
      needsUserConfirm: false,
      recentChapters: [],
      openHooksForChapter: [],
      overdueHooks: [],
      currentVolume: null,
      platform: null,
      formalChapterCount: 0,
      memoryHealth: {
        timeline: "missing",
        facts: "missing",
        style: "missing",
        hooks: "missing",
        events: "missing",
      },
      blockers,
      requiredSkillAcknowledgements: [],
      warnings,
      warningItems,
      cockpit: null,
    };
  }

  if (snapshot.status === "missing" || !snapshot.book) {
    blockers.push(makeBlocker("book-not-found", `书籍 ${bookId} 不存在或不可读。`));
  }

  const formalChapterCount = snapshot.progress.chapterCount ?? 0;
  const chapterNumber = typeof input.chapterNumber === "number" && input.chapterNumber > 0
    ? input.chapterNumber
    : Math.max(1, formalChapterCount + 1);

  const userDirective = trimText(input.userDirectives);
  const focusDefault = directiveFromFocus(snapshot.currentFocus);
  let resolvedDirective: string | null = null;
  let needsUserConfirm = false;

  if (userDirective.length >= MIN_DIRECTIVE_CHARS) {
    resolvedDirective = userDirective;
  } else if (userDirective.length > 0 && userDirective.length < MIN_DIRECTIVE_CHARS) {
    pushWarning(
      warnings,
      warningItems,
      "short-directive",
      `userDirectives 过短（<${MIN_DIRECTIVE_CHARS} 字），请改成一句明确的本章目标。`,
    );
    if (focusDefault) {
      resolvedDirective = focusDefault;
      needsUserConfirm = !input.acceptFocusDefault;
    } else {
      blockers.push(makeBlocker("missing-directive", `请提供至少 ${MIN_DIRECTIVE_CHARS} 字的本章指示，或先写好 currentFocus。`));
    }
  } else if (focusDefault) {
    resolvedDirective = focusDefault;
    needsUserConfirm = !input.acceptFocusDefault;
    if (needsUserConfirm) {
      pushWarning(
        warnings,
        warningItems,
        "focus-default-only",
        "未提供用户指示，已用 currentFocus 生成默认目标；scene.spec 需 acceptFocusDefault=true 或补一句用户指示。",
      );
    }
  } else {
    blockers.push(makeBlocker("missing-directive", "无用户本章指示，且经纬中无可用 currentFocus/大纲，无法确定写章方向。"));
  }

  const memorySummaries = listRecentMemoryChapterSummaries(storage, bookId, 2);
  const recentChapters = mergeRecentChapters(snapshot.recentChapterSummaries.items, memorySummaries, 2);

  const eventCount = countRows(
    storage,
    `SELECT COUNT(*) AS c FROM narrative_event WHERE book_id = ? AND status IN ('applied','pending')`,
    [bookId],
  );
  const factCount = countRows(
    storage,
    `SELECT COUNT(*) AS c FROM narrative_fact WHERE book_id = ?`,
    [bookId],
  );
  const timelineEventCount = countRows(
    storage,
    `SELECT COUNT(*) AS c FROM narrative_event WHERE book_id = ? AND status = 'applied' AND chapter_number IS NOT NULL`,
    [bookId],
  );

  let styleHealth: MemoryChannelHealth = "empty";
  let activeSkillsForAck: readonly AcknowledgeableWritingSkill[] = [];
  try {
    if (!input.bookRoot?.trim()) {
      // 没有可信项目根时不能扫描作品 `.novelfork/skills`；不依赖 book.json 选择字段。
      styleHealth = "disabled";
    } else {
      const activeWritingSkills = await loadActiveWritingSkillsForBook(bookId, { bookRoot: input.bookRoot });
      styleHealth = activeWritingSkills.skills.length > 0 ? "ok" : "disabled";
      activeSkillsForAck = activeWritingSkills.skills.map((skill) => ({
        slug: skill.slug,
        name: skill.name,
        body: skill.body ?? "",
      }));
    }
    if (styleHealth === "disabled") {
      pushWarning(
        warnings,
        warningItems,
        "style-disabled",
        "当前项目 `.novelfork/skills` 未发现可生效的 Writing Skills，style 通道将为空；可在写作设置中添加 1–2 个 Writing Skills。",
      );
    }
  } catch {
    styleHealth = "missing";
  }

  // Skill 生效硬门：已启用技能就必须先确认读过，不能只靠提示词要求模型自觉。
  const requiredSkillAcknowledgements = describeWritingSkillAcknowledgementRequirement(activeSkillsForAck);
  if (requiredSkillAcknowledgements.length > 0) {
    const verdict = verifyWritingSkillAcknowledgements({
      skills: activeSkillsForAck,
      acknowledged: input.acknowledgedSkills ?? [],
    });
    if (!verdict.ok) {
      const explanation = explainWritingSkillAcknowledgementVerdict({ verdict, skills: activeSkillsForAck });
      blockers.push({
        code: "skills-not-acknowledged",
        message: `${explanation.whatHappened} ${explanation.suggestedAction}`,
        explanation,
      });
    }
  }

  const memoryHealth = {
    timeline: recentChapters.length > 0 || (timelineEventCount ?? 0) > 0
      ? "ok" as const
      : healthFromCount(timelineEventCount),
    facts: healthFromCount(factCount),
    style: styleHealth,
    hooks: snapshot.openHooks.status === "missing"
      ? "missing" as const
      : (snapshot.openHooks.items.length > 0 ? "ok" as const : "empty" as const),
    events: healthFromCount(eventCount),
  };

  // 有正式章进度，但近章摘要/timeline 全空 → 记忆未活，禁止继续硬写。
  if (formalChapterCount >= 1 && recentChapters.length === 0 && memoryHealth.timeline === "empty") {
    blockers.push(makeBlocker("empty-recent-progress", `已有 ${formalChapterCount} 章进度，但近章摘要/时间线记忆为空。请先 memory.settle_range / book.dissect(settle=true) 回填，或 pipeline.import_chapters 后 autoSettle。`));
  }

  const highRisk = listHighRiskPendingNarrativeEvents(storage, { bookId, limit: 20 });
  let blockHighRisk = false;
  let blockOnOverdueHooks = false;
  if (input.bookRoot?.trim()) {
    try {
      const config = await loadNarrativeMemoryConfig(bookId, input.bookRoot);
      blockHighRisk = config.settlement.blockWriteOnHighRiskPending;
    } catch {
      blockHighRisk = false;
    }
    try {
      const book = await cockpitState.loadBookConfig(bookId);
      blockOnOverdueHooks = Boolean((book as { blockOnOverdueHooks?: unknown }).blockOnOverdueHooks);
    } catch {
      blockOnOverdueHooks = false;
    }
  }
  if (highRisk.length > 0) {
    const msg = `存在 ${highRisk.length} 条高风险 pending NarrativeEvents，请先 memory.events / 面板处理。`;
    if (blockHighRisk) {
      blockers.push(makeBlocker("high-risk-pending", msg));
    } else {
      pushWarning(warnings, warningItems, "high-risk-pending", msg);
    }
  }

  if (snapshot.recentChapterSummaries.status === "empty" && formalChapterCount >= 1) {
    pushWarning(
      warnings,
      warningItems,
      "empty-chapter-summary",
      "经纬 chapter-summary 为空；若未结算，写前只能依赖 memory 事件摘要。",
    );
  }

  // 审计新鲜度：正文在审计之后被改过，则那份「通过」结论已失效。
  // 只提醒不阻断：改自己的正文是正常操作，不该因此写不了下一章。
  const staleAudits = findStaleAuditChapters(storage, bookId, snapshot);
  if (staleAudits.length > 0) {
    const preview = staleAudits.slice(0, 5).join("、");
    const more = staleAudits.length > 5 ? ` 等 ${staleAudits.length} 章` : "";
    pushWarning(
      warnings,
      warningItems,
      "audit-stale",
      `第 ${preview}${more} 在审计后又改过正文，审计结论已过期。`,
    );
  }

  const openHooksForChapter = snapshot.openHooks.items.slice(0, 12);
  const overdueHooks = snapshot.openHooks.items
    .filter((hook) => hook.status === "expired-risk" || hook.status === "payoff-due")
    .slice(0, 12);
  if (overdueHooks.length > 0) {
    const msg = `有 ${overdueHooks.length} 条到期/临近伏笔未处理（默认仅警告）。`;
    if (blockOnOverdueHooks) {
      // 书级可选硬拦：复用 high-risk 语义不合适，只进 warnings + 由调用方看 ok 仍 true；
      // 若未来要硬拦再扩 blocker code。当前按计划默认 false。
      pushWarning(warnings, warningItems, "hooks-overdue", `${msg}（本书开启了 blockOnOverdueHooks 提示，仍默认不硬拦写章。）`);
    } else {
      pushWarning(warnings, warningItems, "hooks-overdue", msg);
    }
  }

  // 平台 profile：只做软提示，不硬拦写章。
  let platformInfo: WritePreflightResult["platform"] = null;
  try {
    const book = await cockpitState.loadBookConfig(bookId);
    const { resolvePlatformProfile, checkPlatformChapterTarget } = await import("../engine/platform/platform-profile.js");
    const profile = resolvePlatformProfile(book as { platform?: unknown; publishPlatform?: unknown });
    const chapterWordCount = Number((book as { chapterWordCount?: unknown }).chapterWordCount);
    const target = Number.isFinite(chapterWordCount) && chapterWordCount > 0
      ? checkPlatformChapterTarget({ profile, chapterWordCount })
      : null;
    platformInfo = {
      platform: profile.platform,
      label: profile.label,
      chapterTargetStatus: target?.status ?? "unknown",
      recommendedChapterWords: profile.chapterWords,
      notes: profile.notes,
    };
    if (target && target.status !== "ok" && target.message) {
      pushWarning(warnings, warningItems, "platform-target-mismatch", target.message);
    }
  } catch {
    platformInfo = null;
  }

  // 当前卷统一走 outline-volume 的共享入口：此前这里另有一份推导实现，
  // 结果卷目标只停留在 preflight 结果里，没进生成上下文。
  const { loadCurrentVolumeContext } = await import("./outline-volume.js");
  const volumeContext = loadCurrentVolumeContext(storage, bookId, chapterNumber);
  const currentVolume = volumeContext.current
    ? { title: volumeContext.current.title, goal: volumeContext.current.goal }
    : null;
  if (!currentVolume && formalChapterCount >= 3) {
    pushWarning(
      warnings,
      warningItems,
      "volume-focus-missing",
      "经纬 outline 中未设置卷纲；长篇建议用 outline.volume(action=suggest→set) 设定本卷目标。",
    );
  }
  // 越界在 pipeline.write 是硬拦，这里提前预警，避免作者把一次生成浪费在被拦的章号上。
  if (volumeContext.inRange === false && volumeContext.current) {
    const { from, to } = volumeContext.current.chapterRange;
    pushWarning(
      warnings,
      warningItems,
      "volume-range-drift",
      `第 ${chapterNumber} 章不在当前卷《${volumeContext.current.title}》区间（第 ${from}-${to} 章）内，pipeline.write 会以 volume-range-violation 拦下；请先用 outline.volume 修正卷区间或切换 active 卷。`,
    );
  }

  return {
    ok: blockers.length === 0 && Boolean(resolvedDirective),
    bookId,
    chapterNumber,
    currentFocus: snapshot.currentFocus,
    resolvedDirective,
    needsUserConfirm,
    recentChapters,
    openHooksForChapter,
    overdueHooks,
    currentVolume,
    platform: platformInfo,
    formalChapterCount,
    memoryHealth,
    blockers,
    requiredSkillAcknowledgements,
    warnings,
    warningItems,
    cockpit: {
      status: snapshot.status,
      progress: snapshot.progress,
      currentFocus: snapshot.currentFocus,
      recentChapterSummaries: snapshot.recentChapterSummaries,
      openHooks: snapshot.openHooks,
      recentChapterResults: snapshot.recentChapterResults,
    },
  };
}

export function assertDirectiveReady(input: {
  readonly userDirectives?: string;
  readonly acceptFocusDefault?: boolean;
  readonly preflight?: Pick<WritePreflightResult, "resolvedDirective" | "needsUserConfirm" | "ok" | "blockers"> | null;
}): { ok: true; directive: string } | { ok: false; error: string; summary: string } {
  const preflight = input.preflight;
  if (preflight && !preflight.ok) {
    const message = preflight.blockers.map((item) => item.message).join("；") || "写前上下文未就绪。";
    return { ok: false, error: "context-not-ready", summary: message };
  }
  if (preflight?.needsUserConfirm && !input.acceptFocusDefault && !trimText(input.userDirectives)) {
    return {
      ok: false,
      error: "needs-user-confirm",
      summary: "仅有 focus 默认目标。请补一句用户指示，或传 acceptFocusDefault=true。",
    };
  }
  const directive = trimText(input.userDirectives) || preflight?.resolvedDirective || "";
  if (directive.length < MIN_DIRECTIVE_CHARS) {
    return {
      ok: false,
      error: "missing-directive",
      summary: `本章指示过短或为空（需 ≥${MIN_DIRECTIVE_CHARS} 字）。请先 write.preflight 或提供 userDirectives。`,
    };
  }
  return { ok: true, directive };
}
