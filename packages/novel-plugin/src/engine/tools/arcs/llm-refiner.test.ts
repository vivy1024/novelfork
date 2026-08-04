import { describe, expect, it } from "vitest";
import { refineBeatsWithLlm } from "./llm-refiner.js";

const characters = [{ id: "c1", name: "林舟", aliases: [] }];
const ruleBeats = [{ chapter: 3, event: "林舟面对守门人", change: "冲突", direction: "neutral" as const, source: "auto-rule" as const }];

describe("refineBeatsWithLlm", () => {
  it("uses the Runtime generator and normalizes the returned beats", async () => {
    const result = await refineBeatsWithLlm(
      "林舟停在山门前。",
      characters,
      ruleBeats,
      3,
      async () => ({
        text: "```json\n[{\"chapter\":99,\"event\":\"林舟拒绝退让\",\"change\":\"意志增强\",\"direction\":\"advance\",\"confidence\":1.4}]\n```",
      }),
    );

    expect(result.refined).toBe(true);
    expect(result.warning).toBeUndefined();
    expect(result.beats).toEqual([{
      chapter: 3,
      event: "林舟拒绝退让",
      change: "意志增强",
      direction: "advance",
      source: "auto-llm",
      confidence: 1,
    }]);
  });

  it("fails closed to rule beats when the Runtime generator is unavailable", async () => {
    const result = await refineBeatsWithLlm("正文", characters, ruleBeats, 3);

    expect(result.refined).toBe(false);
    expect(result.beats).toEqual(ruleBeats);
    expect(result.warning).toContain("未提供当前 Runtime 文本模型");
  });

  it("fails closed when the model returns invalid JSON", async () => {
    const result = await refineBeatsWithLlm(
      "正文",
      characters,
      ruleBeats,
      3,
      async () => ({ text: "不是 JSON" }),
    );

    expect(result.refined).toBe(false);
    expect(result.beats).toEqual(ruleBeats);
    expect(result.warning).toContain("LLM 精修失败");
  });
});
