import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  dialogueBaselineText,
  excerptFor,
  makeInitialStyleDistillationJob,
  MAX_STYLE_DISTILLATION_CHAPTERS,
  MAX_STYLE_DISTILLATION_CHARS,
  normalizeStyleDistillationSource,
  resolveStyleDistillationInput,
  STYLE_BASELINE_LOW_DIALOGUE_RATIO,
  sampleRegisterTag,
  sampleSceneType,
  StyleDistillationError,
} from "./style-distillation.js";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("范文场景分类", () => {
  it("序言议论段里零星称引、冒号不判为对话", () => {
    const essay = "我要给阿Q做正传，已经不止一两年了。但一面要做，一面又往回想，这足见我不是一个「立言」的人：因为从来不朽之笔，须传不朽之人，于是人以文传，文以人传。";
    expect(sampleSceneType(essay)).not.toBe("dialogue");
  });

  it("引号内对白占比高的段落判为对话", () => {
    const talk = "“你姓赵么？”\n“我……”\n“你怎么会姓赵！你那里配姓赵！”赵太爷跳过去说。";
    expect(sampleSceneType(talk)).toBe("dialogue");
  });
});

function capture(task: () => unknown): unknown {
  try {
    task();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("确定性基线的对话比例文案", () => {
  it("对话比例很低时只陈述比例，不建议用对白推进；比例足够时才给该提示", () => {
    expect(dialogueBaselineText(0)).toBe("对话约占文本 0%，以叙述推进为主，对白很少。");
    expect(dialogueBaselineText(STYLE_BASELINE_LOW_DIALOGUE_RATIO - 0.001)).not.toContain("用对白推进");
    expect(dialogueBaselineText(0.19)).toBe("对话约占文本 19%，用对白推进信息或冲突。");
  });

  it("没有对白的样文生成的基线规则不自相矛盾", () => {
    const { job } = makeInitialStyleDistillationJob("book-1", "job-no-dialogue-1", {
      sourceName: "纯叙述",
      text: `第一章 山路\n${"山风很硬，吹得人睁不开眼。他把背包往上提了提，继续往前走。".repeat(30)}`,
    });
    const dialogue = job.rules.find((rule) => rule.category === "dialogue");
    expect(dialogue?.text).toContain("0%");
    expect(dialogue?.text).not.toContain("用对白推进");
  });

  it("基线规则的证据与文案引用同一个统计数值", () => {
    const { job } = makeInitialStyleDistillationJob("book-1", "job-dialogue-evidence-1", {
      sourceName: "有对白",
      text: `第一章 山路\n${"他停下脚步，把背包往上提了提。“还有多远？”“快了。”".repeat(20)}`,
    });
    const ratio = Math.round((job.fingerprint as { dialogueRatio: number }).dialogueRatio * 100);
    const avg = (job.fingerprint as { avgSentenceLength: number }).avgSentenceLength;
    const dialogue = job.rules.find((rule) => rule.category === "dialogue")!;
    const rhythm = job.rules.find((rule) => rule.category === "rhythm")!;
    expect(dialogue.text).toContain(`${ratio}%`);
    expect(dialogue.evidence).toContain(`${ratio}%`);
    expect(rhythm.text).toContain(`${avg} 字`);
    expect(rhythm.evidence).toContain(`平均句长 ${avg} 字`);
  });
});

describe("文风蒸馏来源正文的长度上限（T-07）与靶向抽样", () => {
  it("超过 300 万字且未抽样的正文报「参考正文过长」，不再误报成章节分割规则无效", () => {
    expect(MAX_STYLE_DISTILLATION_CHAPTERS).toBe(600);
    expect(MAX_STYLE_DISTILLATION_CHARS).toBe(3_000_000);
    const error = capture(() => normalizeStyleDistillationSource({
      sourceName: "超长参考",
      text: `第一章 起\n${"字".repeat(MAX_STYLE_DISTILLATION_CHARS + 1)}`,
    }));
    expect(error).toBeInstanceOf(StyleDistillationError);
    expect((error as StyleDistillationError).code).toBe("STYLE_DISTILLATION_TOO_LARGE");
    expect((error as Error).message).not.toContain("章节分割规则无效");
    expect((error as Error).message).toContain(String(MAX_STYLE_DISTILLATION_CHARS));
  });

  it("介于蒸馏上限与切章上限之间的正文同样在切章前按蒸馏口径拒绝", () => {
    const error = capture(() => normalizeStyleDistillationSource({
      sourceName: "偏长参考",
      text: `第一章 起\n${"字".repeat(MAX_STYLE_DISTILLATION_CHARS + 10)}`,
      // 即使分章规则本身不合法，也应先报长度，不让人去改一条没问题的规则。
      splitPattern: "^(a|aa)+$",
    }));
    expect((error as StyleDistillationError).code).toBe("STYLE_DISTILLATION_TOO_LARGE");
    expect((error as Error).message).toContain(`参考正文最多支持 ${MAX_STYLE_DISTILLATION_CHARS} 字`);
  });

  it("对照：上限内的正文正常切章；分章规则不合法时仍报规则问题", () => {
    const text = `第一章 起\n${"雨落在伞上。".repeat(50)}\n第二章 承\n${"风吹过巷口。".repeat(50)}`;
    expect(normalizeStyleDistillationSource({ sourceName: "参考", text }).chapters).toHaveLength(2);
    const error = capture(() => normalizeStyleDistillationSource({ sourceName: "参考", text, splitPattern: "^(a|aa)+$" }));
    expect((error as StyleDistillationError).code).toBe("STYLE_DISTILLATION_INVALID_INPUT");
    expect((error as Error).message).toContain("章节分割规则无效");
  });

  it("resolveStyleDistillationInput 支持超过 600 章的本地大文件按 chapterList 跳章抽样并严格保留原章号", async () => {
    await mkdir("D:/DESKTOP/novelfork/tmp", { recursive: true });
    const root = await mkdtemp("D:/DESKTOP/novelfork/tmp/nf-distill-file-");
    tempDirs.push(root);
    const lines: string[] = [];
    for (let i = 1; i <= 700; i += 1) {
      lines.push(`第${i}章 原书章名${i}\n这是第${i}章的正文，风吹过石阶，灯火摇晃。`);
    }
    await writeFile(join(root, "参考大书.txt"), lines.join("\n\n"), "utf8");

    const resolved = await resolveStyleDistillationInput(root, {
      sourceName: "",
      filePath: "参考大书.txt",
      chapterList: [1, 2, 3, 24, 88, 278, 650],
    });
    expect(resolved.sourceName).toBe("参考大书");
    const normalized = normalizeStyleDistillationSource(resolved);
    expect(normalized.chapters.map((c) => c.number)).toEqual([1, 2, 3, 24, 88, 278, 650]);
    expect(normalized.chapterRange).toEqual({ from: 1, to: 650 });
  });

  it("excerptFor 挑最具特征密度的 300~500 字自然段窗口，mapSamples 区分干净可迁移段与含高频专名段", () => {
    const ch = {
      number: 24,
      title: "算账",
      content: [
        "第24章 算账",
        "短碎句。",
        "清晨的街道空空荡荡，路边还没有几个人走动，只有远处传来几声零星的脚步，一切都显得平平无奇。",
        `本月工时折算下来一共 360 枚灵石，扣除筑基贷款利息 85 枚灵石、洞府物业成本 30 枚灵石与丹药损耗 45 枚灵石，账面余额只剩 200 枚灵石。${"他捏着玉简反复核算每一笔收益与欠款，连半块灵石的折旧都不肯漏算。".repeat(9)}`,
      ].join("\n"),
    };
    const picked = excerptFor(ch);
    expect(picked.length).toBeGreaterThanOrEqual(300);
    expect(picked.length).toBeLessThanOrEqual(550);
    expect(picked).toContain("贷款利息");
    expect(picked).not.toContain("短碎句");
    expect(sampleRegisterTag(picked)).toBe("bill_inventory");

    // 构造多章：第 1~3 章反复出现专名「张羽」「昆墟宗」，第 4 章为完全不含专名的纯技法动作段
    const { job } = makeInitialStyleDistillationJob("book-1", "job-sample-transfer-1", {
      sourceName: "专名测试",
      chapters: [
        { number: 1, content: `${"张羽走进昆墟宗大殿，张羽看着昆墟宗的贷款合同条款，心中冷笑。".repeat(16)}` },
        { number: 2, content: `${"张羽离开昆墟宗药房，张羽盘算着昆墟宗的学分考核与违约利息。".repeat(16)}` },
        { number: 3, content: `${"张羽站在昆墟宗演武场，张羽催动灵力迎战昆墟宗的对手。".repeat(16)}` },
        { number: 4, content: `${"雨水顺着铁檐砸在青石板上，刀锋出鞘时带起一线寒光，脚步在泥水里猛地一错，反手格开迎面劈来的重击，呼吸压得极低。".repeat(7)}` },
      ],
    });
    const cleanSample = job.samples.find((s) => s.id.startsWith("sample-4-"));
    const namedSample = job.samples.find((s) => s.id.startsWith("sample-1-"));
    expect(cleanSample?.transfer).toBe("transferable");
    expect(namedSample?.transfer).toBe("source-only");
    expect(namedSample?.evidence).toContain("仅学节奏笔法，禁抄专名");
  });
});
