import { describe, expect, it } from "vitest";

import { loadWritingSkillsSync } from "./loader.js";
import {
  MAX_RECOMMENDED_WRITING_SKILLS,
  recommendWritingSkills,
} from "./recommend.js";
import type { ParsedWritingSkill, WritingSkillKind } from "./types.js";

/** 造一条最小可用的 skill；只填推荐逻辑真正会读的字段。 */
function skill(partial: {
  id: string;
  name: string;
  kind: WritingSkillKind;
  tags?: string[];
  conflictGroup?: string;
  mode?: ParsedWritingSkill["mode"];
}): ParsedWritingSkill {
  return {
    id: partial.id,
    slug: partial.id,
    name: partial.name,
    description: `${partial.name} 的说明`,
    kind: partial.kind,
    body: "正文",
    source: "builtin",
    mode: partial.mode ?? "manual",
    ...(partial.tags ? { tags: partial.tags } : {}),
    ...(partial.conflictGroup ? { conflictGroup: partial.conflictGroup } : {}),
  };
}

describe("recommendWritingSkills（合成用例）", () => {
  const fixture: ParsedWritingSkill[] = [
    skill({ id: "open-general", name: "通用-强化章节开头", kind: "opening" }),
    skill({ id: "open-weird", name: "异能志怪-强化章节开头", kind: "opening", tags: ["异能志怪"] }),
    skill({ id: "open-romance", name: "女频爱情-强化章节开头", kind: "opening", tags: ["女频爱情"] }),
    skill({ id: "pace-general", name: "通用-强化章末钩子", kind: "pacing" }),
    skill({ id: "pace-weird", name: "异能志怪-强化章末钩子", kind: "pacing", tags: ["异能志怪"] }),
    skill({ id: "prose-general", name: "通用-执行场景单元", kind: "prose" }),
    skill({ id: "revision-outline", name: "通用-大纲审阅优化闭环", kind: "revision" }),
    skill({ id: "revision-deslop", name: "通用-去AI味重写", kind: "revision" }),
    skill({ id: "plot-volume", name: "通用-设计分卷大纲", kind: "plot" }),
    skill({ id: "platform-tomato", name: "分发-番茄小说", kind: "platform" }),
    skill({ id: "platform-qidian", name: "分发-起点中文网", kind: "platform" }),
  ];

  it("题材命中簇时优先选题材版，且不混入其它题材簇", () => {
    const result = recommendWritingSkills({ genre: "玄幻" }, fixture);
    expect(result.matchedGenreCluster).toBe("异能志怪");
    const ids = result.recommended.map((item) => item.id);
    expect(ids).toContain("open-weird");
    expect(ids).toContain("pace-weird");
    expect(ids).not.toContain("open-romance");
  });

  /**
   * 真实数据回归：《主神流规则怪谈》genre=诡秘、tone=悬疑烧脑，
   * 曾因把 genre 与 tone 拼成一个字符串匹配，被「悬疑」劫持成都市悬疑簇，
   * 于是一本规则怪谈拿到整套都市悬疑技能。genre 必须优先于 tone。
   */
  it("tone 不得劫持题材：genre 优先决定题材簇", () => {
    const weirdSkills: ParsedWritingSkill[] = [
      skill({ id: "open-weird", name: "异能志怪-强化章节开头", kind: "opening", tags: ["异能志怪"] }),
      skill({ id: "open-suspense", name: "都市悬疑-强化章节开头", kind: "opening", tags: ["都市悬疑"] }),
    ];

    const weird = recommendWritingSkills({ genre: "诡秘", tone: "悬疑烧脑" }, weirdSkills);
    expect(weird.matchedGenreCluster).toBe("异能志怪");
    expect(weird.recommended.map((item) => item.id)).toContain("open-weird");
    expect(weird.recommended.map((item) => item.id)).not.toContain("open-suspense");

    // 玄幻同理：基调带「悬疑」不改变题材归属
    expect(recommendWritingSkills({ genre: "玄幻", tone: "悬疑烧脑" }, weirdSkills).matchedGenreCluster)
      .toBe("异能志怪");
    // genre 本身就是悬疑时才走都市悬疑
    expect(recommendWritingSkills({ genre: "悬疑", tone: "热血爽文" }, weirdSkills).matchedGenreCluster)
      .toBe("都市悬疑");
  });

  it("genre 定不出簇时才用 tone 兜底", () => {
    const fallback = recommendWritingSkills({ genre: "蒸汽朋克飞艇冒险", tone: "悬疑烧脑" }, fixture);
    expect(fallback.matchedGenreCluster).toBe("都市悬疑");
    expect(recommendWritingSkills({ tone: "悬疑烧脑" }, fixture).matchedGenreCluster).toBe("都市悬疑");
  });

  it("题材没命中任何簇时回落通用能力位", () => {
    const result = recommendWritingSkills({ genre: "蒸汽朋克飞艇冒险" }, fixture);
    expect(result.matchedGenreCluster).toBeNull();
    const ids = result.recommended.map((item) => item.id);
    expect(ids).toContain("open-general");
    expect(ids).toContain("pace-general");
    // 未命中簇时不得把某个题材专属 skill 塞进来
    expect(ids).not.toContain("open-weird");
  });

  it("平台答案决定平台 skill；暂不确定则不推荐平台位", () => {
    expect(recommendWritingSkills({ platform: "番茄小说" }, fixture).recommended.map((item) => item.id))
      .toContain("platform-tomato");
    expect(recommendWritingSkills({ platform: "起点中文网" }, fixture).recommended.map((item) => item.id))
      .toContain("platform-qidian");
    expect(recommendWritingSkills({ platform: "暂不确定" }, fixture).recommended.some((item) => item.kind === "platform"))
      .toBe(false);
  });

  it("AI 味收紧时补去 AI 味 skill，而不是大纲审阅", () => {
    const strict = recommendWritingSkills({ aiTasteLevel: "零容忍（必须过朱雀检测）" }, fixture);
    const ids = strict.recommended.map((item) => item.id);
    expect(ids).toContain("revision-deslop");
    expect(ids).not.toContain("revision-outline");

    const relaxed = recommendWritingSkills({ aiTasteLevel: "不在意" }, fixture);
    expect(relaxed.recommended.some((item) => item.kind === "revision")).toBe(false);
  });

  it("只有重度题材才补情节/结构 skill", () => {
    expect(recommendWritingSkills({ complexity: "heavy" }, fixture).recommended.map((item) => item.id))
      .toContain("plot-volume");
    expect(recommendWritingSkills({ complexity: "light" }, fixture).recommended.some((item) => item.kind === "plot"))
      .toBe(false);
  });

  it("同 conflictGroup 只保留分数最高的一条，落选项记账", () => {
    const conflicting: ParsedWritingSkill[] = [
      skill({ id: "open-a", name: "通用-强化章节开头", kind: "opening", conflictGroup: "chapter-shape" }),
      skill({ id: "pace-a", name: "通用-强化章末钩子", kind: "pacing", conflictGroup: "chapter-shape" }),
    ];
    const result = recommendWritingSkills({}, conflicting);
    expect(result.recommended.map((item) => item.id)).toEqual(["open-a"]);
    expect(result.droppedByConflict).toEqual(["pace-a"]);
  });

  it("mode=always 的 skill 不进推荐（无需显式启用）", () => {
    const withAlways = [
      ...fixture,
      skill({ id: "always-one", name: "通用-常驻规则", kind: "workflow", mode: "always" }),
    ];
    const result = recommendWritingSkills({}, withAlways);
    expect(result.recommended.some((item) => item.id === "always-one")).toBe(false);
    expect(result.consideredCount).toBe(fixture.length);
  });

  it("每条推荐都带非空 reason，且不超过上限", () => {
    const result = recommendWritingSkills({
      genre: "玄幻",
      platform: "番茄小说",
      complexity: "heavy",
      aiTasteLevel: "零容忍（必须过朱雀检测）",
    }, fixture);
    expect(result.recommended.length).toBeLessThanOrEqual(MAX_RECOMMENDED_WRITING_SKILLS);
    for (const item of result.recommended) {
      expect(item.reason.trim().length).toBeGreaterThan(0);
    }
  });

  it("空答案也能给出可用的基础能力位，不抛错", () => {
    const result = recommendWritingSkills({}, fixture);
    expect(result.recommended.length).toBeGreaterThan(0);
    expect(result.recommended.map((item) => item.kind)).toContain("opening");
  });
});

