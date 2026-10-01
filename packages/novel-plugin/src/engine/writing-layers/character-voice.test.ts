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
  VOICE_MODEL_MAX_TOKENS,
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

  it("说话动词须紧贴引号，名字须是说话人而不是宾语或定语", () => {
    const text = [
      "赵太爷打了陆沉一个嘴巴，陆沉说：“打得好。”", // 前一小句的人名不影响本小句的主语
      "他对陆沉说：“滚出去。”", // 陆沉是宾语
      "师父骂陆沉道：“孽障！”", // 陆沉是宾语
      "陆沉看着他说：“走罢。”", // 名字与动词之间换了人称，说话人不确定
      "陆沉的意思，大家都懂，因为他常说“一剑了之”这句话。", // 定语 + 叙述引语
      "陆沉知道：“这回躲不过了。”", // 「知道」不是开口说话
      "“知道了。”陆沉知道这回躲不过。",
      "陆沉歪着头，说道：",
      "",
      "“我偏不。”",
    ].join("\n");
    expect(extractCharacterDialogue(text, { names: ["陆沉"], otherNames: ["赵太爷"] })).toEqual(["打得好。", "我偏不。"]);
  });

  it("没有句末标点的短引语默认是叙述里的词，不算对白", () => {
    const text = "陆沉最爱讲“剑意”这个词。“无妨”陆沉说。陆沉说：“走。”";
    expect(extractCharacterDialogue(text, { names: ["陆沉"] })).toEqual(["走。"]);
  });
});

/**
 * 2026-09-30 真模型基准的样书《阿Q正传》（公版）原文摘录，逐句照录，段间以「（略）」隔开。
 * 旧判据把 20 句里的 5 句叙述引语（著之竹帛、行状、癞、犯忌、这路生意）当成了阿Q的对白。
 */
const AQ_EXCERPT = [
  "他活着的时候，人都叫他阿Quei，死了以后，便没有一个人再叫阿Quei了，那里还会有“著之竹帛”的事。若论“著之竹帛”，这篇文章要算第一次，所以先遇着了这第一个难关。",
  "阿Q不独是姓名籍贯有些渺茫，连他先前的“行状”也渺茫。因为未庄的人们之于阿Q，只要他帮忙，只拿他玩笑，从来没有留心他的“行状”的。",
  "这虽然也在他身上，而看阿Q的意思，倒也似乎以为不足贵的，因为他讳说“癞”以及一切近于“赖”的音，后来推而广之，“光”也讳，“亮”也讳，再后来，连“灯”“烛”都讳了。",
  "阿Q没有法，只得另外想出报复的话来：\n\n“你还不配……”这时候，又仿佛在他头上的是一种高尚的光荣的癞头疮，并非平常的癞头疮了；但上文说过，阿Q是有见识的，他立刻知道和“犯忌”有点抵触，便不再往底下说。",
  "阿Q两只手都捏住了自己的辫根，歪着头，说道：\n\n“打虫豸，好不好？我是虫豸——还不放么？”",
  "“‘君子动口不动手！’”阿Q歪着头说：",
  "“秃儿。驴……”阿Q历来本只在肚子里骂，没有出过声，这回因为正气忿，因为要报仇，便不由的轻轻的说出来了。",
  "“这断子绝孙的阿Q！”远远地听得小尼姑的带哭的声音。\n\n“哈哈哈！”阿Q十分得意的笑。\n\n“哈哈哈！”酒店里的人也九分得意的笑。",
  "只是没有人来叫他做短工，却使阿Q肚子饿：这委实是一件非常“妈妈的”的事情。",
  "“畜生！”阿Q怒目而视的说，嘴角上飞出唾沫来。",
  "“记着罢，妈妈的……”阿Q回过头去说。\n\n“妈妈的，记着罢……”小D也回过头来说。",
  "“我什么时候跳进你的园里来偸萝卜？”阿Q且看且走的说。",
  "“你们可看见过杀头么？”阿Q说，“咳，好看。杀革命党。唉，好看好看，……”他摇摇头，将唾沫飞在正对面的赵司晨的脸上。",
  "“太爷！”阿Q似笑非笑的叫了一声，在檐下站住了。",
  "“阿Q！”秀才只得直呼其名了。\n\n阿Q这才站住，歪着头问道：“什么？”",
  "“穷朋友？你总比我有钱。”阿Q说着自去了。",
  "“荷荷！”阿Q忽而大叫起来，抬了头仓皇的四顾。",
  "“革命了……你知道？……”阿Q说得很含糊。",
  "阿Q的心怦怦的跳了。小D说了便走；阿Q却跳而又停的两三回，但他究竟是做过“这路生意”的人，格外胆大，于是躄出路角，仔细的听，似乎有些嚷嚷，又仔细的看，似乎许多白盔白甲的人，络绎的将箱子抬出了，器具抬出了，秀才娘子的宁式床也抬出了，但是不分明，他还想上前，两只脚却没有动。",
  "他们问阿Q，阿Q爽利的答道，“因为我想造反。”",
  "老头子和气的问道，“你还有什么话说么？”\n\n阿Q一想，没有话，便回答说，“没有。”",
].join("\n\n（略）\n\n");

