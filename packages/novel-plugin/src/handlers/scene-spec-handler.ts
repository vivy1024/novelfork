/**
 * scene.spec handler — 校验当前 Runtime Agent 提交的结构化写作蓝图（Scene Spec）。
 *
 * 蓝图必须由外层 Runtime Agent 显式提交；本工具只做确定性校验，不隐藏调用模型。
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkBeatBudget, parseBeatBudget, type BeatBudgetItem, type BeatBudgetReport } from "./beat-budget.js";
import {
  EMPTY_WRITING_SKILL_CONSTRAINT_DIGEST,
  toSceneSpecConstraintLines,
  type WritingSkillConstraintDigest,
} from "../engine/writing-skills/compliance.js";
import {
  recallMechanismCardsForPlanning,
  type PlanningMechanismReference,
} from "../engine/writing-layers/mechanism-cards.js";
import { parseSceneGaps, type SceneGap } from "./scene-gaps.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type { SceneGap, SceneGapKind } from "./scene-gaps.js";

export interface SceneReactionPair {
  action: string;
  reactions: string;
}

export type SceneSpecEngineRole = "payoff" | "buildup" | "upgrade" | "pivot";

export type SceneCraftMode = "active" | "reactive";
export type SceneInfoMode = "suspense" | "mystery" | "irony";

export interface SceneValueTurn {
  /** 开场价值电荷（如「安全」「信任」「占优」「+」）。 */
  from: string;
  /** 收尾价值电荷（如「孤立」「怀疑」「暴露」「-」）；与 from 相同会触发非事件告警。 */
  to: string;
}

export interface SceneExpectationGap {
  /** 视点角色按经验预期的保守结果。 */
  expectation: string;
  /** 客观对抗力量劈开的相反或剧烈升级结果（「鸿沟」）。 */
  reality: string;
}

export interface SceneSpecContractCheck {
  agencyOwner?: string;
  payoffOwner?: string;
}

export interface SceneSpecScene {
  characters: string[];
  location: string;
  conflict: string;
  mood: string;
  outcome: string;
  hooks_used: string[];
  hooks_planted: string[];
  /** 场景引擎模式（可选）：active 主动场（目标→冲突→挫折）| reactive 被动场（反应→困境→价值取舍决定）。 */
  sceneMode?: SceneCraftMode;
  /** 场景起止价值电荷翻转（可选）：用于检验是否为有真实戏剧变化的事件而非空转「非事件」。 */
  valueTurn?: SceneValueTurn;
  /** 期望与结果间的「鸿沟」（可选）：防止人物按预期顺遂办事沦为平淡日常活动。 */
  expectationGap?: SceneExpectationGap;
  /** 最后时刻深切入点（可选）：明确跳过哪些到达/寒暄过场，从哪一瞬间直接起戏。 */
  entryPoint?: string;
  /** 信息差张力模式（可选）：suspense 悬念 | mystery 神秘 | irony 戏剧反讽。 */
  infoMode?: SceneInfoMode;
  /** 场内逻辑因果小节拍（A 导致 B 导致 C，防注水）。 */
  microBeats?: string[];
  /** 本场必须向读者交付的具体信息增量 / 物证 / 账目 / 规则细节。 */
  infoPayloads?: string[];
  /** 关键动作与在场配角差异化反应对（防主角独角戏）。 */
  reactionPairs?: SceneReactionPair[];
  /** 本场禁区谓词（严禁提前泄露的底牌、禁止角色失真行为）。 */
  forbid?: string[];
  /** 规划留白；可省略。 */
  gaps?: SceneGap[];
}

export interface SceneCraftFinding {
  readonly sceneIndex: number;
  readonly code: "non-event-value-turn" | "flat-expectation-gap" | "missing-drama-turn";
  readonly message: string;
}