/**
 * 真实资产用例：只按合成 fixture 验证会漏掉「372 份真实 SKILL.md 里挑出的
 * 那条名不副实」这类问题（例如 prose 位曾选中「创建小说正文」而非文笔类）。
 */
describe("recommendWritingSkills（真实内置 skills）", () => {
  const realSkills = loadWritingSkillsSync();

  it("能加载到内置 skills 作为推荐池", () => {
    expect(realSkills.length).toBeGreaterThan(100);
  });

  it("玄幻+番茄+重度+零容忍：推荐名称与 reason 语义一致", () => {
    const result = recommendWritingSkills({
      genre: "玄幻",
      tone: "热血爽文",
      platform: "番茄小说",
      complexity: "heavy",
      aiTasteLevel: "零容忍（必须过朱雀检测）",
    }, realSkills);

    expect(result.matchedGenreCluster).toBe("异能志怪");
    const byKind = new Map(result.recommended.map((item) => [item.kind, item]));
    expect(byKind.get("opening")?.name).toContain("强化章节开头");
    expect(byKind.get("pacing")?.name).toContain("强化章末钩子");
    expect(byKind.get("platform")?.name).toContain("番茄");
    // reason 说的是「去 AI 味复核」，挑出来的就必须是去 AI 味 skill
    expect(byKind.get("revision")?.name).toContain("去AI味");
    expect(result.recommended.length).toBeLessThanOrEqual(MAX_RECOMMENDED_WRITING_SKILLS);
  });

  it("未知题材回落通用版，不串到某个具体题材", () => {
    const result = recommendWritingSkills({ genre: "蒸汽朋克飞艇冒险", platform: "七猫小说" }, realSkills);
    expect(result.matchedGenreCluster).toBeNull();
    const opening = result.recommended.find((item) => item.kind === "opening");
    expect(opening?.name).toContain("通用");
    expect(result.recommended.find((item) => item.kind === "platform")?.name).toContain("七猫");
  });

  it("不同题材答案会得到不同的推荐组合", () => {
    const weird = recommendWritingSkills({ genre: "玄幻" }, realSkills);
    const romance = recommendWritingSkills({ genre: "言情" }, realSkills);
    expect(weird.matchedGenreCluster).toBe("异能志怪");
    expect(romance.matchedGenreCluster).toBe("女频爱情");
    expect(weird.recommended.map((item) => item.id)).not.toEqual(romance.recommended.map((item) => item.id));
  });
});
