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
          suggestedAction: "用 style.import(applyPreset=true) 导入文风。",
        },
      }],
    });
    expect(model.light).toBe("yellow");
    expect(model.canWrite).toBe(true);
    const warn = model.checks.find((item) => item.code === "style-disabled");
    expect(warn?.state).toBe("warn");
    // 判据是当前项目 `.novelfork/skills/`，界面上就叫 Writing Skills；
    // 旧 book.json 启用字段与「文风预设」（enabledPresetIds）已下线，标签不能再指向它。
    expect(warn?.label).toBe("Writing Skills");
    expect(warn?.fixAction).toBe("enable-style");
    expect(warn?.explanation?.suggestedAction).toContain("style.import");
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
    // 待确认事件在合并后的经纬工作区，伏笔看板在工具视图
    expect(planFixAction("review-pending", { chapterNumber: 5 }).view).toBe("jingwei");
    expect(planFixAction("review-hooks", { chapterNumber: 5 }).view).toBe("tools");
  });

  /**
   * 下面两条守护的是本次修复的核心：一键修的落点必须与 preflight 的判据同源。
   * 落错了，作者点按钮、改完东西、重跑 preflight 会发现问题还在。
   */
  it("enable-style 打开写作设置的 Writing Skills 分区（判据是项目 Skill 文件）", () => {
    const plan = planFixAction("enable-style", { chapterNumber: 5 });
    expect(plan.kind).toBe("settings");
    expect(plan.settingsSection).toBe("writing-skills");
    // 「工具」侧栏只有诊断面板，改不了启用状态
    expect(plan.view).toBeUndefined();
  });

  it("open-focus 打开经纬 outline 分类，而不是 story/current_focus.md", () => {
    const plan = planFixAction("open-focus", { chapterNumber: 5 });
    expect(plan.kind).toBe("lore-panel");
    expect(plan.loreCategory).toBe("outline");
    // preflight 的 currentFocus 走 cockpit 的 readCurrentFocusFromJingwei（经纬 SQLite），
    // story/current_focus.md 只在 pipeline.write 注入上下文时读；引导改 md 修不掉 blocker。
    expect(JSON.stringify(plan)).not.toContain("current_focus.md");
  });

  it("三个 directive 类 code 都映射到 open-focus，且都落在经纬面板", () => {
    for (const code of ["missing-directive", "short-directive", "focus-default-only"]) {
      const model = buildWriteViewModel({
        ...readyPreflight,
        ok: false,
        blockers: [{ code, message: `${code} 触发` }],
      });
      const check = model.checks.find((item) => item.code === code);
      expect(check?.fixAction).toBe("open-focus");
      expect(planFixAction(check!.fixAction!, { chapterNumber: 5 }).kind).toBe("lore-panel");
    }
  });
});

describe("canStartWriting", () => {
  const model = buildWriteViewModel(readyPreflight);

  it("blocks when preflight is not ready", () => {
    const blocked = buildWriteViewModel({ ...readyPreflight, ok: false, blockers: [{ code: "missing-directive", message: "缺指示" }] });
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
