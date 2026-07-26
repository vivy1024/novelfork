import { describe, expect, it } from "vitest";

import { checkAuditFreshness, listStaleChapters } from "./audit-freshness";

const AUDIT = "2026-07-25T10:00:00.000Z";

describe("checkAuditFreshness", () => {
  it("正文未再修改时判 fresh", () => {
    const result = checkAuditFreshness({
      chapterUpdatedAt: "2026-07-25T09:59:00.000Z",
      auditedAt: AUDIT,
    });
    expect(result.freshness).toBe("fresh");
    expect(result.suggestedAction).toBe("无需动作。");
  });

  it("正文在审计后被改判 stale，并说明结论已失效", () => {
    const result = checkAuditFreshness({
      chapterUpdatedAt: "2026-07-25T11:30:00.000Z",
      auditedAt: AUDIT,
    });
    expect(result.freshness).toBe("stale");
    expect(result.whatHappened).toContain("1 小时");
    expect(result.whyItMatters).toContain("并不代表当前正文没问题");
    expect(result.suggestedAction).toContain("chapter.audit");
  });

  it("保存与审计几乎同时发生时不误判", () => {
    // 正文比审计晚 2 秒，属于同批写入的正常抖动
    const result = checkAuditFreshness({
      chapterUpdatedAt: "2026-07-25T10:00:02.000Z",
      auditedAt: AUDIT,
    });
    expect(result.freshness).toBe("fresh");
  });

  it("容差可配置", () => {
    const input = { chapterUpdatedAt: "2026-07-25T10:00:02.000Z", auditedAt: AUDIT };
    expect(checkAuditFreshness({ ...input, toleranceMs: 1000 }).freshness).toBe("stale");
    expect(checkAuditFreshness({ ...input, toleranceMs: 10_000 }).freshness).toBe("fresh");
  });

  it("从未审计时给出明确状态", () => {
    const result = checkAuditFreshness({ chapterUpdatedAt: AUDIT, auditedAt: null });
    expect(result.freshness).toBe("never-audited");
    expect(result.suggestedAction).toContain("chapter.audit");
  });

  it("拿不到正文时间时判 unknown 而不是假装通过", () => {
    const result = checkAuditFreshness({ chapterUpdatedAt: null, auditedAt: AUDIT });
    expect(result.freshness).toBe("unknown");
    expect(result.whyItMatters).toContain("未验证");
  });

  it("接受 Date 与毫秒数", () => {
    expect(checkAuditFreshness({
      chapterUpdatedAt: new Date("2026-07-25T12:00:00.000Z"),
      auditedAt: new Date(AUDIT),
    }).freshness).toBe("stale");
    expect(checkAuditFreshness({
      chapterUpdatedAt: Date.parse(AUDIT) - 1000,
      auditedAt: Date.parse(AUDIT),
    }).freshness).toBe("fresh");
  });

  it("非法时间字符串按拿不到处理，不抛异常", () => {
    expect(checkAuditFreshness({ chapterUpdatedAt: "不是时间", auditedAt: AUDIT }).freshness).toBe("unknown");
    expect(checkAuditFreshness({ chapterUpdatedAt: AUDIT, auditedAt: "坏数据" }).freshness).toBe("never-audited");
  });

  it("漂移时长按量级换算文案", () => {
    const cases: Array<[string, string]> = [
      ["2026-07-25T10:00:30.000Z", "秒"],
      ["2026-07-25T10:30:00.000Z", "分钟"],
      ["2026-07-25T15:00:00.000Z", "小时"],
      ["2026-07-30T10:00:00.000Z", "天"],
    ];
    for (const [updatedAt, unit] of cases) {
      const result = checkAuditFreshness({ chapterUpdatedAt: updatedAt, auditedAt: AUDIT });
      expect(result.freshness).toBe("stale");
      expect(result.whatHappened).toContain(unit);
    }
  });

  it("每种状态都带完整人话三段式", () => {
    const inputs = [
      { chapterUpdatedAt: AUDIT, auditedAt: AUDIT },
      { chapterUpdatedAt: "2026-07-26T10:00:00.000Z", auditedAt: AUDIT },
      { chapterUpdatedAt: AUDIT, auditedAt: null },
      { chapterUpdatedAt: null, auditedAt: AUDIT },
    ];
    for (const input of inputs) {
      const result = checkAuditFreshness(input);
      expect(result.whatHappened.length).toBeGreaterThan(5);
      expect(result.whyItMatters.length).toBeGreaterThan(5);
      expect(result.suggestedAction.length).toBeGreaterThan(2);
    }
  });
});

describe("listStaleChapters", () => {
  it("只返回过期章节", () => {
    const stale = listStaleChapters([
      { chapterNumber: 1, chapterUpdatedAt: "2026-07-25T09:00:00.000Z", auditedAt: AUDIT },
      { chapterNumber: 2, chapterUpdatedAt: "2026-07-25T12:00:00.000Z", auditedAt: AUDIT },
      { chapterNumber: 3, chapterUpdatedAt: AUDIT, auditedAt: null },
      { chapterNumber: 4, chapterUpdatedAt: "2026-07-26T10:00:00.000Z", auditedAt: AUDIT },
    ]);
    expect(stale.map((item) => item.chapterNumber)).toEqual([2, 4]);
    expect(stale[0]?.result.freshness).toBe("stale");
  });

  it("空输入返回空", () => {
    expect(listStaleChapters([])).toEqual([]);
  });

  it("容差透传", () => {
    const entries = [{ chapterNumber: 1, chapterUpdatedAt: "2026-07-25T10:00:02.000Z", auditedAt: AUDIT }];
    expect(listStaleChapters(entries, 1000)).toHaveLength(1);
    expect(listStaleChapters(entries, 10_000)).toHaveLength(0);
  });
});
