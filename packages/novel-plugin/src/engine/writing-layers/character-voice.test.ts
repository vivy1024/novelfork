import { describe, expect, it, vi } from "vitest";
import {
  applyVoiceFieldUpdates,
  buildVoiceConstraintText,
  CHARACTER_VOICE_FIELD_KEYS,
  CharacterVoiceError,
  createEmptyCharacterVoice,
  draftCharacterVoice,
  enrichCharacterVoiceWithModel,
  extractCharacterDialogue,
  findRepeatedPhrases,
  mergeVoiceDraft,
  parseCharacterVoice,
  readCharacterVoiceProfiles,
  serializeCharacterVoice,
  summarizeCharacterVoice,
  type CharacterCardSource,
  type CharacterVoice,
  type CharacterVoiceFieldKey,
} from "./character-voice.js";

const NOW = new Date("2026-09-29T00:00:00.000Z");

const luChen: CharacterCardSource = {
  name: "陆沉",
  fields: { personality: "沉默寡言，冷静", core_belief: "只信手里的剑", classic_quotes: ["啧，又是你。"] },
};
const luChenSamples = ["啧。滚。", "啧，别碰它。", "不必。", "走。"];

const suWanqing: CharacterCardSource = {
  name: "苏晚晴",
  fields: { personality: "话多，温柔" },
};
const suSamples = [
  "师兄……你其实也不是那么讨厌的人呢，我知道的。",
  "今天的风好大呀，我们要不要去那边的亭子里坐一会儿呢？",
  "你别这样看我……我、我只是随口问问嘛。",
  "其实呢，我一直想跟你说一件事，可是每次话到嘴边就忘了。",
  "你要是不嫌弃的话，下回我还给你带桂花糕来呢，好不好嘛。",
];

/** 把草稿写进空声线，并把所有待审项原样确认（模拟作者逐项确认）。 */
function confirmAll(voice: CharacterVoice): CharacterVoice {
  const updates: Partial<Record<CharacterVoiceFieldKey, { value: string | readonly string[]; status: "confirmed" }>> = {};
  for (const key of CHARACTER_VOICE_FIELD_KEYS) {
    const field = voice.fields[key];
    if (field.status === "needs-review") updates[key] = { value: field.value, status: "confirmed" };
  }
  return applyVoiceFieldUpdates(voice, updates, NOW);
}

describe("角色声线：确定性初稿", () => {
  it("两个角色的对白统计出明显不同的句式指纹", () => {
    const lu = draftCharacterVoice({ card: luChen, dialogueSamples: luChenSamples });
    const su = draftCharacterVoice({ card: suWanqing, dialogueSamples: suSamples });

    expect(lu.sampleCount).toBe(5);
    expect(lu.fields.sentenceLength?.value).toMatch(/^短句为主/);
    expect(lu.fields.catchphrases?.value).toContain("啧");
    expect(lu.fields.pauses?.value).toContain("话说得干脆");
    expect(lu.fields.positioning).toMatchObject({ value: expect.stringContaining("话少"), source: "card" });
    expect(lu.fields.cognitiveFilter?.value).toContain("只信手里的剑");

    expect(su.fields.sentenceLength?.value).toMatch(/^长句偏多/);
    expect(su.fields.pauses?.value).toContain("省略号");
    expect(su.fields.signaturePatterns?.value).toContain("句尾常带「嘛」");
    expect(su.fields.positioning?.value).toContain("话多");

    for (const key of ["sentenceLength", "pauses", "positioning"] as const) {
      expect(lu.fields[key]?.value).not.toEqual(su.fields[key]?.value);
    }
    // 每个草稿字段都带证据，统计类证据取自对白原句。
    for (const field of Object.values(lu.fields)) expect(field?.evidence.length).toBeGreaterThan(0);
  });

  it("依据不足时不编造：没有对白就不出统计字段，情绪变化缺失即待补充", () => {
    const draft = draftCharacterVoice({ card: { name: "路人甲", fields: { personality: "普通" } } });
    expect(draft.stats).toBeNull();
    expect(Object.keys(draft.fields)).toEqual([]);
    const merged = mergeVoiceDraft(createEmptyCharacterVoice(), draft, NOW);
    expect(summarizeCharacterVoice(merged.voice)).toMatchObject({ confirmed: 0, needsReview: 0, missing: CHARACTER_VOICE_FIELD_KEYS.length });
  });

  it("角色卡里明写的说话方式、禁区与情绪变化按原句提取", () => {
    const draft = draftCharacterVoice({
      card: {
        name: "顾长风",
        fields: { personality: "圆滑" },
        contentMd: "他说话总是慢半拍，尾音拖长。他生气时反而笑，声音压得很低。他从不说对不起。他撒谎时会摸鼻子。口头禅是「无妨」。",
      },
    });
    expect(draft.fields.positioning?.value).toContain("说话总是慢半拍");
    expect(draft.fields.positioning?.value).not.toContain("生气");
    expect(draft.fields.underAnger?.value).toContain("生气时反而笑");
    expect(draft.fields.forbiddenPatterns?.value).toEqual(["他从不说对不起"]);
    expect(draft.fields.whenLying?.value).toContain("摸鼻子");
    expect(draft.fields.catchphrases).toMatchObject({ value: ["无妨"], source: "card" });
    expect(draft.fields.underTension).toBeUndefined();
  });

  it("反复词只收多句都出现的最长片段，常用虚词不算口头禅", () => {
    const phrases = findRepeatedPhrases(["我告诉你，这事没完。", "我告诉你，别想跑。", "什么？什么意思？", "你说什么"]);
    expect(phrases.map((item) => item.phrase)).toEqual(["我告诉你"]);
  });
});