export interface SceneSpec {
  chapter: number;
  title: string;
  wordTarget: number;
  /** 本章对核心爽感引擎的贡献角色。 */
  engineRole?: SceneSpecEngineRole;
  /** 主角因果权与结算权归属自检。 */
  contractCheck?: SceneSpecContractCheck;
  /**
   * 情节点字数预算。让章内节奏可核对：密点展开、疏点带过，
   * 总和落在 [wordTarget, wordTarget×1.1]。为空时退化为只有总字数约束。
   */
  beatBudget?: BeatBudgetItem[];
  scenes: SceneSpecScene[];
  constraints: string[];
}

export interface SceneSpecInput {
  bookId: string;
  chapterNumber: number;
  userDirectives: string;
  /** 仅有 focus 默认目标时是否接受继续 */
  acceptFocusDefault?: boolean;
  /** 仅测试/迁移：跳过 empty-recent-progress 硬门 */
  skipContextGate?: boolean;
  /** write.preflight 结果（可选；传入可复用并参与硬门） */
  writePreflight?: Record<string, unknown>;
  /** 调用方直接给定的情节点预算（可选；给了就不让 LLM 另拟一套） */
  beatBudget?: unknown;
  cockpitSnapshot?: Record<string, unknown>;
  /** 兼容旧字段；新调用优先 loreBrief */
  jingweiBrief?: Record<string, unknown>;
  loreBrief?: Record<string, unknown>;
  memoryContext?: Record<string, unknown>;
  /** Trusted book root for preflight gate */
  bookRoot?: string;
  /** 当前 Runtime Agent 显式提交的蓝图；工具只校验，不替模型生成。 */
  sceneSpec?: unknown;
  /** 点名实体：write profile / facts 一跳扩展时超过 6/8/3 上限仍保留。 */
  namedEntities?: string[];
  /** 作者显式勾选的机制卡 ID 列表（优先置顶召回）。 */
  pinnedMechanismIds?: string[];
  /** 作者指定的信息增量锚点（自动并入蓝图 constraints）。 */
  infoAnchors?: string[];
}

export interface SceneSpecSuccess {
  ok: true;
  summary: string;
  data: {
    sceneSpec: SceneSpec;
    /** 情节点预算校验结果；未提供 beatBudget 时也会给，用于提示未拆点。 */
    beatBudget?: BeatBudgetReport;
    namedEntities?: readonly string[];
    entityExpansion?: {
      readonly facts: ReadonlyArray<{
        readonly id: string;
        readonly subject: string;
        readonly predicate: string;
        readonly object: string;
      }>;
    };
    /**
     * 已启用 Writing Skills 的硬性约束摘要，与出口合规校验同源。
     * 已并入 sceneSpec.constraints，这里另给结构化版本便于渲染与下游复用。
     */
    writingSkillConstraints?: WritingSkillConstraintDigest;
    /**
     * 规划期中观可迁移机制卡辅助参考（仅出现在 scene.spec 返回体供蓝图打磨，绝不进入正文写前 style 通道）。
     */
    planningMechanisms?: readonly PlanningMechanismReference[];
    /**
     * 场景戏剧结构自检发现（非事件场、期望与结果无鸿沟等软告警，不阻断提交但提醒蓝图精修）。
     */
    craftFindings?: readonly SceneCraftFinding[];
  };
}

export interface SceneSpecFailure {
  ok: false;
  error: string;
  summary: string;
}

export type SceneSpecResult = SceneSpecSuccess | SceneSpecFailure;

const VALID_ENGINE_ROLES = new Set<SceneSpecEngineRole>(["payoff", "buildup", "upgrade", "pivot"]);
const VALID_SCENE_MODES = new Set<SceneCraftMode>(["active", "reactive"]);
const VALID_INFO_MODES = new Set<SceneInfoMode>(["suspense", "mystery", "irony"]);

function parseValueTurn(value: unknown): SceneValueTurn | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const rec = value as Record<string, unknown>;
  const from = typeof rec.from === "string" ? rec.from.trim() : "";
  const to = typeof rec.to === "string" ? rec.to.trim() : "";
  if (!from || !to) return undefined;
  return { from, to };
}

