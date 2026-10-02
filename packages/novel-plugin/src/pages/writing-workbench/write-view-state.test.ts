import { describe, expect, it } from "vitest";

import {
  buildWriteSequence,
  buildWriteViewModel,
  canStartWriting,
  planFixAction,
} from "./write-view-state";

const readyPreflight = {
  ok: true,
  chapterNumber: 47,
  resolvedDirective: "让林舟进入山门试炼，先过守门人这一关。",
  needsUserConfirm: false,
  recentChapters: [
    { number: 46, summary: "林舟抵达山门" },
    { number: 45, summary: "旧城冲突升级" },
  ],
  blockers: [],
  warningItems: [],
  currentVolume: { title: "开篇卷", goal: "立住主角动机" },
  platform: { label: "番茄小说", chapterTargetStatus: "ok" },
};

describe("buildWriteViewModel", () => {
  it("shows green light and passed checks when preflight is clean", () => {
    const model = buildWriteViewModel(readyPreflight);
    expect(model.light).toBe("green");
    expect(model.canWrite).toBe(true);
    expect(model.chapterNumber).toBe(47);
    expect(model.volumeLabel).toBe("开篇卷 · 立住主角动机");
    expect(model.platformLabel).toBe("番茄小说");
    expect(model.checks.filter((item) => item.state === "ok").map((item) => item.label))
      .toEqual(["本章指示", "近章记忆"]);
    expect(model.headline).toContain("可以开写第 47 章");
    expect(model.alreadyWritten).toBe(false);
    expect(model.wordTarget).toBe(0);
  });

  it("推荐章已落稿时标记 alreadyWritten，并带上平台目标字数", () => {
    const model = buildWriteViewModel({
      ...readyPreflight,
      chapterNumber: 46,
      formalChapterCount: 46,
      platform: { label: "番茄小说", chapterTargetStatus: "ok", recommendedChapterWords: { min: 2000, ideal: 3000, max: 4000 } },
    });
    expect(model.alreadyWritten).toBe(true);
    expect(model.wordTarget).toBe(3000);
    expect(model.formalChapterCount).toBe(46);
    expect(model.headline).toContain("已有正文");
  });

  it("turns yellow and keeps warning explanations", () => {
    const model = buildWriteViewModel({
      ...readyPreflight,
      warningItems: [{
        code: "style-disabled",
        message: "未启用文风预设。",
        kind: "advisory",
        explanation: {
          whatHappened: "本书没有启用任何文风预设。",
          whyItMatters: "语言容易向模型默认腔调漂移。",
          suggestedAction: "用 skills.write 创建并启用文风技能。",
        },
      }],
    });
    expect(model.light).toBe("yellow");
    expect(model.canWrite).toBe(true);
    const warn = model.checks.find((item) => item.code === "style-disabled");
    expect(warn?.state).toBe("warn");
    // 判据是当前项目 `.novelfork/skills/`，界面上叫「写作技能」（不露英文代号）；
    // 旧 book.json 启用字段与「文风预设」（enabledPresetIds）已下线，标签不能再指向它。
    expect(warn?.label).toBe("写作技能");
    expect(warn?.fixAction).toBe("enable-style");
    expect(warn?.explanation?.suggestedAction).toContain("skills.write");
    expect(model.headline).toContain("1 条提醒");
  });

  it("turns red and surfaces the blocking message as headline", () => {
    const model = buildWriteViewModel({
      ...readyPreflight,
      ok: false,
      blockers: [{
        code: "empty-recent-progress",
        message: "已有 3 章进度，但近章摘要为空。",
        kind: "persistent",
        explanation: {
          whatHappened: "近章记忆为空。",
          whyItMatters: "写手会自行编造前情。",
          suggestedAction: "先 memory.settle_range 回填。",
        },
      }],
      recentChapters: [],
    });
    expect(model.light).toBe("red");
    expect(model.canWrite).toBe(false);
    expect(model.headline).toContain("近章摘要为空");
    const blocker = model.checks.find((item) => item.code === "empty-recent-progress");
    expect(blocker?.state).toBe("block");
    expect(blocker?.fixAction).toBe("settle-range");
    // 有问题时不再把该项显示为 ok
    expect(model.checks.some((item) => item.code === "recent-memory-ok")).toBe(false);
  });

  it("returns an unknown placeholder before any check runs", () => {
    const model = buildWriteViewModel(null);
    expect(model.light).toBe("unknown");
    expect(model.canWrite).toBe(false);
    expect(model.checks).toEqual([]);
    expect(model.headline).toContain("尚未检查");
  });

  it("tolerates malformed diagnostics without throwing", () => {
    const model = buildWriteViewModel({
      ok: true,
      chapterNumber: "not-a-number",
      blockers: "oops",
      warningItems: [null, { code: 42 }],
      recentChapters: [{ number: "x" }],
    });
    expect(model.chapterNumber).toBe(0);
    expect(model.recentChapters).toEqual([]);
    expect(model.checks.every((item) => typeof item.label === "string")).toBe(true);
  });

  it("检查项标签不露英文代号：未登记的 code 显示「其他提醒」", () => {
    const model = buildWriteViewModel({
      ...readyPreflight,
      warningItems: [
        { code: "skills-not-acknowledged", message: "相关技能未读。" },
        { code: "audit-stale", message: "审计过期。" },
        { code: "volume-range-drift", message: "章号越界。" },
        { code: "other", message: "[设定/现状不一致] 张三：位置不一致" },
        { code: "brand-new-code", message: "新提醒。" },
      ],
    });
    const labels = model.checks.filter((item) => item.state === "warn").map((item) => item.label);
    expect(labels).toEqual(["相关写作技能未读", "审计已过期", "章号不在本卷", "其他提醒", "其他提醒"]);
    expect(labels.join("")).not.toMatch(/[a-z]{3,}/u);
  });
});

