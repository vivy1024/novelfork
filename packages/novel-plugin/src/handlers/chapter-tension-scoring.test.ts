import { describe, expect, it } from "vitest";
import { scoreChapterTension } from "./chapter-tension-scoring";

const input = { chapterNumber: 3, content: "他拔出剑。" };

describe("scoreChapterTension", () => {
  it("给模型足够的输出预算，不再卡在 160 token", async () => {
    let seen: number | undefined;
    await scoreChapterTension(input, async (request) => {
      seen = request.maxTokens;
      return { text: '{"plot_tension":70,"emotional_tension":60,"pacing_tension":80}' };
    });
    expect(seen).toBeGreaterThanOrEqual(512);
  });

  it("带前缀的回复仍能解析出评分", async () => {
    const result = await scoreChapterTension(input, async () => ({
      text: 'Dimensions:\n{"plot_tension":72,"emotional_tension":65,"pacing_tension":80}',
    }));
    expect(result.status).toBe("evaluated");
  });

  it("输出被截断时说明原因，而不是只说找不到 JSON", async () => {
    const result = await scoreChapterTension(input, async () => ({ text: "Dimensions:\n- plot", outputTruncated: true }));
    expect(result).toMatchObject({ status: "unevaluated" });
    expect((result as { reason: string }).reason).toContain("截断");
  });

  it("调用抛错时收敛为未评估，不向上抛", async () => {
    const result = await scoreChapterTension(input, async () => {
      throw new Error("boom");
    });
    expect(result).toMatchObject({ status: "unevaluated", reason: "boom" });
  });
});
