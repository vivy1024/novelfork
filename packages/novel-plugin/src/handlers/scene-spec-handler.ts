/**
 * scene.spec handler — 校验当前 Runtime Agent 提交的结构化写作蓝图（Scene Spec）。
 *
 * 蓝图必须由外层 Runtime Agent 显式提交；本工具只做确定性校验，不隐藏调用模型。
 */

import { checkBeatBudget, parseBeatBudget, type BeatBudgetItem, type BeatBudgetReport } from "./beat-budget.js";
import {
  EMPTY_WRITING_SKILL_CONSTRAINT_DIGEST,
  toSceneSpecConstraintLines,
  type WritingSkillConstraintDigest,
} from "../engine/writing-skills/compliance.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SceneSpecScene {
  characters: string[];
  location: string;
  conflict: string;
  mood: string;
  outcome: string;
  hooks_used: string[];
  hooks_planted: string[];
}

export interface SceneSpec {
  chapter: number;
  title: string;
  wordTarget: number;
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
}

export interface SceneSpecSuccess {
  ok: true;
  summary: string;
  data: {
    sceneSpec: SceneSpec;
    /** 情节点预算校验结果；未提供 beatBudget 时也会给，用于提示未拆点。 */
    beatBudget?: BeatBudgetReport;
    /**
     * 已启用 Writing Skills 的硬性约束摘要，与出口合规校验同源。
     * 已并入 sceneSpec.constraints，这里另给结构化版本便于渲染与下游复用。
     */
    writingSkillConstraints?: WritingSkillConstraintDigest;
  };
}

export interface SceneSpecFailure {
  ok: false;
  error: string;
  summary: string;
}

export type SceneSpecResult = SceneSpecSuccess | SceneSpecFailure;

function parseSceneSpecFromLLM(raw: string, chapterNumber: number, wordTarget: number): SceneSpec | null {
  try {
    // 提取 JSON（可能被 markdown code block 包裹）
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[1]!.trim());

    // 校验基本结构
    if (!parsed.scenes || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) return null;

    const beatBudget = parseBeatBudget(parsed.beatBudget);
    return {
      chapter: parsed.chapter ?? chapterNumber,
      title: parsed.title ?? `第${chapterNumber}章`,
      wordTarget: parsed.wordTarget ?? wordTarget,
      ...(beatBudget.length > 0 ? { beatBudget } : {}),
      scenes: parsed.scenes.map((s: any) => ({
        characters: Array.isArray(s.characters) ? s.characters : ["主角"],
        location: s.location ?? "待定",
        conflict: s.conflict ?? "待定",
        mood: s.mood ?? "待定",
        outcome: s.outcome ?? "待定",
        hooks_used: Array.isArray(s.hooks_used) ? s.hooks_used : [],
        hooks_planted: Array.isArray(s.hooks_planted) ? s.hooks_planted : [],
      })),
      constraints: Array.isArray(parsed.constraints) ? parsed.constraints : [],
    };
  } catch {
    return null;
  }
}

function parseSceneSpecValue(value: unknown, chapterNumber: number, wordTarget: number): SceneSpec | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return parseSceneSpecFromLLM(JSON.stringify(value), chapterNumber, wordTarget);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractWordTarget(cockpitSnapshot?: Record<string, unknown>): number {
  if (!cockpitSnapshot) return 3000;
  const bookConfig = cockpitSnapshot.bookConfig as { chapterWordCount?: number } | undefined;
  return bookConfig?.chapterWordCount ?? 3000;
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

  const wordTarget = extractWordTarget(enrichedCockpit ?? cockpitSnapshot);
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
  const skillNote = writingSkillConstraints.items.length > 0
    ? ` 已并入 ${writingSkillConstraints.items.length} 条 Writing Skills 可机器校验约束（其中 ${writingSkillConstraints.blockingCount} 条硬性，保存前会逐条校验）。`
    : "";
  return {
    ok: true,
    summary: `已生成第${chapterNumber}章写作蓝图（${source}）：${sceneSpec.scenes.length} 个场景，目标 ${wordTarget} 字。${budget.summary}${gateNote}${skillNote}`,
    data: {
      sceneSpec,
      beatBudget: budget,
      ...(writingSkillConstraints.items.length > 0 ? { writingSkillConstraints } : {}),
    },
  };
}