describe("角色声线：合并与作者确认", () => {
  it("草稿只写成待审；已确认的字段不被覆盖", () => {
    let voice = mergeVoiceDraft(createEmptyCharacterVoice(), draftCharacterVoice({ card: luChen, dialogueSamples: luChenSamples }), NOW).voice;
    expect(voice.fields.sentenceLength.status).toBe("needs-review");
    voice = applyVoiceFieldUpdates(voice, { sentenceLength: { value: "极短，常一两个字", status: "confirmed" } }, NOW);
    const again = mergeVoiceDraft(voice, draftCharacterVoice({ card: luChen, dialogueSamples: luChenSamples }), NOW);
    expect(again.keptConfirmedKeys).toContain("sentenceLength");
    expect(again.voice.fields.sentenceLength).toMatchObject({ value: "极短，常一两个字", status: "confirmed", source: "author" });
    expect(again.appliedKeys).toContain("catchphrases");
  });

  it("原样确认保留来源与证据，改写记为作者，清空退回待补充", () => {
    const voice = mergeVoiceDraft(createEmptyCharacterVoice(), draftCharacterVoice({ card: luChen, dialogueSamples: luChenSamples }), NOW).voice;
    const next = applyVoiceFieldUpdates(voice, {
      catchphrases: { value: voice.fields.catchphrases.value, status: "confirmed" },
      positioning: { value: "话少，句句像刀", status: "confirmed" },
      pauses: { value: "", status: "confirmed" },
    }, NOW);
    expect(next.fields.catchphrases).toMatchObject({ status: "confirmed", source: "dialogue" });
    expect(next.fields.catchphrases.evidence?.length).toBeGreaterThan(0);
    expect(next.fields.positioning).toMatchObject({ status: "confirmed", source: "author" });
    expect(next.fields.positioning.evidence).toBeUndefined();
    expect(next.fields.pauses.status).toBe("missing");
    expect(() => applyVoiceFieldUpdates(voice, { unknown: { value: "x", status: "confirmed" } } as never, NOW)).toThrow(CharacterVoiceError);
  });

  it("存储形态可往返；坏数据报 CORRUPTED 而不是当成空", () => {
    const voice = mergeVoiceDraft(createEmptyCharacterVoice(), draftCharacterVoice({ card: suWanqing, dialogueSamples: suSamples }), NOW).voice;
    expect(parseCharacterVoice(serializeCharacterVoice(voice))).toEqual(voice);
    expect(parseCharacterVoice(undefined)).toEqual(createEmptyCharacterVoice());
    expect(() => parseCharacterVoice({ schemaVersion: 1, fields: { positioning: { value: "", status: "confirmed" } } })).toThrow(/为空却标为已确认/);
    expect(() => parseCharacterVoice({ schemaVersion: 1, fields: { catchphrases: { value: "啧", status: "confirmed" } } })).toThrow(/值形态不对/);
    expect(() => parseCharacterVoice("oops")).toThrow(CharacterVoiceError);
  });
});

