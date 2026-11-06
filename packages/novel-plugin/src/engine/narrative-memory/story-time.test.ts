import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { describe, expect, it } from "vitest";

import { createBookRepository } from "../jingwei/repositories/book-repo.js";
import {
  buildStoryTimeline,
  parseChineseNumber,
  parseRelativeOffsetDays,
  parseStoryTimeAnchorDrafts,
  readStoryTimeline,
  replaceChapterStoryTimeAnchors,
  type StoryTimeAnchorDraft,
  type StoryTimeAnchorRecord,
} from "./story-time.js";
import { runConsistencyCheck } from "./consistency-detect.js";
import { insertNarrativeEvent } from "./storage.js";

async function createSceneStorage(): Promise<{ storage: StorageDatabase; cleanup: () => Promise<void> }> {
  const dir = join(tmpdir(), `novelfork-story-time-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  const now = new Date("2026-06-22T00:00:00.000Z");
  await createBookRepository(storage).create({ id: "book-1", name: "测试书", jingweiMode: "dynamic", currentChapter: 1, createdAt: now, updatedAt: now });
  return {
    storage,
    cleanup: async () => {
      storage.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function anchor(chapterNumber: number, ordinal: number, draft: StoryTimeAnchorDraft): StoryTimeAnchorRecord {
  return { ...draft, id: `a-${chapterNumber}-${ordinal}`, bookId: "book-1", chapterNumber, ordinal };
}

describe("时间说法解析", () => {
  it("中文数字", () => {
    expect(parseChineseNumber("三")).toBe(3);
    expect(parseChineseNumber("十五")).toBe(15);
    expect(parseChineseNumber("二十三")).toBe(23);
    expect(parseChineseNumber("一百零八")).toBe(108);
    expect(parseChineseNumber("12")).toBe(12);
    expect(parseChineseNumber("几")).toBeUndefined();
  });

  it("相对时间读出天数", () => {
    expect(parseRelativeOffsetDays("三天后")).toBe(3);
    expect(parseRelativeOffsetDays("次日清晨")).toBe(1);
    expect(parseRelativeOffsetDays("半个月过去")).toBe(15);
    expect(parseRelativeOffsetDays("十年之后")).toBe(3600);
    expect(parseRelativeOffsetDays("两个月后")).toBe(60);
    expect(parseRelativeOffsetDays("当夜")).toBe(0);
    expect(parseRelativeOffsetDays("后来")).toBeUndefined();
  });

  it("抽取结果校验：证据必须是原文，天数读不出丢弃", () => {
    const content = "三天后，韩立下山。天元三年春，宗门开榜。三日后决战。十六岁的韩立站在台上。";
    const warnings: string[] = [];
    const drafts = parseStoryTimeAnchorDrafts([
      { kind: "relative", expression: "三天后", evidenceText: "三天后，韩立下山。", confidence: 0.9 },
      { kind: "absolute", expression: "天元三年春", evidenceText: "天元三年春，宗门开榜。", calendar: { era: "天元", year: 3, season: "春" } },
      { kind: "deadline", expression: "三日后决战", evidenceText: "三日后决战。", event: "决战" },
      { kind: "age", expression: "十六岁", evidenceText: "十六岁的韩立", subject: "韩立", age: 16 },
      { kind: "relative", expression: "后来", evidenceText: "三天后" },
      { kind: "relative", expression: "五天后", evidenceText: "不在正文里" },
      { kind: "weird", expression: "x", evidenceText: "三天后" },
    ], content, warnings);
    expect(drafts.map((draft) => draft.kind)).toEqual(["relative", "absolute", "deadline", "age"]);
    expect(drafts[0]!.offsetDays).toBe(3);
    expect(drafts[2]).toMatchObject({ offsetDays: 3, event: "决战" });
    expect(warnings.join("")).toContain("丢弃了 3 条");
  });
});

describe("时间轴推算", () => {
  it("相对锚按上一锚累积，历法出现后对齐并给出历法说法，推算链可读", () => {
    const timeline = buildStoryTimeline({
      bookId: "book-1",
      anchors: [
        anchor(1, 0, { kind: "relative", expression: "次日", evidenceText: "次日", confidence: 0.9 }),
        anchor(2, 0, { kind: "absolute", expression: "天元三年春", evidenceText: "天元三年春", confidence: 0.9, calendar: { era: "天元", year: 3, season: "春" } }),
        anchor(3, 0, { kind: "relative", expression: "三个月后", evidenceText: "三个月后", confidence: 0.8, offsetDays: 90 }),
        anchor(4, 0, { kind: "absolute", expression: "入冬", evidenceText: "入冬", confidence: 0.7, calendar: { season: "冬" } }),
      ],
    });
    expect(timeline.points.map((point) => point.storyDay)).toEqual([1, 1, 91, 271]);
    expect(timeline.points[2]!.derivation).toContain("+ 90 日");
    expect(timeline.points[2]!.calendarLabel).toContain("天元3年");
    expect(timeline.currentLabel).toContain("天元3年");
    expect(timeline.currentLabel).toContain("10月");
    expect(timeline.points.every((point, index, all) => index === 0 || point.storyDay >= all[index - 1]!.storyDay)).toBe(true);
    expect(timeline.conflicts).toEqual([]);
  });

  it("季节早于当前时推算为次年，置信度打折", () => {
    const timeline = buildStoryTimeline({
      bookId: "book-1",
      anchors: [
        anchor(1, 0, { kind: "absolute", expression: "天元三年秋", evidenceText: "x", confidence: 1, calendar: { era: "天元", year: 3, season: "秋" } }),
        anchor(2, 0, { kind: "absolute", expression: "开春", evidenceText: "x", confidence: 1, calendar: { season: "春" } }),
      ],
    });
    expect(timeline.points[1]!.storyDay).toBe(180);
    expect(timeline.points[1]!.derivation).toContain("次年");
    expect(timeline.points[1]!.confidence).toBeLessThan(1);
  });

  it("历法倒流只告警，时间轴不回退", () => {
    const timeline = buildStoryTimeline({
      bookId: "book-1",
      anchors: [
        anchor(1, 0, { kind: "absolute", expression: "天元五年", evidenceText: "天元五年", confidence: 0.9, calendar: { era: "天元", year: 5 } }),
        anchor(5, 0, { kind: "absolute", expression: "天元三年", evidenceText: "天元三年，雪", confidence: 0.9, calendar: { era: "天元", year: 3 } }),
        anchor(6, 0, { kind: "relative", expression: "次日", evidenceText: "次日", confidence: 0.9 }),
      ],
    });
    expect(timeline.conflicts.map((conflict) => conflict.kind)).toEqual(["time-reversal"]);
    expect(timeline.conflicts[0]!.chapterNumber).toBe(5);
    expect(timeline.conflicts[0]!.explanation.suggestedAction).toContain("倒叙");
    expect(timeline.points.map((point) => point.storyDay)).toEqual([0, 0, 1]);
  });

  it("年龄与经过的年数对不上时告警；对得上不报", () => {
    const ok = buildStoryTimeline({
      bookId: "book-1",
      anchors: [
        anchor(1, 0, { kind: "age", expression: "十六岁", evidenceText: "x", confidence: 0.9, subject: "韩立", age: 16 }),
        anchor(2, 0, { kind: "relative", expression: "十年后", evidenceText: "x", confidence: 0.9, offsetDays: 3600 }),
        anchor(3, 0, { kind: "age", expression: "二十六岁", evidenceText: "x", confidence: 0.9, subject: "韩立", age: 26 }),
      ],
    });
    expect(ok.conflicts).toEqual([]);
    const bad = buildStoryTimeline({
      bookId: "book-1",
      anchors: [
        anchor(1, 0, { kind: "age", expression: "十六岁", evidenceText: "x", confidence: 0.9, subject: "韩立", age: 16 }),
        anchor(2, 0, { kind: "relative", expression: "三天后", evidenceText: "x", confidence: 0.9, offsetDays: 3 }),
        anchor(3, 0, { kind: "age", expression: "二十岁", evidenceText: "二十岁的韩立", confidence: 0.9, subject: "韩立", age: 20 }),
      ],
    });
    expect(bad.conflicts).toHaveLength(1);
    expect(bad.conflicts[0]).toMatchObject({ kind: "time-age-mismatch", entity: "韩立", chapterNumber: 3, otherChapter: 1 });
  });

  it("「与此同时」的两章同一人所在不同 → 两地告警", () => {
    const timeline = buildStoryTimeline({
      bookId: "book-1",
      anchors: [
        anchor(7, 0, { kind: "relative", expression: "次日", evidenceText: "x", confidence: 0.9 }),
        anchor(8, 0, { kind: "simultaneous", expression: "与此同时", evidenceText: "与此同时", confidence: 0.9 }),
      ],
      locations: [
        { chapterNumber: 7, subject: "韩立", location: "七玄门", evidenceText: "韩立回到七玄门" },
        { chapterNumber: 8, subject: "韩立", location: "黄枫谷", evidenceText: "韩立在黄枫谷" },
        { chapterNumber: 8, subject: "厉飞雨", location: "黄枫谷", evidenceText: "厉飞雨在黄枫谷" },
      ],
    });
    expect(timeline.conflicts.map((conflict) => [conflict.kind, conflict.entity, conflict.otherChapter])).toEqual([["time-two-places", "韩立", 7]]);
  });

  it("约定时间：记下约定日与剩余天数", () => {
    const timeline = buildStoryTimeline({
      bookId: "book-1",
      anchors: [
        anchor(1, 0, { kind: "deadline", expression: "三日后决战", evidenceText: "三日后决战", confidence: 0.9, offsetDays: 3, event: "决战" }),
        anchor(2, 0, { kind: "relative", expression: "次日", evidenceText: "x", confidence: 0.9 }),
      ],
    });
    expect(timeline.promises).toHaveLength(1);
    expect(timeline.promises[0]).toMatchObject({ event: "决战", madeOnDay: 0, dueDay: 3, daysLeft: 2 });
  });
});

describe("落库与体检", () => {
  it("按章整批替换、截至章读取，矛盾进叙事体检且可被忽略键识别", async () => {
    const { storage, cleanup } = await createSceneStorage();
    try {
      replaceChapterStoryTimeAnchors(storage, "book-1", 1, [
        { kind: "absolute", expression: "天元五年", evidenceText: "天元五年", confidence: 0.9, calendar: { era: "天元", year: 5 } },
      ]);
      replaceChapterStoryTimeAnchors(storage, "book-1", 2, [
        { kind: "absolute", expression: "天元三年", evidenceText: "天元三年", confidence: 0.9, calendar: { era: "天元", year: 3 } },
      ]);
      expect(readStoryTimeline(storage, "book-1").conflicts).toHaveLength(1);
      expect(readStoryTimeline(storage, "book-1", 1).conflicts).toHaveLength(0);

      const check = await runConsistencyCheck(storage, { bookId: "book-1" });
      const timeFinding = check.findings.find((finding) => finding.kind === "time-reversal");
      expect(timeFinding?.ignoreKey).toMatchObject({ kind: "time-reversal", chapterNumber: 2, factId: "story-time:book-1:2:0" });

      // 重新结算第 2 章改成天元六年：整章替换，矛盾消失
      replaceChapterStoryTimeAnchors(storage, "book-1", 2, [
        { kind: "absolute", expression: "天元六年", evidenceText: "天元六年", confidence: 0.9, calendar: { era: "天元", year: 6 } },
      ]);
      const after = readStoryTimeline(storage, "book-1");
      expect(after.conflicts).toEqual([]);
      expect(after.points).toHaveLength(2);
    } finally {
      await cleanup();
    }
  });

  it("两地检测读本章与前一章的所在事件", async () => {
    const { storage, cleanup } = await createSceneStorage();
    try {
      const event = (id: string, chapter: number, location: string) => insertNarrativeEvent(storage, {
        id, bookId: "book-1", chapterNumber: chapter, eventType: "location_changed", subject: "韩立", predicate: "所在", object: location,
        evidenceText: `韩立到了${location}`, confidence: 0.9, source: "settle", status: "applied", riskLevel: "low", createdAt: "2026-06-22T00:00:00.000Z",
      });
      event("e7", 7, "七玄门");
      event("e8", 8, "黄枫谷");
      replaceChapterStoryTimeAnchors(storage, "book-1", 8, [{ kind: "simultaneous", expression: "与此同时", evidenceText: "与此同时", confidence: 0.9 }]);
      const timeline = readStoryTimeline(storage, "book-1");
      expect(timeline.conflicts.map((conflict) => conflict.kind)).toEqual(["time-two-places"]);
    } finally {
      await cleanup();
    }
  });
});
