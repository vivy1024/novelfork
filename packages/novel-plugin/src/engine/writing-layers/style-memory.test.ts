import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  adoptStyleMemories,
  MANUAL_STYLE_MEMORY_SOURCE_ID,
  previewStyleMemory,
} from "./style-memory.js";
import { AUTHOR_REVISION_SOURCE_ID, adoptRevisionSamples } from "./style-vault.js";
import { createStylePreset } from "./style-preset.js";
import { loadStylePreset, saveStylePreset, StylePresetError } from "./style-preset-store.js";

const roots: string[] = [];
let bookRoot = "";

beforeEach(async () => {
  bookRoot = await mkdtemp(join(tmpdir(), "novelfork-style-memory-"));
  roots.push(bookRoot);
});
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const DIALOGUE_TEXT = [
  "“车还来吗？”她问。",
  "“末班。”值班员头也没抬。",
  "“几点？”",
  "“十一点半。”",
  "“那还有一刻钟。”她看了看表，把票攥紧了。",
  "“你急什么？”",
  "“我爱人还在家等我。”",
].join("\n");

describe("previewStyleMemory", () => {
  it("对对话为主的示例推断对话场景与对话规则，证据来自原文", () => {
    const preview = previewStyleMemory({ text: DIALOGUE_TEXT, note: "对话节奏我很喜欢" });
    expect(preview.sceneTypes).toEqual(["dialogue"]);
    expect(preview.rules[0]).toMatchObject({ origin: "note", text: "对话节奏我很喜欢", evidence: "作者注解" });
    const dialogueRule = preview.rules.find((rule) => rule.text.includes("对话密度高"));
    expect(dialogueRule).toBeDefined();
    expect(dialogueRule!.origin).toBe("inferred");
    expect(dialogueRule!.evidence).toContain("例：");
    expect(DIALOGUE_TEXT).toContain(dialogueRule!.evidence.slice(3).replace(/…$/u, "").slice(0, 20));
    expect(preview.rules.every((rule) => rule.text.trim().length > 0)).toBe(true);
    expect(preview.samples.length).toBeGreaterThan(0);
    expect(preview.samples.every((sample) => sample.sceneType === "dialogue")).toBe(true);
    expect(preview.stats.dialogueRatio).toBeGreaterThan(0.3);
  });

  it("短句为主的示例产出短句规则；无特征文本不编造规则", () => {
    const short = "门开了。他进来。没人说话。灯还亮着。桌上有一封信。他拆开看了一眼。没有署名。";
    const preview = previewStyleMemory({ text: short });
    const rule = preview.rules.find((item) => item.text.includes("短句为主"));
    expect(rule).toBeDefined();
    expect(rule!.evidence.length).toBeGreaterThan(3);

    const flat = previewStyleMemory({ text: "今天天气还算不错我们决定去河边走一走顺便看看新开的茶馆。" });
    expect(flat.rules.filter((rule) => rule.origin === "inferred")).toHaveLength(0);
    expect(flat.warnings.some((warning) => warning.includes("没有从示例中提取到可量化的写法特征"))).toBe(true);
    expect(flat.warnings.some((warning) => warning.includes("示例文本很短"))).toBe(true);
  });

  it("缺注解时提示补一句话说明", () => {
    const preview = previewStyleMemory({ text: DIALOGUE_TEXT });
    expect(preview.note).toBe("");
    expect(preview.warnings.some((warning) => warning.includes("未写注解"))).toBe(true);
    expect(preview.rules.some((rule) => rule.origin === "note")).toBe(false);
  });
});