function parseExpectationGap(value: unknown): SceneExpectationGap | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const rec = value as Record<string, unknown>;
  const expectation = typeof rec.expectation === "string" ? rec.expectation.trim() : "";
  const reality = typeof rec.reality === "string" ? rec.reality.trim() : "";
  if (!expectation || !reality) return undefined;
  return { expectation, reality };
}

function normalizeComparableText(text: string): string {
  return text.toLowerCase().replace(/[\s，。、；：！？,.;:!?'"“”‘’()（）\[\]【】]/gu, "");
}

/**
 * 确定性戏剧结构自检（零 Token）：
 * 1. 若标注了 valueTurn 但起止价值相同，判定为「疑似非事件场」；
 * 2. 若标注了 expectationGap 但期望与结果一致，判定为「未劈开鸿沟（平顺活动）」；
 * 3. 若整章 ≥2 场且全部未标注 valueTurn / expectationGap，且无 microBeats，提示补充价值翻转与鸿沟。
 */
export function inspectSceneCraftFindings(scenes: readonly SceneSpecScene[]): SceneCraftFinding[] {
  const findings: SceneCraftFinding[] = [];
  for (let i = 0; i < scenes.length; i += 1) {
    const scene = scenes[i]!;
    if (scene.valueTurn) {
      if (normalizeComparableText(scene.valueTurn.from) === normalizeComparableText(scene.valueTurn.to)) {
        findings.push({
          sceneIndex: i + 1,
          code: "non-event-value-turn",
          message: `场景 ${i + 1} 起止价值电荷未发生变化（${scene.valueTurn.from} → ${scene.valueTurn.to}），疑似「非事件场」：建议合并为过场或制造真实逆转/代价。`,
        });
      }
    }
    if (scene.expectationGap) {
      if (normalizeComparableText(scene.expectationGap.expectation) === normalizeComparableText(scene.expectationGap.reality)) {
        findings.push({
          sceneIndex: i + 1,
          code: "flat-expectation-gap",
          message: `场景 ${i + 1} 主观期望与客观结果一致，未劈开戏剧「鸿沟」：建议加入出乎意料的阻挠、误判或升级反击。`,
        });
      }
    }
  }
  return findings;
}

function parseOptionalStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseReactionPairs(value: unknown): SceneReactionPair[] {
  if (!Array.isArray(value)) return [];
  const out: SceneReactionPair[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const action = typeof rec.action === "string" ? rec.action.trim() : "";
    const reactions = typeof rec.reactions === "string" ? rec.reactions.trim() : "";
    if (action && reactions) out.push({ action, reactions });
  }
  return out;
}

function parseContractCheck(value: unknown): SceneSpecContractCheck | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const rec = value as Record<string, unknown>;
  const agencyOwner = typeof rec.agencyOwner === "string" ? rec.agencyOwner.trim() : "";
  const payoffOwner = typeof rec.payoffOwner === "string" ? rec.payoffOwner.trim() : "";
  if (!agencyOwner && !payoffOwner) return undefined;
  return {
    ...(agencyOwner ? { agencyOwner } : {}),
    ...(payoffOwner ? { payoffOwner } : {}),
  };
}

function parseSceneSpecFromLLM(raw: string, chapterNumber: number, wordTarget: number): SceneSpec | null {
  try {
    // 提取 JSON（可能被 markdown code block 包裹）
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[1]!.trim());

    // 校验基本结构
    if (!parsed.scenes || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) return null;

    const beatBudget = parseBeatBudget(parsed.beatBudget);
    const engineRole = typeof parsed.engineRole === "string" && VALID_ENGINE_ROLES.has(parsed.engineRole as SceneSpecEngineRole)
      ? (parsed.engineRole as SceneSpecEngineRole)
      : undefined;
    const contractCheck = parseContractCheck(parsed.contractCheck);
    return {
      chapter: parsed.chapter ?? chapterNumber,
      title: parsed.title ?? `第${chapterNumber}章`,
      wordTarget: parsed.wordTarget ?? wordTarget,
      ...(engineRole ? { engineRole } : {}),
      ...(contractCheck ? { contractCheck } : {}),
      ...(beatBudget.length > 0 ? { beatBudget } : {}),
      scenes: parsed.scenes.map((s: any) => {
        const gaps = parseSceneGaps(s.gaps);
        const microBeats = parseOptionalStringList(s.microBeats);
        const infoPayloads = parseOptionalStringList(s.infoPayloads);
        const reactionPairs = parseReactionPairs(s.reactionPairs);
        const forbid = parseOptionalStringList(s.forbid);
        const sceneMode = typeof s.sceneMode === "string" && VALID_SCENE_MODES.has(s.sceneMode as SceneCraftMode)
          ? (s.sceneMode as SceneCraftMode)
          : undefined;
        const valueTurn = parseValueTurn(s.valueTurn);
        const expectationGap = parseExpectationGap(s.expectationGap);
        const entryPoint = typeof s.entryPoint === "string" && s.entryPoint.trim() ? s.entryPoint.trim() : undefined;
        const infoMode = typeof s.infoMode === "string" && VALID_INFO_MODES.has(s.infoMode as SceneInfoMode)
          ? (s.infoMode as SceneInfoMode)
          : undefined;
        return {
          characters: Array.isArray(s.characters) ? s.characters : ["主角"],
          location: s.location ?? "待定",
          conflict: s.conflict ?? "待定",
          mood: s.mood ?? "待定",
          outcome: s.outcome ?? "待定",
          hooks_used: Array.isArray(s.hooks_used) ? s.hooks_used : [],
          hooks_planted: Array.isArray(s.hooks_planted) ? s.hooks_planted : [],
          ...(sceneMode ? { sceneMode } : {}),
          ...(valueTurn ? { valueTurn } : {}),
          ...(expectationGap ? { expectationGap } : {}),
          ...(entryPoint ? { entryPoint } : {}),
          ...(infoMode ? { infoMode } : {}),
          ...(microBeats.length > 0 ? { microBeats } : {}),
          ...(infoPayloads.length > 0 ? { infoPayloads } : {}),
          ...(reactionPairs.length > 0 ? { reactionPairs } : {}),
          ...(forbid.length > 0 ? { forbid } : {}),
          ...(gaps.length > 0 ? { gaps } : {}),
        };
      }),
      constraints: Array.isArray(parsed.constraints) ? parsed.constraints : [],
    };
  } catch {
    return null;
  }
}