/**
 * 起书接线（W2）：新书没有焦点与大纲时，写作侧栏给引导而不是红色报错。
 * 引导分两种，取决于作品总览还会不会显示建书十一问。
 */
describe("buildWriteViewModel 起书引导", () => {
  const newBookPreflight = {
    ok: false,
    chapterNumber: 1,
    formalChapterCount: 0,
    resolvedDirective: null,
    needsUserConfirm: false,
    currentFocus: { status: "missing", content: null, reason: "经纬里没有当前焦点" },
    recentChapters: [],
    blockers: [{
      code: "missing-directive",
      message: "无用户本章指示，且作品基础中无可用当前焦点/大纲，无法确定写章方向。",
      explanation: { whatHappened: "没有本章目标。", whyItMatters: "会跑偏。", suggestedAction: "给一句本章目标。" },
    }],
    warningItems: [{ code: "style-disabled", message: "未启用写作技能。" }],
  };

  it("还没答十一问 → 「先回答建书十一问」，不再是红灯报错", () => {
    const model = buildWriteViewModel(newBookPreflight, { newBookGuidePending: true });
    expect(model.onboarding?.kind).toBe("answer-guide");
    expect(model.onboarding?.title).toBe("先回答建书十一问");
    expect(model.light).not.toBe("red");
    expect(model.headline).toBe("先回答建书十一问");
    expect(model.headline).not.toContain("无法确定写章方向");
    // 引导卡已经说明缺方向，清单里不再重复一条 ×；其它提醒照常保留。
    expect(model.checks.some((item) => item.code === "missing-directive")).toBe(false);
    expect(model.checks.some((item) => item.state === "block")).toBe(false);
    expect(model.checks.find((item) => item.code === "style-disabled")?.state).toBe("warn");
    expect(model.canWrite).toBe(false);
  });

  it("答过十一问但焦点仍空 → 「补全本章焦点」", () => {
    const model = buildWriteViewModel(newBookPreflight, { newBookGuidePending: false });
    expect(model.onboarding?.kind).toBe("fill-focus");
    expect(model.onboarding?.title).toBe("补全本章焦点");
    expect(model.headline).toBe("补全本章焦点");
  });

  it("真有其它阻断（书籍读不到等）时照常红灯报错，不给引导", () => {
    const model = buildWriteViewModel({
      ...newBookPreflight,
      blockers: [
        ...newBookPreflight.blockers,
        { code: "book-not-found", message: "无法读取书籍驾驶舱：book.json 损坏" },
      ],
    }, { newBookGuidePending: true });
    expect(model.onboarding).toBeNull();
    expect(model.light).toBe("red");
    expect(model.checks.some((item) => item.code === "missing-directive" && item.state === "block")).toBe(true);
  });

  it("焦点可用时缺指示不是新书问题，不给引导", () => {
    const model = buildWriteViewModel({
      ...newBookPreflight,
      currentFocus: { status: "available", content: "林舟进山门" },
    }, { newBookGuidePending: true });
    expect(model.onboarding).toBeNull();
    expect(model.light).toBe("red");
  });

  it("引导状态下写一句够长的本章指示即可开写，太短仍拦", () => {
    const model = buildWriteViewModel(newBookPreflight, { newBookGuidePending: true });
    expect(canStartWriting({ model, directiveDraft: "让林舟在雨夜的旧站台第一次遇见苏晚", acceptFocusDefault: false }).ok).toBe(true);
    const short = canStartWriting({ model, directiveDraft: "开篇", acceptFocusDefault: false });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.reason).toContain("8 字");
    const empty = canStartWriting({ model, directiveDraft: "", acceptFocusDefault: false });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.reason).not.toContain("无法确定写章方向");
  });
});

