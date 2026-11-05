import { describe, expect, it } from "vitest";

import {
  dialogueBaselineText,
  makeInitialStyleDistillationJob,
  MAX_STYLE_DISTILLATION_CHARS,
  normalizeStyleDistillationSource,
  STYLE_BASELINE_LOW_DIALOGUE_RATIO,
  sampleSceneType,
  StyleDistillationError,
} from "./style-distillation.js";

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

describe("文风蒸馏来源正文的长度上限（T-07）", () => {
  it("超过 200 万字的正文报「参考正文过长」，不再误报成章节分割规则无效", () => {
    const error = capture(() => normalizeStyleDistillationSource({
      sourceName: "超长参考",
      text: `第一章 起\n${"字".repeat(2_000_001)}`,
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
});
