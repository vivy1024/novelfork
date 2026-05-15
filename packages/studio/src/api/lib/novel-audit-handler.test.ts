import { describe, expect, it, vi } from "vitest";

import { executeNovelAudit, type NovelAuditInput } from "@vivy1024/novelfork-novel-plugin/handlers";

describe("/novel:audit handler", () => {
  it("runs continuity audit and returns findings", async () => {
    const auditEngine = vi.fn().mockResolvedValue({
      ok: true,
      findings: [
        { type: "contradiction", severity: "high", description: "第三章主角使用了第五章才获得的法宝", chapters: ["ch-3", "ch-5"] },
        { type: "setting-conflict", severity: "medium", description: "宗门名称前后不一致：青云宗 vs 清云宗", chapters: ["ch-1", "ch-4"] },
      ],
      summary: "发现 2 个问题：1 个矛盾、1 个设定冲突",
    });

    const result = await executeNovelAudit({ bookId: "book-1", auditEngine });

    expect(result.ok).toBe(true);
    expect(result.findings).toHaveLength(2);
    expect(result.findings![0]).toMatchObject({ type: "contradiction", severity: "high" });
    expect(result.summary).toContain("2 个问题");
  });

  it("returns empty findings for clean books", async () => {
    const auditEngine = vi.fn().mockResolvedValue({
      ok: true,
      findings: [],
      summary: "未发现连续性问题",
    });

    const result = await executeNovelAudit({ bookId: "book-clean", auditEngine });

    expect(result.ok).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it("handles audit engine failure gracefully", async () => {
    const auditEngine = vi.fn().mockRejectedValue(new Error("Storage not initialized"));

    const result = await executeNovelAudit({ bookId: "book-broken", auditEngine });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Storage");
  });
});
