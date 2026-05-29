/**
 * scene.spec handler — 生成结构化写作蓝图（Scene Spec）。
 *
 * 包含角色、地点、冲突、情绪、结果等约束，是调用 pipeline.write 的硬前置条件。
 * 当前为占位实现：从输入数据中提取/推断，后续再接 LLM。
 */

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
  scenes: SceneSpecScene[];
  constraints: string[];
}

export interface SceneSpecInput {
  bookId: string;
  chapterNumber: number;
  userDirectives: string;
  cockpitSnapshot?: Record<string, unknown>;
  jingweiBrief?: Record<string, unknown>;
}

export interface SceneSpecSuccess {
  ok: true;
  summary: string;
  data: { sceneSpec: SceneSpec };
}

export interface SceneSpecFailure {
  ok: false;
  error: string;
  summary: string;
}

export type SceneSpecResult = SceneSpecSuccess | SceneSpecFailure;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractCharacters(jingweiBrief?: Record<string, unknown>): string[] {
  if (!jingweiBrief) return [];
  // Try to extract character names from coreBrief items
  const coreBrief = jingweiBrief.coreBrief as Array<{ title?: string; sectionKey?: string }> | undefined;
  if (!Array.isArray(coreBrief)) return [];
  return coreBrief
    .filter((item) => item.sectionKey === "character" || item.sectionKey === "characters")
    .map((item) => item.title ?? "")
    .filter(Boolean);
}

function extractWordTarget(cockpitSnapshot?: Record<string, unknown>): number {
  if (!cockpitSnapshot) return 3000;
  const bookConfig = cockpitSnapshot.bookConfig as { chapterWordCount?: number } | undefined;
  return bookConfig?.chapterWordCount ?? 3000;
}

function extractOpenHooks(cockpitSnapshot?: Record<string, unknown>): string[] {
  if (!cockpitSnapshot) return [];
  const hooks = cockpitSnapshot.openHooks as Array<{ description?: string; title?: string }> | undefined;
  if (!Array.isArray(hooks)) return [];
  return hooks.map((h) => h.description ?? h.title ?? "").filter(Boolean);
}

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * 生成结构化写作蓝图（Scene Spec）。
 *
 * 占位实现：从 cockpitSnapshot 和 jingweiBrief 中提取信息组装 SceneSpec。
 * 后续将接入 LLM 进行智能规划。
 */
export async function handleSceneSpec(input: SceneSpecInput): Promise<SceneSpecResult> {
  const { bookId, chapterNumber, userDirectives, cockpitSnapshot, jingweiBrief } = input;

  // 基本校验
  if (!bookId || !chapterNumber || !userDirectives) {
    return {
      ok: false,
      error: "missing-required-fields",
      summary: "缺少必填字段：bookId、chapterNumber、userDirectives 均为必填。",
    };
  }

  // 从输入中提取信息
  const characters = extractCharacters(jingweiBrief);
  const wordTarget = extractWordTarget(cockpitSnapshot);
  const openHooks = extractOpenHooks(cockpitSnapshot);

  // 如果没有足够信息生成有意义的 spec，返回失败
  if (!userDirectives.trim()) {
    return {
      ok: false,
      error: "empty-directives",
      summary: "userDirectives 为空，无法生成写作蓝图。请提供本章写作方向/意图。",
    };
  }

  // 组装 SceneSpec（占位逻辑：基于输入推断单场景）
  const scene: SceneSpecScene = {
    characters: characters.length > 0 ? characters.slice(0, 5) : ["主角"],
    location: "待定",
    conflict: userDirectives.slice(0, 100),
    mood: "待定",
    outcome: "待定",
    hooks_used: openHooks.slice(0, 3),
    hooks_planted: [],
  };

  const sceneSpec: SceneSpec = {
    chapter: chapterNumber,
    title: `第${chapterNumber}章`,
    wordTarget,
    scenes: [scene],
    constraints: [
      `用户指示：${userDirectives}`,
      `目标字数：${wordTarget}`,
    ],
  };

  // H4 硬约束校验：scenes 不能为空，每个 scene 必须有 characters/location/conflict/outcome
  if (sceneSpec.scenes.length === 0) {
    return {
      ok: false,
      error: "empty-scenes",
      summary: "生成的 Scene Spec 中 scenes 为空，无法作为写作蓝图。",
    };
  }

  for (let i = 0; i < sceneSpec.scenes.length; i++) {
    const s = sceneSpec.scenes[i];
    const missing: string[] = [];
    if (!s.characters || s.characters.length === 0) missing.push("characters");
    if (!s.location) missing.push("location");
    if (!s.conflict) missing.push("conflict");
    if (!s.outcome) missing.push("outcome");
    if (missing.length > 0) {
      return {
        ok: false,
        error: "incomplete-scene",
        summary: `场景 ${i + 1} 缺少必要字段：${missing.join("、")}。请补充相关信息后重试。`,
      };
    }
  }

  return {
    ok: true,
    summary: `已生成第${chapterNumber}章写作蓝图：${sceneSpec.scenes.length} 个场景，目标 ${wordTarget} 字。`,
    data: { sceneSpec },
  };
}
