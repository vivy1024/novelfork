import { describe, expect, it } from "vitest";
import { filterFactsAsOfChapter, type EntityFact } from "./narrative-fact-edits";

describe("filterFactsAsOfChapter 时态切片过滤", () => {
  const sampleFacts: EntityFact[] = [
    {
      id: "fact-1",
      subject: "林动",
      predicate: "位于",
      object: "青阳镇",
      category: "location",
      validFromChapter: 1,
      validUntilChapter: 20,
    },
    {
      id: "fact-2",
      subject: "林动",
      predicate: "位于",
      object: "炎城",
      category: "location",
      validFromChapter: 21,
      validUntilChapter: 50,
    },
    {
      id: "fact-3",
      subject: "林动",
      predicate: "持有",
      object: "神秘祖石",
      category: "possession",
      validFromChapter: 5,
      // validUntilChapter undefined/null -> 一直生效
    },
    {
      id: "fact-4",
      subject: "林动",
      predicate: "修为",
      object: "死玄境",
      category: "realm",
      validFromChapter: 80,
    },
  ];

  it("当不传 asOfChapter 时返回全量事实作为 live 集合", () => {
    const result = filterFactsAsOfChapter(sampleFacts, undefined);
    expect(result.live).toHaveLength(4);
    expect(result.expired).toHaveLength(0);
    expect(result.upcoming).toHaveLength(0);
  });

  it("在第 10 章时，青阳镇与祖石为 live，炎城与死玄境为 upcoming，无 expired", () => {
    const result = filterFactsAsOfChapter(sampleFacts, 10);
    const liveIds = result.live.map((f) => f.id);
    const expiredIds = result.expired.map((f) => f.id);
    const upcomingIds = result.upcoming.map((f) => f.id);

    expect(liveIds).toContain("fact-1"); // 青阳镇
    expect(liveIds).toContain("fact-3"); // 祖石
    expect(liveIds).not.toContain("fact-2");
    expect(liveIds).not.toContain("fact-4");

    expect(expiredIds).toHaveLength(0);
    expect(upcomingIds).toEqual(["fact-2", "fact-4"]);
  });

  it("在第 30 章时，青阳镇已过期(expired)，炎城与祖石为 live，死玄境为 upcoming", () => {
    const result = filterFactsAsOfChapter(sampleFacts, 30);
    const liveIds = result.live.map((f) => f.id);
    const expiredIds = result.expired.map((f) => f.id);
    const upcomingIds = result.upcoming.map((f) => f.id);

    expect(expiredIds).toEqual(["fact-1"]); // 青阳镇 (validUntil 20 <= 30)
    expect(liveIds).toEqual(["fact-2", "fact-3"]); // 炎城 & 祖石
    expect(upcomingIds).toEqual(["fact-4"]); // 死玄境 (validFrom 80 > 30)
  });

  it("在第 100 章时，青阳镇与炎城均已过期，祖石与死玄境均为 live", () => {
    const result = filterFactsAsOfChapter(sampleFacts, 100);
    const liveIds = result.live.map((f) => f.id);
    const expiredIds = result.expired.map((f) => f.id);
    const upcomingIds = result.upcoming.map((f) => f.id);

    expect(expiredIds).toEqual(["fact-1", "fact-2"]);
    expect(liveIds).toEqual(["fact-3", "fact-4"]);
    expect(upcomingIds).toHaveLength(0);
  });
});
