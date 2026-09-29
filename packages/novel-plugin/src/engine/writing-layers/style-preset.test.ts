import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { composeStyleGuide, createStylePreset, StylePresetSchema } from "./style-preset.js";
import { loadStylePreset, saveStylePreset, updateStyleFingerprint } from "./style-preset-store.js";
import { resolveWritingLayers } from "./layer-store.js";
import { analyzeStyle } from "../agents/style-analyzer.js";

const roots: string[] = [];
const fingerprint = { avgSentenceLength: 18, sentenceLengthStdDev: 8, vocabularyDiversity: 0.7, dialogueRatio: 0.3 };
async function book() {
  const root = await mkdtemp(join(tmpdir(), "nf-style-preset-"));
  roots.push(root);
  await mkdir(join(root, "story"));
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("本书文风预设", () => {
  it("仅合成已确认的可迁移技法，不注入统计配额、待审规则或来源作品事实", () => {
    const preset = createStylePreset(fingerprint);
    preset.generalRules = ["通过动作表达情绪"];
    preset.bookVoice = { tone: "克制", narrativeVoice: "限知第三人称", principles: ["不提前揭露秘密"] };
    preset.sources = [{ id: "source-a", title: "作者旧稿", samples: [], rules: [
      { text: "对白保留停顿", evidence: "旧稿第十章对白", transfer: "transferable", status: "confirmed" },
      { text: "角色名必须是陈某", evidence: "旧稿第十章人物", transfer: "source-only", status: "confirmed" },
      { text: "每句都用叹号", evidence: "待核查", transfer: "transferable", status: "needs-review" },
    ] }];
    const guide = composeStyleGuide(preset);
    expect(guide).toContain("通过动作表达情绪");
    expect(guide).toContain("对白保留停顿");
    expect(guide).toContain("不提前揭露秘密");
    expect(guide).not.toContain("陈某");
    expect(guide).not.toContain("每句都用叹号");
    expect(guide).not.toContain("avgSentenceLength");
  });

  it("来源规则必须有证据，来源 ID 不可重复", () => {
    const preset = createStylePreset();
    preset.sources = [{ id: "s", title: "来源", samples: [], rules: [{ text: "规则", evidence: "", transfer: "transferable", status: "confirmed" }] }];
    expect(StylePresetSchema.safeParse(preset).success).toBe(false);
    preset.sources[0]!.rules[0]!.evidence = "原文位置";
    preset.sources.push(preset.sources[0]!);
    expect(StylePresetSchema.safeParse(preset).success).toBe(false);
  });

  it("旧指纹只读兼容，作者保存后转入新预设，旧文件保留且不再生效", async () => {
    const root = await book();
    const legacy = join(root, "story", "style_profile.json");
    await writeFile(legacy, JSON.stringify(fingerprint));
    const old = await loadStylePreset(root);
    expect(old.source).toBe("legacy");
    await expect(readFile(join(root, "story", "style_preset.json"))).rejects.toMatchObject({ code: "ENOENT" });
    const preset = old.preset!;
    preset.bookVoice.tone = "冷静";
    await saveStylePreset(root, preset, old.revision);
    await writeFile(legacy, JSON.stringify({ ...fingerprint, avgSentenceLength: 999 }));
    const current = await loadStylePreset(root);
    expect(current.source).toBe("preset");
    expect(current.preset?.fingerprint?.avgSentenceLength).toBe(18);
    expect(current.guideText).toContain("冷静");
  });

  it("并发编辑只有一个版本成功，冲突不会覆盖先保存的内容", async () => {
    const root = await book();
    const first = createStylePreset(); first.name = "版本一";
    const second = createStylePreset(); second.name = "版本二";
    const results = await Promise.allSettled([saveStylePreset(root, first, null), saveStylePreset(root, second, null)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "STYLE_PRESET_CONFLICT" } });
    expect((await loadStylePreset(root)).preset?.name).toBe("版本一");
  });

  it.runIf(process.platform === "win32")("Windows 同一书籍路径大小写不同也必须共享版本锁", async () => {
    const root = await book();
    const first = createStylePreset(); first.name = "先保存的版本";
    const second = createStylePreset(); second.name = "过期的版本";
    const results = await Promise.allSettled([
      saveStylePreset(root, first, null),
      saveStylePreset(root.toUpperCase(), second, null),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "STYLE_PRESET_CONFLICT" } });
    expect((await loadStylePreset(root)).preset?.name).toBe(first.name);
  });

  it("旧分析器指纹无需对白占比，显式保存完整保留旧统计扩展字段", async () => {
    const root = await book();
    const legacy = join(root, "story", "style_profile.json");
    const profile = analyzeStyle("风停了。他推开门，又把手缩了回来。", "作者旧稿");
    const raw = JSON.stringify(profile);
    await writeFile(legacy, raw);
    const old = await loadStylePreset(root);
    expect(old.preset?.fingerprint).toEqual(profile);
    expect(old.preset?.fingerprint?.dialogueRatio).toBeUndefined();
    const saved = await saveStylePreset(root, old.preset, old.revision);
    expect(saved.source).toBe("preset");
    expect((await loadStylePreset(root)).preset?.fingerprint).toEqual(profile);
    expect(await readFile(legacy, "utf8")).toBe(raw);
  });

  it.each([true, false])("作者保存与统计写入同时发生时保留规则并拒绝过期版本，作者先保存：%s", async (authorFirst) => {
    const root = await book();
    const preset = createStylePreset(fingerprint);
    preset.generalRules = ["原有写法"];
    preset.bookVoice.tone = "克制";
    const saved = await saveStylePreset(root, preset, null);
    const edited = { ...preset, generalRules: ["作者新写法"] };
    const updatedFingerprint = { ...fingerprint, avgSentenceLength: 27 };
    const authorSave = () => saveStylePreset(root, edited, saved.revision);
    const statisticsSave = () => updateStyleFingerprint(root, updatedFingerprint);
    const results = await Promise.allSettled(authorFirst
      ? [authorSave(), statisticsSave()]
      : [statisticsSave(), authorSave()]);
    expect(results[0].status).toBe("fulfilled");
    if (authorFirst) expect(results[1].status).toBe("fulfilled");
    else expect(results[1]).toMatchObject({ status: "rejected", reason: { code: "STYLE_PRESET_CONFLICT" } });
    const current = await loadStylePreset(root);
    expect(current.preset?.generalRules).toEqual(authorFirst ? edited.generalRules : preset.generalRules);
    expect(current.preset?.bookVoice).toEqual(preset.bookVoice);
    expect(current.preset?.fingerprint).toEqual(updatedFingerprint);
    // 失败的写入应释放队列，作者重载合并后能继续保存。
    await saveStylePreset(root, { ...current.preset!, generalRules: edited.generalRules }, current.revision);
    expect((await loadStylePreset(root)).preset?.generalRules).toEqual(edited.generalRules);
  });

  it("统计蒸馏更新只改指纹，写法、范文和其他书籍均不被覆盖", async () => {
    const root = await book(); const other = await book();
    const preset = createStylePreset(fingerprint);
    preset.generalRules = ["让人物通过选择展现性格"];
    preset.sources = [{ id: "old", title: "本人旧稿", rules: [], samples: [{
      id: "sample", sceneType: "dialogue", text: "他停下杯子，没有回答。", evidence: "作者修订片段",
      transfer: "transferable", status: "confirmed",
    }] }];
    await saveStylePreset(root, preset, null);
    await updateStyleFingerprint(root, { ...fingerprint, avgSentenceLength: 23 });
    const next = await loadStylePreset(root);
    expect(next.preset?.generalRules).toEqual(preset.generalRules);
    expect(next.preset?.sources).toEqual(preset.sources);
    expect(next.preset?.fingerprint?.avgSentenceLength).toBe(23);
    expect((await loadStylePreset(other)).preset).toBeNull();
    const layers = await resolveWritingLayers({ bookRoot: root });
    expect(layers.styleGuideText).toContain(preset.generalRules[0]);
    expect(layers.styleGuideText).not.toContain("avgSentenceLength");
    expect(JSON.parse(layers.bookDesign.styleProfileRaw).avgSentenceLength).toBe(23);
  });

  it("坏预设拒绝静默降级，统计更新也不能覆盖原文件", async () => {
    const root = await book();
    const path = join(root, "story", "style_preset.json");
    await writeFile(path, "broken");
    await writeFile(join(root, "story", "style_profile.json"), JSON.stringify(fingerprint));
    await expect(loadStylePreset(root)).rejects.toMatchObject({ code: "STYLE_PRESET_CORRUPTED" });
    await expect(updateStyleFingerprint(root, fingerprint)).rejects.toMatchObject({ code: "STYLE_PRESET_CORRUPTED" });
    expect(await readFile(path, "utf8")).toBe("broken");
  });

  it.each(["style_profile.json", "style_preset.json"])("%s 的 JSON 合法但字段损坏时拒绝读取与写入", async (filename) => {
    const root = await book();
    const path = join(root, "story", filename);
    const raw = JSON.stringify(filename === "style_profile.json"
      ? { ...fingerprint, vocabularyDiversity: "损坏" }
      : { ...createStylePreset(), generalRules: "损坏" });
    await writeFile(path, raw);
    await expect(loadStylePreset(root)).rejects.toMatchObject({ code: "STYLE_PRESET_CORRUPTED" });
    await expect(resolveWritingLayers({ bookRoot: root })).rejects.toMatchObject({ code: "STYLE_PRESET_CORRUPTED" });
    await expect(saveStylePreset(root, createStylePreset(), null)).rejects.toMatchObject({ code: "STYLE_PRESET_CORRUPTED" });
    await expect(updateStyleFingerprint(root, fingerprint)).rejects.toMatchObject({ code: "STYLE_PRESET_CORRUPTED" });
    expect(await readFile(path, "utf8")).toBe(raw);
  });

  it("已保存空预设时不再回退旧指纹或注入未审核及作品专属来源", async () => {
    const root = await book();
    const preset = createStylePreset();
    preset.sources = [{ id: "s", title: "来源作品", rules: [
      { text: "待审写法", evidence: "原文", transfer: "transferable", status: "needs-review" },
      { text: "作品专属设定", evidence: "原文", transfer: "source-only", status: "confirmed" },
    ], samples: [{ id: "sample", sceneType: "general", text: "作品中的人物与地名", evidence: "原文", transfer: "source-only", status: "confirmed" }] }];
    await saveStylePreset(root, preset, null);
    await writeFile(join(root, "story", "style_profile.json"), "损坏的旧文件");
    expect((await loadStylePreset(root)).preset?.fingerprint).toBeNull();
    const layers = await resolveWritingLayers({ bookRoot: root });
    expect(layers.styleGuideText).toBe("");
    expect(layers.bookDesign.styleProfileRaw).toBe("");
  });
});