describe("角色声线：写对白约束文本", () => {
  it("只收本场出场角色的已确认字段，两人的约束能明显区分", () => {
    const lu = confirmAll(mergeVoiceDraft(createEmptyCharacterVoice(), draftCharacterVoice({ card: luChen, dialogueSamples: luChenSamples }), NOW).voice);
    const suDraft = mergeVoiceDraft(createEmptyCharacterVoice(), draftCharacterVoice({ card: suWanqing, dialogueSamples: suSamples }), NOW).voice;
    // 苏晚晴的声音定位保持待审，不应注入。
    const su = applyVoiceFieldUpdates(suDraft, {
      sentenceLength: { value: suDraft.fields.sentenceLength.value, status: "confirmed" },
      pauses: { value: suDraft.fields.pauses.value, status: "confirmed" },
      signaturePatterns: { value: suDraft.fields.signaturePatterns.value, status: "confirmed" },
    }, NOW);
    const profiles = [
      { characterId: "c-lu", name: "陆沉", voice: lu },
      { characterId: "c-su", name: "苏晚晴", voice: su },
      { characterId: "c-gu", name: "顾长风", voice: lu },
    ];
    const text = buildVoiceConstraintText(profiles, ["c-lu", "c-su"]);
    expect(text).toContain("【角色声线｜高优先级】");
    const [luBlock, suBlock] = text.split("### ").slice(1);
    expect(luBlock).toContain("陆沉");
    expect(luBlock).toContain("短句为主");
    expect(luBlock).toContain("「啧」");
    expect(suBlock).toContain("苏晚晴");
    expect(suBlock).toContain("省略号");
    expect(suBlock).toContain("句尾常带「嘛」");
    expect(suBlock).not.toContain("声音定位");
    expect(text).not.toContain("顾长风");
    expect(text).toContain("区分要求");
  });

  it("没有已确认声线或无人出场时返回空串", () => {
    const pending = mergeVoiceDraft(createEmptyCharacterVoice(), draftCharacterVoice({ card: luChen, dialogueSamples: luChenSamples }), NOW).voice;
    expect(buildVoiceConstraintText([{ characterId: "c-lu", name: "陆沉", voice: pending }], ["c-lu"])).toBe("");
    expect(buildVoiceConstraintText([{ characterId: "c-lu", name: "陆沉", voice: confirmAll(pending) }], [])).toBe("");
  });

  it("从经纬条目读声线时单独列出坏数据", () => {
    const { profiles, corruptedIds } = readCharacterVoiceProfiles([
      { id: "a", title: "甲", fields: {} },
      { id: "b", title: "乙", fields: { voice: { schemaVersion: 2 } } },
    ]);
    expect(profiles.map((item) => item.characterId)).toEqual(["a"]);
    expect(corruptedIds).toEqual(["b"]);
  });
});

describe("角色声线：正文对白抽取", () => {
  it("只收能明确归给本人的对白，同句出现其他角色则跳过", () => {
    const text = [
      "陆沉冷声道：“滚。”",
      "“别碰它。”陆沉说。",
      "苏晚晴笑道：“师兄又凶人家。”",
      "陆沉看了苏晚晴一眼，说：“走吧。”",
      "“谁在那里？”",
    ].join("\n");
    expect(extractCharacterDialogue(text, { names: ["陆沉"], otherNames: ["苏晚晴"] })).toEqual(["滚。", "别碰它。"]);
    expect(extractCharacterDialogue(text, { names: ["苏晚晴"], otherNames: ["陆沉"] })).toEqual(["师兄又凶人家。"]);
  });
});

describe("角色声线：模型增补", () => {
  const draft = draftCharacterVoice({ card: luChen, dialogueSamples: luChenSamples });

  it("只接受证据能在材料里找到的字段，口头禅须真实出现过；统计字段不交给模型", async () => {
    const generateText = vi.fn(async () => ({
      text: "```json\n" + JSON.stringify({ fields: {
        underAnger: { value: "越气话越少", evidence: ["啧，别碰它。"] },
        whenLying: { value: "撒谎时眼神飘忽", evidence: ["他总是眼神飘忽"] },
        catchphrases: { value: ["啧", "哈哈哈"], evidence: ["啧。滚。"] },
        sentenceLength: { value: "长句", evidence: ["不必。"] },
      } }) + "\n```",
    }));
    const result = await enrichCharacterVoiceWithModel({ card: luChen, dialogueSamples: luChenSamples, draft, generateText, lockedKeys: ["positioning"] });
    expect(result.outcome.status).toBe("applied");
    expect(result.outcome.acceptedKeys).toEqual(expect.arrayContaining(["underAnger", "catchphrases"]));
    expect(result.outcome.rejectedKeys).toEqual(["whenLying"]);
    expect(result.draft.fields.underAnger).toMatchObject({ value: "越气话越少", source: "model" });
    expect(result.draft.fields.catchphrases?.value).toEqual(["啧"]);
    expect(result.draft.fields.sentenceLength?.source).toBe("dialogue");
    expect(result.draft.fields.whenLying).toBeUndefined();
    const prompt = (generateText.mock.calls[0] as unknown as [{ messages: { content: string }[] }])[0].messages[1]!.content;
    expect(prompt).not.toContain("- positioning（");
    expect(prompt).not.toContain("- sentenceLength（");
  });

  it("模型失败或输出非法时原样返回规则初稿", async () => {
    const failing = await enrichCharacterVoiceWithModel({ card: luChen, dialogueSamples: luChenSamples, draft, generateText: async () => { throw new Error("网络中断"); } });
    expect(failing.outcome).toMatchObject({ status: "failed", reason: "网络中断" });
    expect(failing.draft).toBe(draft);
    const invalid = await enrichCharacterVoiceWithModel({ card: luChen, dialogueSamples: luChenSamples, draft, generateText: async () => ({ text: "我不知道" }) });
    expect(invalid.outcome.status).toBe("failed");
  });
});