describe("adoptStyleMemories", () => {
  it("写入「手动写法记忆」来源：confirmed、可迁移、排来源最前，电子书注解进证据", async () => {
    const loaded = await adoptStyleMemories(bookRoot, {
      note: "短句收得住",
      rules: [{ text: "句子以短句为主。", evidence: "门开了。" }],
      samples: [{ text: "门开了。他进来。没人说话。", sceneType: "action" }],
    }, null);

    const source = loaded.preset!.sources[0]!;
    expect(source.id).toBe(MANUAL_STYLE_MEMORY_SOURCE_ID);
    expect(source.title).toBe("手动写法记忆");
    expect(source.rules).toHaveLength(1);
    expect(source.rules[0]).toMatchObject({ text: "句子以短句为主。", transfer: "transferable", status: "confirmed" });
    expect(source.rules[0]!.evidence).toContain("作者注解：短句收得住");
    expect(source.rules[0]!.evidence).toContain("原文：门开了。");
    expect(source.samples).toHaveLength(1);
    expect(source.samples[0]).toMatchObject({ sceneType: "action", transfer: "transferable", status: "confirmed" });
    // 已确认且可迁移的规则必须进入写作指南
    expect(loaded.guideText).toContain("句子以短句为主。");
    expect(loaded.guideText).toContain("手动写法记忆");
  });

  it("重复内容去重且版本不变；与「作者改稿」来源同级排前", async () => {
    const first = await adoptStyleMemories(bookRoot, {
      rules: [{ text: "对话推进场景。" }], samples: [{ text: "“车还来吗？”她问。", sceneType: "dialogue" }],
    }, null);
    const again = await adoptStyleMemories(bookRoot, {
      rules: [{ text: "对话推进场景。" }], samples: [{ text: "“车还来吗？”她问。", sceneType: "dialogue" }],
    }, first.revision);
    expect(again.revision).toBe(first.revision);
    expect(again.preset!.sources[0]!.rules).toHaveLength(1);
    expect(again.preset!.sources[0]!.samples).toHaveLength(1);

    const withRevision = await adoptRevisionSamples(bookRoot, [
      { chapterNumber: 2, authorText: "她攥紧了票根。", aiText: "她拿好票。" },
    ], again.revision);
    // 后写入的记忆来源排最前，作者改稿紧随其后，两者都在蒸馏来源之前。
    const third = await adoptStyleMemories(bookRoot, { rules: [{ text: "段落短促。" }] }, withRevision.revision);
    expect(third.preset!.sources.map((source) => source.id)).toEqual(
      [MANUAL_STYLE_MEMORY_SOURCE_ID, AUTHOR_REVISION_SOURCE_ID],
    );
    expect(third.preset!.sources[1]!.samples).toHaveLength(1);
  });

  it("版本不符拒绝写入，非法场景类型与空输入拒绝", async () => {
    const first = await adoptStyleMemories(bookRoot, { rules: [{ text: "短句。" }] }, null);
    await expect(adoptStyleMemories(bookRoot, { rules: [{ text: "另一条。" }] }, "stale-revision"))
      .rejects.toMatchObject({ code: "STYLE_PRESET_CONFLICT" });
    expect((await loadStylePreset(bookRoot)).revision).toBe(first.revision);

    await expect(adoptStyleMemories(bookRoot, { samples: [{ text: "例句。", sceneType: "bogus" as never }] }, first.revision))
      .rejects.toThrow("场景类型无效");
    await expect(adoptStyleMemories(bookRoot, { rules: [{ text: "  " }] }, first.revision))
      .rejects.toThrow("没有可写入");
    // 失败不改动预设
    expect((await loadStylePreset(bookRoot)).revision).toBe(first.revision);
    expect(StylePresetError).toBeDefined();
  });

  it("追加到同一来源；单来源超 100 条规则时保留最新", async () => {
    const preset = createStylePreset();
    preset.sources.push({
      id: MANUAL_STYLE_MEMORY_SOURCE_ID,
      title: "手动写法记忆",
      rules: Array.from({ length: 100 }, (_, index) => ({
        text: `旧规则${index + 1}`, evidence: "seed", transfer: "transferable" as const, status: "confirmed" as const,
      })),
      samples: [],
    });
    const saved = await saveStylePreset(bookRoot, preset, null);
    const next = await adoptStyleMemories(bookRoot, {
      rules: [{ text: "新的写法规则" }], samples: [{ text: "新的例句。", sceneType: "general" }],
    }, saved.revision);
    const source = next.preset!.sources[0]!;
    expect(source.rules).toHaveLength(100);
    expect(source.rules.at(-1)!.text).toBe("新的写法规则");
    expect(source.rules.some((rule) => rule.text === "旧规则1")).toBe(false);
    expect(source.samples).toHaveLength(1);
  });
});
