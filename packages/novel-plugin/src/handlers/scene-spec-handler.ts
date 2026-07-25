/**
 * scene.spec handler — 生成结构化写作蓝图（Scene Spec）。
 *
 * 包含角色、地点、冲突、情绪、结果等约束，是调用 pipeline.write 的硬前置条件。
 * 优先使用宿主注入的文本生成能力；宿主未提供时 fallback 到从输入推断。
 */

import type { RuntimeTextGenerator } from "@vivy1024/novelfork-core/plugins";

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
  /** 仅有 focus 默认目标时是否接受继续 */
  acceptFocusDefault?: boolean;
  /** 仅测试/迁移：跳过 empty-recent-progress 硬门 */
  skipContextGate?: boolean;
  /** write.preflight 结果（可选；传入可复用并参与硬门） */
  writePreflight?: Record<string, unknown>;
  cockpitSnapshot?: Record<string, unknown>;
  /** 兼容旧字段；新调用优先 loreBrief */
  jingweiBrief?: Record<string, unknown>;
  loreBrief?: Record<string, unknown>;
  memoryContext?: Record<string, unknown>;
  /** Trusted book root for preflight gate */
  bookRoot?: string;
  /** 宿主注入的受控文本生成器 */
  generateText?: RuntimeTextGenerator;
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

// ─── LLM Prompt ──────────────────────────────────────────────────────────────

const SCENE_SPEC_SYSTEM_PROMPT = `你根据精确事实与用户一句本章指示，生成结构化写作蓝图（Scene Spec）。

只输出严格 JSON：
{
  "chapter": 章节号,
  "title": "章节标题",
  "wordTarget": 目标字数,
  "scenes": [
    {
      "characters": ["出场角色列表"],
      "location": "场景地点",
      "conflict": "本场景核心冲突/张力",
      "mood": "情绪基调变化（如：紧张→释然）",
      "outcome": "场景结果/转折",
      "hooks_used": ["本场景回收的伏笔"],
      "hooks_planted": ["本场景埋设的新伏笔"]
    }
  ],
  "constraints": ["来自事实与用户指示的硬约束，禁止文论"]
}

规则：
- scenes 至少 1 个，最多 4 个
- 每个 scene 的 characters 至少 1 人
- location 必须具体（不能是"某处"）
- conflict 必须明确（不能是"待定"）
- outcome 必须有方向性（不能是"待定"）
- mood 用"起始→结束"格式
- 只根据用户指示 + 提供的进度/设定/记忆事实规划，禁止编造前文与写作理论
- constraints 只写可执行事实约束，不要写传播力/思想核/文风大道理
- 只输出 JSON，不要其他文字`;

function buildSceneSpecUserPrompt(input: SceneSpecInput): string {
  const parts: string[] = [];
  parts.push(`## 写作意图\n${input.userDirectives}`);
  parts.push(`\n## 章节信息\n- 章节号：${input.chapterNumber}`);

  if (input.cockpitSnapshot) {
    const snapshot = input.cockpitSnapshot;
    if (snapshot.progress) parts.push(`- 当前进度：${JSON.stringify(snapshot.progress)}`);
    const hooks = snapshot.openHooks as Array<{ description?: string }> | undefined;
    if (Array.isArray(hooks) && hooks.length > 0) {
      parts.push(`\n## 活跃伏笔\n${hooks.slice(0, 5).map((h) => `- ${h.description ?? ""}`).join("\n")}`);
    }
  }

  const loreBrief = input.loreBrief ?? input.jingweiBrief;
  if (loreBrief) {
    const coreBrief = loreBrief.coreBrief as Array<{ title?: string; sectionName?: string; summaryMd?: string }> | undefined;
    if (Array.isArray(coreBrief) && coreBrief.length > 0) {
      parts.push(`\n## Lore 静态设定核心包\n${coreBrief.slice(0, 8).map((item) => `- 【${item.sectionName ?? ""}】${item.title ?? ""}：${(item.summaryMd ?? "").slice(0, 80)}`).join("\n")}`);
    }
  }

  if (input.memoryContext) {
    const diagnostics = input.memoryContext.diagnostics as { warnings?: string[]; totalEstimatedTokens?: number } | undefined;
    const sections = input.memoryContext.sections as Record<string, string> | undefined;
    const memoryLines = Object.entries(sections ?? {})
      .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
      .slice(0, 6)
      .map(([key, value]) => `### ${key}\n${value.slice(0, 600)}`);
    if (memoryLines.length > 0) parts.push(`\n## Narrative Memory 动态上下文\n${memoryLines.join("\n")}`);
    if (diagnostics?.warnings?.length) parts.push(`\n## 召回警告\n${diagnostics.warnings.slice(0, 5).map((item) => `- ${item}`).join("\n")}`);
  }

  parts.push(`\n请生成第${input.chapterNumber}章的 Scene Spec JSON。`);
  return parts.join("\n");
}