/** 校验模型显式提交的蓝图结构；scene.spec 与工作流蓝图候选共用这一条判据。 */
export function parseSceneSpecValue(value: unknown, chapterNumber: number, wordTarget: number): SceneSpec | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return parseSceneSpecFromLLM(JSON.stringify(value), chapterNumber, wordTarget);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * 字数目标：cockpitSnapshot.bookConfig > bookRoot/book.json > 3000。
 * Runtime 派发 scene.spec 时只带 bookRoot、不带 cockpitSnapshot，不读书配置就会把
 * 2200 字的书报成「目标 3000」，与 write.preflight、chapter.audit 的口径不一致。
 */
async function extractWordTarget(cockpitSnapshot?: Record<string, unknown>, bookRoot?: string): Promise<number> {
  const bookConfig = cockpitSnapshot?.bookConfig as { chapterWordCount?: number } | undefined;
  if (typeof bookConfig?.chapterWordCount === "number") return bookConfig.chapterWordCount;
  if (bookRoot?.trim()) {
    try {
      const book = JSON.parse(await readFile(join(bookRoot, "book.json"), "utf8")) as { chapterWordCount?: unknown };
      if (typeof book.chapterWordCount === "number" && Number.isSafeInteger(book.chapterWordCount) && book.chapterWordCount > 0) {
        return book.chapterWordCount;
      }
    } catch {
      // book.json 缺失/损坏不阻断蓝图校验，交回默认值
    }
  }
  return 3000;
}

