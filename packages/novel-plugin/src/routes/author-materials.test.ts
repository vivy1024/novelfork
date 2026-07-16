import { describe, expect, it } from "vitest";

import {
  AUTHOR_REVIEW_FILES,
  buildRadarReviewMarkdown,
  buildWebCaptureReviewMarkdown,
} from "./author-materials.js";

describe("author review materials", () => {
  it("keeps captured web material in the author-review boundary", () => {
    const markdown = buildWebCaptureReviewMarkdown({
      title: "修仙题材研究",
      excerpt: "摘要",
      content: "正文摘录",
      sourceUrl: "https://example.test/research",
      perspective: "genre",
      notes: "仅供作者审核",
      capturedAt: "2026-07-13T00:00:00.000Z",
    });

    expect(AUTHOR_REVIEW_FILES.webCapture).toBe("web_materials.md");
    expect(markdown).toContain("# 网页素材采风夹");
    expect(markdown).toContain("不会自动写入故事经纬");
    expect(markdown).toContain("正文摘录");
  });

  it("renders review-only market recommendations without mutating lore", () => {
    const markdown = buildRadarReviewMarkdown({
      marketSummary: "读者偏好高张力升级节奏。",
      recommendations: [{
        confidence: 0.8,
        platform: "起点",
        genre: "仙侠",
        concept: "宗门逆袭",
        reasoning: "具备持续冲突",
        benchmarkTitles: ["示例作品"],
      }],
    }, "2026-07-13T00:00:00.000Z");

    expect(markdown).toContain("宗门逆袭");
    expect(markdown).toContain("示例作品");
    expect(markdown).toContain("不会自动写入故事经纬");
  });
});