function parseSceneSpecFromLLM(raw: string, chapterNumber: number, wordTarget: number): SceneSpec | null {
  try {
    // 提取 JSON（可能被 markdown code block 包裹）
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[1]!.trim());

    // 校验基本结构
    if (!parsed.scenes || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) return null;

    return {
      chapter: parsed.chapter ?? chapterNumber,
      title: parsed.title ?? `第${chapterNumber}章`,
      wordTarget: parsed.wordTarget ?? wordTarget,
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractCharacters(loreBrief?: Record<string, unknown>): string[] {
  if (!loreBrief) return [];
  const coreBrief = loreBrief.coreBrief as Array<{ title?: string; sectionKey?: string; category?: string }> | undefined;
  if (!Array.isArray(coreBrief)) return [];
  return coreBrief
    .filter((item) => item.sectionKey === "character" || item.sectionKey === "characters" || item.sectionKey === "people" || item.category === "characters")
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

function extractMemoryConstraintLines(memoryContext?: Record<string, unknown>): string[] {
  if (!memoryContext) return [];
  const diagnostics = memoryContext.diagnostics as { warnings?: string[] } | undefined;
  const sections = memoryContext.sections as Record<string, string> | undefined;
  const sectionLines = Object.entries(sections ?? {})
    .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    .slice(0, 3)
    .map(([key, value]) => `Narrative Memory/${key}：${value.trim().slice(0, 120)}`);
  const warningLines = (diagnostics?.warnings ?? []).slice(0, 3).map((item) => `召回警告：${item}`);
  return [...sectionLines, ...warningLines];
}

function buildFallbackSpec(input: SceneSpecInput): SceneSpec {
  const characters = extractCharacters(input.loreBrief ?? input.jingweiBrief);
  const wordTarget = extractWordTarget(input.cockpitSnapshot);
  const openHooks = extractOpenHooks(input.cockpitSnapshot);
  const memoryConstraints = extractMemoryConstraintLines(input.memoryContext);

  return {
    chapter: input.chapterNumber,
    title: `第${input.chapterNumber}章`,
    wordTarget,
    scenes: [{
      characters: characters.length > 0 ? characters.slice(0, 5) : ["主角"],
      location: "待定",
      conflict: input.userDirectives.slice(0, 100),
      mood: "待定",
      outcome: "待定",
      hooks_used: openHooks.slice(0, 3),
      hooks_planted: [],
    }],
    constraints: [
      `用户指示：${input.userDirectives}`,
      `目标字数：${wordTarget}`,
      ...memoryConstraints,
    ],
  };
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
            blockers?: Array<{ code: string; message: string }>;
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

  const gatedInput: SceneSpecInput = {
    ...input,
    userDirectives: resolvedDirectives,
    cockpitSnapshot: enrichedCockpit,
  };

  const wordTarget = extractWordTarget(enrichedCockpit ?? cockpitSnapshot);
  let sceneSpec: SceneSpec | null = null;
  let usedLLM = false;

  // 尝试可信文本生成
  try {
    const generator = input.generateText;
    if (generator) {
      const userPrompt = buildSceneSpecUserPrompt(gatedInput);
      const response = await generator({
        messages: [
          { role: "system", content: SCENE_SPEC_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        maxTokens: 2000,
      });

      if (response?.text) {
        sceneSpec = parseSceneSpecFromLLM(response.text, chapterNumber, wordTarget);
        if (sceneSpec) usedLLM = true;
      }
    }
  } catch {
    // 文本生成失败，fallback 到占位逻辑
  }

  // Fallback：从输入推断
  if (!sceneSpec) {
    sceneSpec = buildFallbackSpec(gatedInput);
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

  const source = usedLLM ? "LLM 智能规划" : "输入推断（LLM 不可用）";
  return {
    ok: true,
    summary: `已生成第${chapterNumber}章写作蓝图（${source}）：${sceneSpec.scenes.length} 个场景，目标 ${wordTarget} 字。`,
    data: { sceneSpec },
  };
}