const SCENE_SPEC_CACHE_TTL_MS = 60 * 60 * 1000;
const validatedSceneSpecCache = new Map<string, { readonly spec: SceneSpec; readonly cachedAt: number }>();

function sceneSpecCacheKey(bookId: string, chapterNumber: number): string {
  return `${bookId}::${chapterNumber}`;
}

/** 缓存刚通过 chapter.blueprint 校验的蓝图，供下游 chapter.commit / chapter.audit 自动复用。 */
export function cacheValidatedSceneSpec(bookId: string, spec: SceneSpec, now = Date.now()): void {
  validatedSceneSpecCache.set(sceneSpecCacheKey(bookId, spec.chapter), { spec, cachedAt: now });
}

export function getCachedSceneSpec(bookId: string, chapterNumber: number, now = Date.now()): SceneSpec | null {
  const entry = validatedSceneSpecCache.get(sceneSpecCacheKey(bookId, chapterNumber));
  if (!entry) return null;
  if (now - entry.cachedAt > SCENE_SPEC_CACHE_TTL_MS) {
    validatedSceneSpecCache.delete(sceneSpecCacheKey(bookId, chapterNumber));
    return null;
  }
  return entry.spec;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function handleSceneSpec(input: SceneSpecInput): Promise<SceneSpecResult> {
  let { bookId, chapterNumber, cockpitSnapshot, jingweiBrief } = input;

  if (!bookId || !chapterNumber) {
    return {
      ok: false,
      error: "missing-required-fields",
      summary: "缺少必填字段：bookId、chapterNumber 均为必填。",
    };
  }

  // 写前硬门：优先复用传入的 writePreflight；否则在有 bookRoot 时现算。
  let resolvedDirectives = typeof input.userDirectives === "string" ? input.userDirectives.trim() : "";
  if (!input.skipContextGate) {
    try {
      const { assertDirectiveReady, handleWritePreflight } = await import("./write-preflight.js");
      let preflight = input.writePreflight as
        | {
            ok?: boolean;
            resolvedDirective?: string | null;
            needsUserConfirm?: boolean;
            blockers?: ReadonlyArray<{ readonly code: string; readonly message: string }>;
          }
        | undefined;

      if (!preflight && input.bookRoot?.trim()) {
        const computed = await handleWritePreflight({
          bookId,
          chapterNumber,
          userDirectives: input.userDirectives,
          acceptFocusDefault: input.acceptFocusDefault,
          bookRoot: input.bookRoot,
        });
        preflight = computed;
        input = { ...input, writePreflight: computed as unknown as Record<string, unknown> };
        if (!resolvedDirectives && computed.resolvedDirective) {
          resolvedDirectives = computed.resolvedDirective;
        }
      }

      if (preflight) {
        const gate = assertDirectiveReady({
          userDirectives: resolvedDirectives || input.userDirectives,
          acceptFocusDefault: input.acceptFocusDefault,
          preflight: {
            ok: Boolean(preflight.ok),
            resolvedDirective: preflight.resolvedDirective ?? null,
            needsUserConfirm: Boolean(preflight.needsUserConfirm),
            blockers: Array.isArray(preflight.blockers)
              ? preflight.blockers.map((item) => ({
                  // skills-not-acknowledged 已降级为 warning，不再出现在 blockers 里。
                  code: item.code as
                    | "missing-directive"
                    | "empty-recent-progress"
                    | "high-risk-pending"
                    | "book-not-found",
                  message: item.message,
                }))
              : [],
          },
        });
        if (!gate.ok) {
          return { ok: false, error: gate.error, summary: gate.summary };
        }
        resolvedDirectives = gate.directive;
      } else if (!resolvedDirectives) {
        return {
          ok: false,
          error: "empty-directives",
          summary: "userDirectives 为空。请先 write.preflight 或提供本章一句指示。",
        };
      } else if (resolvedDirectives.length < 8) {
        return {
          ok: false,
          error: "missing-directive",
          summary: "userDirectives 过短（需 ≥8 字）。请提供一句明确的本章目标。",
        };
      }
    } catch {
      if (!resolvedDirectives) {
        return {
          ok: false,
          error: "empty-directives",
          summary: "userDirectives 为空，无法生成写作蓝图。请提供本章写作方向/意图。",
        };
      }
    }
  } else if (!resolvedDirectives) {
    return {
      ok: false,
      error: "empty-directives",
      summary: "userDirectives 为空，无法生成写作蓝图。请提供本章写作方向/意图。",
    };
  }

  // 将 preflight 近章/伏笔摘要并入 cockpitSnapshot，供 LLM/fallback 使用。
  let enrichedCockpit = cockpitSnapshot;
  const pf = input.writePreflight as
    | {
        recentChapters?: Array<{ number?: number; summary?: string }>;
        openHooksForChapter?: Array<{ text?: string; description?: string }>;
        overdueHooks?: Array<{ text?: string }>;
        currentVolume?: { title?: string; goal?: string } | null;
        writingSkillConstraints?: WritingSkillConstraintDigest;
      }
    | undefined;
  if (pf && !enrichedCockpit) {
    enrichedCockpit = {
      progress: {},
      openHooks: (pf.openHooksForChapter ?? []).map((hook) => ({
        description: hook.text ?? hook.description ?? "",
      })),
      recentChapters: (pf.recentChapters ?? []).map((item) => ({
        number: item.number,
        summary: item.summary,
      })),
      overdueHooks: pf.overdueHooks ?? [],
      currentVolume: pf.currentVolume ?? null,
    };
  } else if (pf && enrichedCockpit) {
    enrichedCockpit = {
      ...enrichedCockpit,
      ...(pf.recentChapters ? { recentChapters: pf.recentChapters } : {}),
      ...(pf.overdueHooks ? { overdueHooks: pf.overdueHooks } : {}),
      ...(pf.currentVolume ? { currentVolume: pf.currentVolume } : {}),
    };
  }

  const wordTarget = await extractWordTarget(enrichedCockpit ?? cockpitSnapshot, input.bookRoot);
  const sceneSpec = parseSceneSpecValue(input.sceneSpec, chapterNumber, wordTarget);
  if (!sceneSpec) {
    return {
      ok: false,
      error: input.sceneSpec === undefined ? "scene-spec-required" : "scene-spec-invalid",
      summary: input.sceneSpec === undefined
        ? "scene.spec 必须由当前 Runtime Agent 显式提交 sceneSpec 蓝图；工具不会在内部调用模型生成。"
        : "sceneSpec 蓝图结构无效，请补齐 chapter/title/wordTarget/scenes/constraints 及每个场景的 characters/location/conflict/outcome。",
    };
  }

  // H4 硬约束校验
  if (sceneSpec.scenes.length === 0) {
    return { ok: false, error: "empty-scenes", summary: "生成的 Scene Spec 中 scenes 为空。" };
  }

  for (let i = 0; i < sceneSpec.scenes.length; i++) {
    const s = sceneSpec.scenes[i]!;
    const missing: string[] = [];
    if (!s.characters || s.characters.length === 0) missing.push("characters");
    if (!s.location) missing.push("location");
    if (!s.conflict) missing.push("conflict");
    if (!s.outcome) missing.push("outcome");
    if (missing.length > 0) {
      return {
        ok: false,
        error: "incomplete-scene",
        summary: `场景 ${i + 1} 缺少必要字段：${missing.join("、")}。`,
      };
    }
  }

  /*
   * Writing Skills 的**硬性条目**进蓝图，技能正文不进。
   *
   * 这样做的理由：出口按 checks 硬拦成品，如果生成阶段完全不知道这些条目，
   * 违规只能等到整章被打回。注入的是结构化规则（与出口同源），不是技能全文——
   * 全文由 Runtime 的 Skill 机制交给 agent 自主选择读取，管线不代为注入上下文。
   */
  let writingSkillConstraints: WritingSkillConstraintDigest = pf?.writingSkillConstraints
    ?? EMPTY_WRITING_SKILL_CONSTRAINT_DIGEST;
  if (writingSkillConstraints.items.length === 0 && input.bookRoot?.trim()) {
    try {
      const { loadWritingSkillConstraintDigestForBook } = await import("./writing-skill-handlers.js");
      writingSkillConstraints = await loadWritingSkillConstraintDigestForBook(bookId, { bookRoot: input.bookRoot });
    } catch {
      // 摘要是增强项：读不到就按空处理，出口仍会按 checks 校验成品。
      writingSkillConstraints = EMPTY_WRITING_SKILL_CONSTRAINT_DIGEST;
    }
  }
  const constraintLines = toSceneSpecConstraintLines(writingSkillConstraints);
  if (constraintLines.length > 0) {
    const existing = new Set(sceneSpec.constraints);
    sceneSpec.constraints = [
      ...sceneSpec.constraints,
      ...constraintLines.filter((line) => !existing.has(line)),
    ];
  }

  const infoAnchors = parseOptionalStringList(input.infoAnchors);
  if (infoAnchors.length > 0) {
    const existing = new Set(sceneSpec.constraints);
    const anchorLines = infoAnchors.map((item) => `【作者指定信息增量锚点】${item}`);
    sceneSpec.constraints = [
      ...sceneSpec.constraints,
      ...anchorLines.filter((line) => !existing.has(line)),
    ];
  }

  // 场景级 forbid 禁区谓词同步收口进 constraints，保证 pipeline 写前与硬约束通道一眼可见
  const sceneForbidLines = sceneSpec.scenes.flatMap((scene, index) =>
    (scene.forbid ?? []).map((rule) => `【场景${index + 1}禁区】${rule}`),
  );
  if (sceneForbidLines.length > 0) {
    const existing = new Set(sceneSpec.constraints);
    sceneSpec.constraints = [
      ...sceneSpec.constraints,
      ...sceneForbidLines.filter((line) => !existing.has(line)),
    ];
  }

  const source = "Runtime Agent 显式提交";
  // 调用方显式给的预算优先于 LLM 自拟，避免作者定好的节奏被覆盖。
  const explicitBudget = parseBeatBudget(input.beatBudget);
  if (explicitBudget.length > 0) sceneSpec.beatBudget = explicitBudget;
  // 情节点预算在本工具只报告不阻断：蓝图本身已通过场景完备性校验，
  // 预算怎么改由作者或叙述者决定。但 pipeline.write 会对 block 级预算硬拒绝，
  // 所以这里必须把「不修就写不了」说清楚，避免带着不合格结构进生产。
  const budget = checkBeatBudget({
    chapterTarget: wordTarget,
    beats: sceneSpec.beatBudget ?? [],
  });
  const blockers = budget.findings.filter((finding) => finding.severity === "block");
  const gateNote = blockers.length > 0
    ? " 预算判为不合规，pipeline.write 会以 beat-budget-invalid 拒绝执行，请先重排预算再写章。"
    : "";

  const hasBeatBudget = (sceneSpec.beatBudget?.length ?? 0) > 0;
  const hasHighDensityFields = sceneSpec.scenes.some(
    (scene) => (scene.microBeats?.length ?? 0) > 0 || (scene.infoPayloads?.length ?? 0) > 0,
  );
  const densityNote = !hasBeatBudget && !hasHighDensityFields
    ? " 密度提示：当前蓝图未拆 beatBudget 且场景缺少 microBeats / infoPayloads（因果小节拍与具体信息增量），建议补充以防正文靠环境描写注水。"
    : "";

  const craftFindings = inspectSceneCraftFindings(sceneSpec.scenes);
  const craftNote = craftFindings.length > 0
    ? ` 戏剧结构提醒：${craftFindings.map((item) => item.message).join(" ")}`
    : "";

  const anchorNote = infoAnchors.length > 0
    ? ` 已并入 ${infoAnchors.length} 条作者指定信息增量锚点。`
    : "";

  const skillNote = writingSkillConstraints.items.length > 0
    ? ` 已并入 ${writingSkillConstraints.items.length} 条 Writing Skills 可机器校验约束（其中 ${writingSkillConstraints.blockingCount} 条硬性，保存前会逐条校验）。`
    : "";
  const namedEntities = uniqueNamedEntities(input.namedEntities, sceneSpec);
  let entityExpansion: Awaited<ReturnType<typeof expandNamedEntities>> | undefined;
  if (namedEntities.length > 0) {
    try {
      entityExpansion = await expandNamedEntities({
        bookId,
        chapterNumber,
        namedEntities,
        bookRoot: input.bookRoot,
      });
    } catch {
      entityExpansion = undefined;
    }
  }
  const expansionNote = entityExpansion
    ? ` 已按点名实体扩展 ${namedEntities.join("、")}：事实 ${entityExpansion.facts.length} 条。`
    : namedEntities.length > 0
      ? ` 点名实体 ${namedEntities.join("、")} 已记录，召回超上限时仍保留。`
      : "";
  const pinnedMechanismIds = parseOptionalStringList(input.pinnedMechanismIds);
  let planningMechanisms: PlanningMechanismReference[] = [];
  if (input.bookRoot?.trim()) {
    const planningQuery = [
      resolvedDirectives,
      sceneSpec.title,
      ...sceneSpec.scenes.flatMap((scene) => [scene.location, scene.conflict, scene.outcome]),
    ].filter(Boolean).join(" ");
    planningMechanisms = await recallMechanismCardsForPlanning(
      input.bookRoot,
      planningQuery,
      4,
      pinnedMechanismIds,
    ).catch(() => []);
  }
  const mechanismNote = planningMechanisms.length > 0
    ? ` 已附上 ${planningMechanisms.length} 张可迁移机制卡供细纲推演参考${pinnedMechanismIds.length > 0 ? "（含作者点选置顶）" : ""}。`
    : "";
  cacheValidatedSceneSpec(bookId, sceneSpec);
  return {
    ok: true,
    summary: `已生成第${chapterNumber}章写作蓝图（${source}）：${sceneSpec.scenes.length} 个场景，目标 ${wordTarget} 字。${budget.summary}${gateNote}${densityNote}${craftNote}${anchorNote}${skillNote}${expansionNote}${mechanismNote}`,
    data: {
      sceneSpec,
      beatBudget: budget,
      namedEntities,
      ...(entityExpansion ? { entityExpansion } : {}),
      ...(writingSkillConstraints.items.length > 0 ? { writingSkillConstraints } : {}),
      ...(planningMechanisms.length > 0 ? { planningMechanisms } : {}),
      ...(craftFindings.length > 0 ? { craftFindings } : {}),
    },
  };
}

function uniqueNamedEntities(explicit: unknown, sceneSpec: SceneSpec): string[] {
  const fromScenes = sceneSpec.scenes.flatMap((scene) => [...scene.characters, ...scene.hooks_used, ...scene.hooks_planted]);
  const extra = Array.isArray(explicit) ? explicit.filter((item): item is string => typeof item === "string") : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of [...extra, ...fromScenes]) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

async function expandNamedEntities(input: {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly namedEntities: readonly string[];
  readonly bookRoot?: string;
}): Promise<{ facts: Array<{ id: string; subject: string; predicate: string; object: string }> }> {
  const { getStorageDatabase } = await import("@vivy1024/novelfork-core");
  const { expandFactsOneHop } = await import("../engine/narrative-memory/facts.js");
  const storage = getStorageDatabase();
  const facts = expandFactsOneHop(storage, {
    bookId: input.bookId,
    entities: input.namedEntities,
    currentChapter: input.chapterNumber,
    maxPerEntity: 4,
    limit: 24,
  });
  return {
    facts: facts.map((fact) => ({
      id: fact.id,
      subject: fact.subject,
      predicate: fact.predicate,
      object: fact.object,
    })),
  };
}