describe("planFixAction", () => {
  it("routes settle-range through the narrator so permission confirmation still applies", () => {
    const plan = planFixAction("settle-range", { chapterNumber: 47, formalChapterCount: 46 });
    expect(plan.kind).toBe("narrator");
    expect(plan.label).toBe("补结算历史章节");
    expect(plan.message).toContain("memory.settle_range");
    expect(plan.message).toContain("第 1–46 章");
  });

  it("asks the narrator for a volume draft instead of writing jingwei directly", () => {
    const plan = planFixAction("set-volume", { chapterNumber: 5 });
    expect(plan.kind).toBe("narrator");
    expect(plan.message).toContain("outline.volume(action=suggest)");
  });

  it("never plans a silent write from the frontend", () => {
    const writeActions = ["settle-range", "set-volume"] as const;
    for (const action of writeActions) {
      expect(planFixAction(action, { chapterNumber: 3 }).kind).toBe("narrator");
    }
  });

  it("routes review actions to sidebar views", () => {
    // 待确认事件与伏笔账本都在故事推进侧栏（伏笔不在工具区，就地渲染）
    expect(planFixAction("review-pending", { chapterNumber: 5 }).view).toBe("storyline");
    expect(planFixAction("review-hooks", { chapterNumber: 5 }).view).toBe("storyline");
  });

  /**
   * 下面两条守护的是本次修复的核心：一键修的落点必须与 preflight 的判据同源。
   * 落错了，作者点按钮、改完东西、重跑 preflight 会发现问题还在。
   */
  it("enable-style 打开「技能文风」视图的写作技能面板（判据是项目 Skill 文件）", () => {
    const plan = planFixAction("enable-style", { chapterNumber: 5 });
    expect(plan.kind).toBe("view");
    expect(plan.view).toBe("skills-style");
    expect(plan.label).toBe("启用写作技能");
    // 写作设置里已没有写作技能分区，不能再往那边跳
    expect(plan.settingsSection).toBeUndefined();
  });

  it("open-focus 留在写作视图填写创作罗盘，而不是跳去 story/current_focus.md 或卷纲", () => {
    const plan = planFixAction("open-focus", { chapterNumber: 5 });
    expect(plan.kind).toBe("write-compass");
    expect(plan.label).toBe("填写创作罗盘");
    expect(JSON.stringify(plan)).not.toContain("current_focus.md");
    expect(plan.loreCategory).toBeUndefined();
  });

  it("三个 directive 类 code 都映射到 open-focus，且都落在经纬面板", () => {
    for (const code of ["missing-directive", "short-directive", "focus-default-only"]) {
      // 焦点可用：这里测的是 code → 修复动作的映射，不是新书引导。
      const model = buildWriteViewModel({
        ...readyPreflight,
        ok: false,
        currentFocus: { status: "available", content: "林舟进山门" },
        blockers: [{ code, message: `${code} 触发` }],
      });
      const check = model.checks.find((item) => item.code === code);
      expect(check?.fixAction).toBe("open-focus");
      expect(planFixAction(check!.fixAction!, { chapterNumber: 5 }).kind).toBe("write-compass");
    }
  });
});

describe("canStartWriting", () => {
  const model = buildWriteViewModel(readyPreflight);

  it("blocks when preflight is not ready", () => {
    const blocked = buildWriteViewModel({ ...readyPreflight, ok: false, blockers: [{ code: "empty-recent-progress", message: "近章记忆为空" }] });
    const result = canStartWriting({ model: blocked, directiveDraft: "写一段很长的本章目标", acceptFocusDefault: false });
    expect(result.ok).toBe(false);
  });

  it("allows the resolved directive when the draft is empty", () => {
    expect(canStartWriting({ model, directiveDraft: "", acceptFocusDefault: false }).ok).toBe(true);
  });

  it("requires confirmation when only a focus default exists", () => {
    const focusOnly = buildWriteViewModel({ ...readyPreflight, needsUserConfirm: true });
    expect(canStartWriting({ model: focusOnly, directiveDraft: "", acceptFocusDefault: false }).ok).toBe(false);
    expect(canStartWriting({ model: focusOnly, directiveDraft: "", acceptFocusDefault: true }).ok).toBe(true);
  });

  it("rejects a too-short draft", () => {
    const result = canStartWriting({ model, directiveDraft: "继续", acceptFocusDefault: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("8 字");
  });
});

describe("buildWriteSequence", () => {
  it("chains scene.spec then pipeline.write and forwards the preflight", () => {
    const steps = buildWriteSequence({
      chapterNumber: 47,
      directive: "让林舟进入山门试炼。",
      acceptFocusDefault: true,
      preflight: readyPreflight,
    });
    expect(steps.map((step) => step.tool)).toEqual(["scene.spec", "pipeline.write"]);
    expect(steps[0]?.input).toMatchObject({ chapterNumber: 47, acceptFocusDefault: true });
    expect(steps[0]?.input.writePreflight).toBeTruthy();
    expect(steps[0]?.input.bookId).toBeUndefined();
    expect(steps[1]?.input).toMatchObject({ autoRevise: true });
  });
});