const AQ_OTHERS = ["赵太爷", "太爷", "赵老太爷", "赵秀才", "秀才", "茂才先生", "茂才公", "王胡", "王癞胡", "小D", "小Don", "吴妈", "假洋鬼子", "洋先生", "邹七嫂", "七嫂", "小尼姑", "举人老爷", "举人", "把总"];

/** 阿Q在摘录里真正说出口的话（「你还不配……」前面没有说话动词，漏收可以接受）。 */
const AQ_SPOKEN = [
  "打虫豸，好不好？我是虫豸——还不放么？",
  "君子动口不动手！",
  "秃儿。驴……",
  "哈哈哈！",
  "畜生！",
  "记着罢，妈妈的……",
  "我什么时候跳进你的园里来偸萝卜？",
  "你们可看见过杀头么？",
  "咳，好看。杀革命党。唉，好看好看，……",
  "太爷！",
  "什么？",
  "穷朋友？你总比我有钱。",
  "荷荷！",
  "革命了……你知道？……",
  "因为我想造反。",
  "没有。",
];

describe("角色声线：样书对白抽取回归（阿Q正传）", () => {
  const lines = extractCharacterDialogue(AQ_EXCERPT, { names: ["阿Q", "阿Quei"], otherNames: AQ_OTHERS });

  it("收进阿Q的真实对白", () => {
    expect(lines).toEqual(expect.arrayContaining(AQ_SPOKEN));
    // 两句「哈哈哈！」只有一句是阿Q的。
    expect(lines.filter((line) => line === "哈哈哈！")).toHaveLength(1);
  });

  it("不收叙述引语与别人的话", () => {
    for (const narration of ["著之竹帛", "行状", "癞", "犯忌", "这路生意", "妈妈的"]) expect(lines).not.toContain(narration);
    for (const others of ["妈妈的，记着罢……", "阿Q！", "你还有什么话说么？", "这断子绝孙的阿Q！"]) expect(lines).not.toContain(others);
    for (const line of lines) expect([...AQ_SPOKEN, "你还不配……"]).toContain(line);
  });

  it("句长统计与证据只来自真实对白", () => {
    const draft = draftCharacterVoice({ card: { name: "阿Q", aliases: ["阿Quei"], fields: {} }, dialogueSamples: lines });
    const evidence = Object.values(draft.fields).flatMap((field) => field?.evidence ?? []);
    for (const narration of ["著之竹帛", "行状", "癞", "犯忌", "这路生意"]) expect(evidence).not.toContain(narration);
    expect(draft.sampleCount).toBe(new Set(lines).size);
    expect(draft.fields.sentenceLength?.evidence).toEqual(lines.slice(0, 2));
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

  it("模型失败或输出非法时原样返回规则初稿，并区分失败类别", async () => {
    const run = (generateText: Parameters<typeof enrichCharacterVoiceWithModel>[0]["generateText"]) =>
      enrichCharacterVoiceWithModel({ card: luChen, dialogueSamples: luChenSamples, draft, generateText });

    const failing = await run(async () => { throw new Error("网络中断"); });
    expect(failing.outcome).toMatchObject({ status: "failed", reason: "网络中断", failureKind: "call-failed" });
    expect(failing.draft).toBe(draft);

    expect((await run(async () => ({ text: "我不知道" }))).outcome).toMatchObject({ status: "failed", failureKind: "no-json" });
    // 思考型模型把额度耗在推理上、只吐出半个 JSON（W0 实测 gemini 只有 136 字节）。
    const truncated = await run(async () => ({ text: "```json\n{\n  \"fields\": {\n    \"positioning\": {\n      \"value\": \"极短句为主，粗鄙市井" }));
    expect(truncated.outcome).toMatchObject({ status: "failed", failureKind: "truncated" });
    expect(truncated.draft).toBe(draft);
    // 宿主报告截断、输出里一个括号都没有，也算截断而不是「没有 JSON」。
    expect((await run(async () => ({ text: "让我先分析一下这个角色", outputTruncated: true }))).outcome).toMatchObject({ failureKind: "truncated" });
    expect((await run(async () => ({ text: "{\"fields\": {\"a\": 1 2}}" }))).outcome).toMatchObject({ failureKind: "invalid" });
    expect((await run(async () => ({ text: "{\"声线\": {}}" }))).outcome).toMatchObject({ failureKind: "invalid-shape" });
  });

  it("按放宽后的输出上限请求模型", async () => {
    const generateText = vi.fn(async () => ({ text: "{\"fields\": {}}" }));
    await enrichCharacterVoiceWithModel({ card: luChen, dialogueSamples: luChenSamples, draft, generateText });
    const request = (generateText.mock.calls[0] as unknown as [{ maxTokens: number }])[0];
    expect(request.maxTokens).toBe(VOICE_MODEL_MAX_TOKENS);
    expect(VOICE_MODEL_MAX_TOKENS).toBeGreaterThanOrEqual(6_000);
  });

  it("字符串里未转义的 ASCII 引号可修补（W0 实测 claude 输出片段），单个坏字段不连累其他字段", async () => {
    const card: CharacterCardSource = { name: "阿Q", aliases: ["阿Quei"], fields: {}, contentMd: "未庄的雇农。吃了亏便用“精神胜利法”自我安慰。" };
    const samples = ["畜生！", "记着罢，妈妈的……", "穷朋友？你总比我有钱。", "你们可看见过杀头么？"];
    const aqDraft = draftCharacterVoice({ card, dialogueSamples: samples });
    const raw = [
      "```json",
      "{",
      "  \"fields\": {",
      "    \"cognitiveFilter\": {",
      "      \"value\": \"用\"谁比谁穷/谁比谁阔\"的等级尺子看人，吃亏就用精神胜利法把自己翻到上位。\",",
      "      \"evidence\": [\"穷朋友？你总比我有钱。\", \"你们可看见过杀头么？\"]",
      "    },",
      "    \"underAnger\": {",
      "      \"value\": \"蹦出粗口\"妈妈的\"\"畜生\"，句子更短更碎，用祈使句威胁后拖省略号。\",",
      "      \"evidence\": [\"畜生！\", \"记着罢，妈妈的……\"]",
      "    },",
      "    \"whenLying\": { \"value\": null, \"evidence\": [] }",
      "  }",
      "}",
      "```",
    ].join("\n");
    const result = await enrichCharacterVoiceWithModel({ card, dialogueSamples: samples, draft: aqDraft, generateText: async () => ({ text: raw }) });
    expect(result.outcome).toMatchObject({ status: "applied", repaired: true });
    expect(result.outcome.acceptedKeys).toEqual(["cognitiveFilter", "underAnger"]);
    expect(result.draft.fields.cognitiveFilter?.value).toBe("用“谁比谁穷/谁比谁阔”的等级尺子看人，吃亏就用精神胜利法把自己翻到上位。");
    expect(result.draft.fields.underAnger?.value).toContain("“妈妈的”“畜生”");
    expect(result.draft.fields.whenLying).toBeUndefined();
  });
});
