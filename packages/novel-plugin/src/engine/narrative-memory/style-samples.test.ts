import { describe, expect, it } from "vitest";

import type { SceneSpec } from "../../handlers/scene-spec-handler.js";
import { createStylePreset, type StylePreset } from "../writing-layers/style-preset.js";
import type { NarrativeScene } from "./scene-store.js";
import { resolveStyleSceneTypes, selectStyleSamples, type StyleSceneType } from "./style-samples.js";

type Sample = StylePreset["sources"][number]["samples"][number];

function sample(id: string, sceneType: StyleSceneType, overrides: Partial<Sample> = {}): Sample {
  return {
    id,
    sceneType,
    text: `${id} 的范文正文。`,
    evidence: "原文位置",
    transfer: "transferable",
    status: "confirmed",
    ...overrides,
  };
}

function presetWith(...sources: Array<{ id: string; title: string; samples: Sample[] }>): StylePreset {
  const preset = createStylePreset();
  preset.sources = sources.map((source) => ({ ...source, rules: [] }));
  return preset;
}

function scene(overrides: Partial<NarrativeScene>): NarrativeScene {
  return {
    id: "scene-1",
    bookId: "book-1",
    chapterNumber: 12,
    ordinal: 1,
    title: "第 1 场",
    summary: "",
    function: "advance",
    wordCount: 0,
    conflict: "",
    mood: "",
    outcome: "",
    characters: [],
    hooksUsed: [],
    hooksPlanted: [],
    layer: "dynamic",
    status: "needs-review",
    source: "manual",
    confidence: 1,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const actionSpec: SceneSpec = {
  chapter: 12,
  title: "夜袭",
  wordTarget: 3000,
  scenes: [{ characters: ["韩立"], location: "山谷", conflict: "韩立与刺客交手", mood: "紧张", outcome: "突围成功", hooks_used: [], hooks_planted: [] }],
  constraints: [],
};

describe("resolveStyleSceneTypes", () => {
  it("优先读本章 narrative_scene 的功能与文字，其次写作蓝图，再次章节规划", () => {
    const fromScenes = resolveStyleSceneTypes({
      chapterNumber: 12,
      chapterScenes: [scene({ function: "relationship", title: "师徒夜谈" })],
      sceneSpec: actionSpec,
      planText: "赶路过渡",
    });
    expect(fromScenes.source).toBe("narrative-scene");
    expect(fromScenes.types).toEqual(["dialogue", "interiority"]);
    expect(fromScenes.evidence.join("\n")).toContain("relationship");

    const fromSpec = resolveStyleSceneTypes({ chapterNumber: 12, chapterScenes: [], sceneSpec: actionSpec, planText: "赶路过渡" });
    expect(fromSpec.source).toBe("scene-spec");
    expect(fromSpec.types[0]).toBe("action");
    expect(fromSpec.attempts[0]).toContain("还没有场景记录");

    const fromPlan = resolveStyleSceneTypes({ chapterNumber: 12, planText: "主角与长老谈判，随后启程赶路" });
    expect(fromPlan.source).toBe("chapter-plan");
    expect(fromPlan.types).toEqual(["transition", "dialogue"]);
  });

  it("忽略已驳回的场景，默认的 advance 功能不产生写法类型", () => {
    const result = resolveStyleSceneTypes({
      chapterNumber: 12,
      chapterScenes: [scene({ function: "climax", status: "rejected" }), scene({ id: "s2", function: "advance" })],
    });
    expect(result.source).toBe("none");
    expect(result.types).toEqual([]);
    expect(result.attempts[0]).toContain("看不出写法类型");
    expect(result.explanation?.whatHappened).toContain("通用范文");
    expect(result.explanation?.suggestedAction).toBeTruthy();
  });
});

describe("selectStyleSamples", () => {
  const preset = presetWith(
    { id: "a", title: "来源甲", samples: [
      sample("a-dialogue", "dialogue", { transfer: "source-only" }),
      sample("a-general", "general"),
      sample("a-action", "action"),
      sample("a-pending", "dialogue", { status: "needs-review" }),
    ] },
    { id: "b", title: "来源乙", samples: [
      sample("b-dialogue", "dialogue"),
      sample("b-interiority", "interiority"),
      sample("b-description", "description"),
    ] },
  );

  it("只选已确认范文，按场景类型轮流取，同类里可迁移优先，作品专属标注来源", () => {
    const sceneTypes = resolveStyleSceneTypes({ chapterScenes: [scene({ function: "relationship" })] });
    const result = selectStyleSamples({ preset, sceneTypes });

    expect(result.selected.map((item) => item.key)).toEqual(["b/b-dialogue", "b/b-interiority", "a/a-dialogue", "a/a-general"]);
    expect(result.selected.some((item) => item.key === "a/a-pending")).toBe(false);
    expect(result.selected.map((item) => item.match)).toEqual(["scene-type", "scene-type", "scene-type", "general"]);
    const sourceOnly = result.selected.find((item) => item.transfer === "source-only")!;
    expect(sourceOnly.reason).toContain("作品专属");
    expect(sourceOnly.reason).toContain("来源甲");
    expect(result.diagnostics.unconfirmedSamples).toBe(1);
    expect(result.diagnostics.selected.every((item) => !("text" in item))).toBe(true);
  });

  it("同样输入永远同样输出", () => {
    const sceneTypes = resolveStyleSceneTypes({ sceneSpec: actionSpec });
    const first = selectStyleSamples({ preset, sceneTypes, availableTokens: 40 });
    const second = selectStyleSamples({ preset, sceneTypes, availableTokens: 40 });
    expect(second).toEqual(first);
  });

  it("取不到场景类型时退化为通用范文并补足两段，诊断写明原因", () => {
    const sceneTypes = resolveStyleSceneTypes({});
    const result = selectStyleSamples({ preset, sceneTypes });
    expect(result.selected.map((item) => item.key)).toEqual(["a/a-general", "b/b-dialogue"]);
    expect(result.selected.map((item) => item.match)).toEqual(["general", "fallback"]);
    expect(result.diagnostics.sceneTypes.source).toBe("none");
    expect(result.explanations[0]?.whatHappened).toContain("没能判断本章的场景类型");
  });

  it("超预算时按排名依次裁剪并逐条记录，超过 4 段按段数上限记录", () => {
    const sceneTypes = resolveStyleSceneTypes({ chapterScenes: [scene({ function: "relationship" })] });
    const tokensEach = selectStyleSamples({ preset, sceneTypes }).selected[0]!.estimatedTokens;
    const result = selectStyleSamples({ preset, sceneTypes, availableTokens: tokensEach * 2 });
    expect(result.selected).toHaveLength(2);
    expect(result.trimmed.filter((item) => item.kind === "token-budget").map((item) => item.rank)).toEqual([3, 4]);
    expect(result.diagnostics.budget).toEqual({ availableTokens: tokensEach * 2, usedTokens: tokensEach * 2 });
    expect(result.explanations.some((item) => item.whatHappened.includes("裁掉 2 段范文"))).toBe(true);

    const many = presetWith({ id: "c", title: "来源丙", samples: ["1", "2", "3", "4", "5"].map((id) => sample(`d${id}`, "dialogue")) });
    const capped = selectStyleSamples({ preset: many, sceneTypes: resolveStyleSceneTypes({ planText: "两人对峙" }) });
    expect(capped.selected).toHaveLength(4);
    expect(capped.trimmed).toEqual([expect.objectContaining({ key: "c/d5", kind: "count-cap" })]);
  });

  it("需要的类型没有范文时改用通用范文并提醒补充；只有待审范文时不注入并提醒审阅", () => {
    const onlyGeneral = presetWith({ id: "g", title: "来源丁", samples: [sample("g1", "general"), sample("g2", "action")] });
    const result = selectStyleSamples({ preset: onlyGeneral, sceneTypes: resolveStyleSceneTypes({ planText: "两人对峙" }) });
    expect(result.selected.map((item) => item.key)).toEqual(["g/g1", "g/g2"]);
    expect(result.explanations[0]?.whatHappened).toContain("没有这类已确认范文");

    const pending = presetWith({ id: "p", title: "来源戊", samples: [sample("p1", "dialogue", { status: "needs-review" })] });
    const none = selectStyleSamples({ preset: pending, sceneTypes: resolveStyleSceneTypes({ planText: "两人对峙" }) });
    expect(none.selected).toEqual([]);
    expect(none.explanations[0]?.whatHappened).toContain("尚未确认");
  });
});
