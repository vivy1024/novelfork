/**
 * 层级前情落盘（卷摘要 / 全书梗概）：
 *   - 生成只读章摘要、均匀覆盖、回指章号；结算后排队触发、不阻塞结算；
 *   - 落盘带来源章号与指纹，章摘要改了即判过期；
 *   - 召回优先用落盘版本并标注待确认，缺失或过期时退回机械派生；
 *   - 多条「卷纲」时确定性选择；
 *   - 存量回填 dryRun / apply。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { settleConfirmedChapter } from "../../handlers/chapter-settlement-service.js";
import {
  loadCurrentVolumeContext,
  selectAuthoritativeVolumeOutline,
  selectVolumeOutlineEntry,
} from "../../handlers/outline-volume.js";
import { createNarrativeMemoryRouter } from "../../routes/narrative-memory.js";
import { createStoryJingweiEntryRepository } from "../jingwei/repositories/entry-repo.js";
import {
  chapterSummaryFingerprint,
  confirmArcSummary,
  getArcSummary,
  isArcSummaryFresh,
  listArcSummaries,
  synopsisSegmentId,
} from "./arc-summary-store.js";
import {
  backfillArcSummaries,
  drainArcSummaryQueue,
  planArcSummaries,
  runArcSummaryGeneration,
  type ArcSummaryGenerateText,
} from "./arc-summary-service.js";
import { buildNarrativeContext } from "./build-narrative-context.js";
import { loadConfirmedChapterSummaries } from "./chapter-summary-source.js";
import {
  createLongBookStorage,
  LONG_BOOK_ID,
  seedChapterSummaries,
  seedVolumeOutline,
  type LongBookHandle,
} from "./long-book-fixture.js";
import { buildStoryArcCards } from "./story-arc.js";

const handles: LongBookHandle[] = [];

afterEach(async () => {
  await drainArcSummaryQueue();
  vi.restoreAllMocks();
  await Promise.all(handles.splice(0).map((handle) => handle.cleanup()));
});

async function book(): Promise<LongBookHandle> {
  const handle = await createLongBookStorage("novelfork-arc-summary");
  handles.push(handle);
  return handle;
}

type Prompt = { system: string; user: string };

function promptOf(request: Parameters<ArcSummaryGenerateText>[0]): Prompt {
  return {
    system: request.messages.find((message) => message.role === "system")?.content ?? "",
    user: request.messages.find((message) => message.role === "user")?.content ?? "",
  };
}

function chaptersIn(text: string): number[] {
  return [...new Set([...text.matchAll(/第(\d+)章/gu)].map((match) => Number(match[1])))].sort((a, b) => a - b);
}

/** 从输入里均匀挑首 / 中 / 尾三章，作为假模型的「关键章」。 */
function evenPicks(chapters: readonly number[]): number[] {
  if (chapters.length <= 3) return [...chapters];
  return [...new Set([chapters[0]!, chapters[Math.floor(chapters.length / 2)]!, chapters.at(-1)!])];
}

/**
 * 假文本模型：只按提示词里给出的内容作答，便于断言「模型看到了哪些章」。
 *   - 卷摘要 / 分段：summary 里写首、中、尾三章的章号；
 *   - 全书梗概：每卷一行，写该卷关键章。
 */
function createFakeModel(options: { failOn?: (prompt: Prompt) => boolean } = {}) {
  const prompts: Prompt[] = [];
  const generateText: ArcSummaryGenerateText = async (request) => {
    const prompt = promptOf(request);
    prompts.push(prompt);
    if (options.failOn?.(prompt)) throw new Error("模型暂时不可用");
    if (prompt.system.includes("全书梗概整理器")) {
      const blocks = prompt.user.split("\n").filter((line) => line.startsWith("【"));
      const lines = blocks.map((block) => {
        const title = /^【([^·]+)·/u.exec(block)?.[1] ?? "某卷";
        const keys = /关键章：([\d、]+)/u.exec(block)?.[1]?.split("、").map(Number) ?? [];
        return `${title}：${keys.map((chapter) => `第${chapter}章`).join("、")}有转折。`;
      });
      return { text: JSON.stringify({ summary: lines.join(""), gist: `共 ${blocks.length} 卷`, keyChapters: [] }), model: "fake:arc" };
    }
    if (prompt.system.includes("卷摘要整理器") || prompt.system.includes("分段摘要整理器")) {
      const header = prompt.user.split("\n")[0] ?? "";
      const listed = prompt.user.split("\n").slice(1).join("\n");
      // 合并轮的输入是分段摘要（带关键章），否则是逐章摘要。
      const merged = [...listed.matchAll(/关键章：([\d、]+)/gu)].flatMap((match) => match[1]!.split("、").map(Number));
      const chapters = merged.length > 0 ? merged : chaptersIn(listed);
      const picks = merged.length > 0 ? merged : evenPicks(chapters);
      return {
        text: JSON.stringify({
          summary: `${header.slice(0, 40)}：${picks.map((chapter) => `第${chapter}章`).join("、")}依次推进。`,
          gist: `${header.slice(0, 30)}一句话`,
          keyChapters: [...picks, 99999],
        }),
        model: "fake:arc",
      };
    }
    if (prompt.system.includes("章节摘要器")) return { text: JSON.stringify({ summary: "主角抵达卷末，局势收束。" }) };
    if (prompt.system.includes("张力评分器")) return { text: '{"plot_tension":60,"emotional_tension":55,"pacing_tension":50}' };
    return { text: "" };
  };
  return { generateText, prompts };
}

function setChapterSummary(handle: LongBookHandle, chapter: number, summary: string): void {
  handle.storage.sqlite.prepare(`
    UPDATE story_jingwei_entry SET fields_json = json_set(fields_json, '$.summary', ?) WHERE book_id = ? AND id = ?
  `).run(summary, LONG_BOOK_ID, `sum-${chapter}`);
}

function arcCards(cards: readonly { tags: readonly string[] }[]) {
  return cards.filter((card) => card.tags.includes("story-arc"));
}

describe("卷摘要生成与落盘", () => {
  it("只读章摘要生成，记来源章号与指纹，默认待确认；关键章只保留来源里有的", async () => {
    const handle = await book();
    await seedChapterSummaries(handle.storage, 100);
    await seedVolumeOutline(handle.storage, 4, 50);
    const model = createFakeModel();

    const result = await runArcSummaryGeneration({ storage: handle.storage, bookId: LONG_BOOK_ID, generateText: model.generateText });
    expect(result.failed).toEqual([]);
    const record = getArcSummary(handle.storage, LONG_BOOK_ID, "volume", "vol-1")!;
    expect(record).toMatchObject({ status: "needs-review", chapterFrom: 1, chapterTo: 50, model: "fake:arc" });
    expect(record.sourceChapters).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
    expect(record.content.keyChapters).toEqual([1, 26, 50]);
    const rows = loadConfirmedChapterSummaries(handle.storage, LONG_BOOK_ID);
    expect(record.inputFingerprint).toBe(chapterSummaryFingerprint(rows.filter((row) => row.chapter <= 50)));
    // 输入是章摘要而不是正文：提示词里带的是每章摘要
    const volumePrompt = model.prompts.find((prompt) => prompt.user.startsWith("《第1卷》"))!;
    expect(volumePrompt.user).toContain("第1章《章1》：第1章要事");
    expect(volumePrompt.system).toContain("开头、中段、结尾");
  });

  it("超过 60 章的卷先分段归纳再合并，后半卷不会被截掉", async () => {
    const handle = await book();
    await seedChapterSummaries(handle.storage, 121);
    await seedVolumeOutline(handle.storage, 2, 120);
    const model = createFakeModel();
    await runArcSummaryGeneration({ storage: handle.storage, bookId: LONG_BOOK_ID, generateText: model.generateText });
    const record = getArcSummary(handle.storage, LONG_BOOK_ID, "volume", "vol-1")!;
    expect(model.prompts.filter((prompt) => prompt.system.includes("分段摘要整理器"))).toHaveLength(3);
    // 三段各贡献首 / 中 / 尾，合并后覆盖全卷
    expect(Math.max(...record.content.keyChapters)).toBe(120);
    expect(record.content.keyChapters.some((chapter) => chapter > 40 && chapter <= 80)).toBe(true);
  });

  it("章摘要改了：结算标过期 + 指纹判过期；回填只重算这一卷", async () => {
    const handle = await book();
    await seedChapterSummaries(handle.storage, 100);
    await seedVolumeOutline(handle.storage, 4, 50);
    const model = createFakeModel();
    await runArcSummaryGeneration({ storage: handle.storage, bookId: LONG_BOOK_ID, generateText: model.generateText });
    const before = getArcSummary(handle.storage, LONG_BOOK_ID, "volume", "vol-2")!;
    confirmArcSummary(handle.storage, LONG_BOOK_ID, before.id);

    setChapterSummary(handle, 70, "第70章改写：主角改投别派。");
    const rows = loadConfirmedChapterSummaries(handle.storage, LONG_BOOK_ID);
    expect(isArcSummaryFresh(before, rows, { from: 51, to: 100 })).toBe(false);
    expect(isArcSummaryFresh(getArcSummary(handle.storage, LONG_BOOK_ID, "volume", "vol-1")!, rows, { from: 1, to: 50 })).toBe(true);

    const dry = await backfillArcSummaries({ storage: handle.storage, bookId: LONG_BOOK_ID, dryRun: true });
    expect(dry.targets.filter((target) => target.state !== "fresh").map((target) => target.segmentId)).toEqual(["vol-2"]);

    const calls = model.prompts.length;
    await backfillArcSummaries({ storage: handle.storage, bookId: LONG_BOOK_ID, dryRun: false, generateText: model.generateText });
    expect(model.prompts.length).toBe(calls + 1);
    const after = getArcSummary(handle.storage, LONG_BOOK_ID, "volume", "vol-2")!;
    // 重新生成的内容回到待确认，作者此前的确认不沿用
    expect(after.status).toBe("needs-review");
    expect(isArcSummaryFresh(after, loadConfirmedChapterSummaries(handle.storage, LONG_BOOK_ID), { from: 51, to: 100 })).toBe(true);
  });

  it("当前卷每满 25 章生成阶段摘要；整卷写完后由整卷摘要替代", async () => {
    const handle = await book();
    await seedVolumeOutline(handle.storage, 2, 50);
    await seedChapterSummaries(handle.storage, 30);
    const model = createFakeModel();
    await runArcSummaryGeneration({ storage: handle.storage, bookId: LONG_BOOK_ID, generateText: model.generateText });
    expect(listArcSummaries(handle.storage, LONG_BOOK_ID).map((record) => record.segmentId)).toEqual(["vol-1@25"]);

    // 写第 31 章：本卷前情卡用阶段摘要（标待确认），第 26–27 章逐章补（28–30 留给近章）
    const arc = buildStoryArcCards({ storage: handle.storage, bookId: LONG_BOOK_ID, currentChapter: 31 });
    const current = arc.cards.find((card) => card.tags.includes("current-volume-summary"))!;
    expect(current.title).toContain("待确认");
    expect(current.tags).toContain("needs-review");
    expect(current.content).toContain("第26章：");
    expect(current.content).not.toContain("第28章：");

    for (let chapter = 31; chapter <= 50; chapter += 1) {
      await createStoryJingweiEntryRepository(handle.storage).create({
        id: `sum-${chapter}`, bookId: LONG_BOOK_ID, sectionId: "sec-summary", title: `第${chapter}章`, contentMd: "", summaryMd: "",
        tags: [], aliases: [], customFields: {}, relatedChapterNumbers: [chapter], relatedEntryIds: [], visibilityRule: { type: "nested" },
        participatesInAi: true, tokenBudget: null, priorityTier: "reference", importance: 40, summaryL0: "",
        createdAt: new Date(), updatedAt: new Date(), category: "chapter-summaries",
        fields: { chapterNumber: chapter, title: `章${chapter}`, summary: `第${chapter}章要事：继续推进。` },
      });
    }
    await runArcSummaryGeneration({ storage: handle.storage, bookId: LONG_BOOK_ID, generateText: model.generateText });
    expect(listArcSummaries(handle.storage, LONG_BOOK_ID).map((record) => record.segmentId)).toEqual(["vol-1"]);
  });
});

describe("召回：优先落盘摘要，缺失 / 过期回退机械派生", () => {
  it("有落盘卷摘要时卡片用它并标注待确认；确认后去掉标注；章摘要改了退回机械派生", async () => {
    const handle = await book();
    await seedChapterSummaries(handle.storage, 150);
    await seedVolumeOutline(handle.storage, 3, 50);

    const mechanical = buildStoryArcCards({ storage: handle.storage, bookId: LONG_BOOK_ID, currentChapter: 120 });
    const mechanicalCard = mechanical.cards.find((card) => card.tags.includes("volume-summary"))!;
    expect(mechanicalCard.tags).not.toContain("model-summary");
    expect(mechanicalCard.content).toContain("第1章：第1章要事");

    const model = createFakeModel();
    await runArcSummaryGeneration({ storage: handle.storage, bookId: LONG_BOOK_ID, generateText: model.generateText });
    const persisted = buildStoryArcCards({ storage: handle.storage, bookId: LONG_BOOK_ID, currentChapter: 120 });
    const vol1 = persisted.cards.find((card) => card.id.endsWith(":volume:vol-1"))!;
    expect(vol1.tags).toEqual(expect.arrayContaining(["model-summary", "needs-review"]));
    expect(vol1.title).toBe("卷摘要·第1卷（待确认）");
    expect(vol1.content).toContain("关键章：第1、26、50章");
    expect(vol1.reason).toContain("待作者确认");
    expect(vol1.sourceId).toBe(`arc:${LONG_BOOK_ID}:volume:vol-1`);

    confirmArcSummary(handle.storage, LONG_BOOK_ID, `arc:${LONG_BOOK_ID}:volume:vol-1`);
    const confirmed = buildStoryArcCards({ storage: handle.storage, bookId: LONG_BOOK_ID, currentChapter: 120 })
      .cards.find((card) => card.id.endsWith(":volume:vol-1"))!;
    expect(confirmed.title).toBe("卷摘要·第1卷");
    expect(confirmed.tags).toContain("confirmed");

    setChapterSummary(handle, 10, "第10章改写：师门覆灭。");
    const stale = buildStoryArcCards({ storage: handle.storage, bookId: LONG_BOOK_ID, currentChapter: 120 });
    const fallback = stale.cards.find((card) => card.id.endsWith(":volume:vol-1"))!;
    expect(fallback.tags).not.toContain("model-summary");
    expect(fallback.content).toContain("第10章：第10章改写");
    expect(stale.diagnostics.staleArcSummariesIgnored).toBe(1);
  });

  it("修旧章时不用覆盖到未来章节的落盘摘要（卷区间跨过当前章）", async () => {
    const handle = await book();
    await seedChapterSummaries(handle.storage, 150);
    await seedVolumeOutline(handle.storage, 3, 50);
    await runArcSummaryGeneration({ storage: handle.storage, bookId: LONG_BOOK_ID, generateText: createFakeModel().generateText });
    // 修第 40 章：第 1 卷是当前卷，整卷摘要覆盖到第 50 章，不能用
    const result = buildStoryArcCards({ storage: handle.storage, bookId: LONG_BOOK_ID, currentChapter: 40 });
    expect(result.cards.every((card) => !card.tags.includes("model-summary"))).toBe(true);
    expect(result.cards.flatMap((card) => chaptersIn(card.content)).every((chapter) => chapter < 40)).toBe(true);
  });

  it("预算紧时层级前情仍可降档，总量不超预算", async () => {
    const handle = await book();
    await seedChapterSummaries(handle.storage, 300);
    await seedVolumeOutline(handle.storage, 12, 25);
    await backfillArcSummaries({ storage: handle.storage, bookId: LONG_BOOK_ID, dryRun: false, generateText: createFakeModel().generateText });
    const pkg = await buildNarrativeContext({
      storage: handle.storage, bookId: LONG_BOOK_ID, purpose: "write_chapter", chapterNumber: 300, entities: [], maxTokens: 1200,
    });
    expect(pkg.diagnostics.totalEstimatedTokens).toBeLessThanOrEqual(1200);
    expect(pkg.cards.some((card) => card.channel === "recent-summary" && card.validFromChapter === 299)).toBe(true);
  });
});

describe("长篇覆盖（第 300 章，12 卷 × 25 章）", () => {
  /** 某卷在召回包里被提到的章，是否首 / 中 / 尾三段都有。 */
  function thirdsCovered(chapters: readonly number[], from: number, to: number): boolean[] {
    const span = (to - from + 1) / 3;
    return [0, 1, 2].map((part) => chapters.some((chapter) => chapter >= from + part * span && chapter < from + (part + 1) * span));
  }

  it("已写到第 299 章、回填后写第 300 章：被折叠进全书梗概的每一卷首 / 中 / 尾都有回指；机械派生只覆盖各卷开头", async () => {
    const handle = await book();
    await seedChapterSummaries(handle.storage, 299);
    await seedVolumeOutline(handle.storage, 12, 25);

    const before = buildStoryArcCards({ storage: handle.storage, bookId: LONG_BOOK_ID, currentChapter: 300 });
    const beforeSynopsis = before.cards.find((card) => card.tags.includes("book-synopsis"))!;
    expect(before.diagnostics.synopsisVolumes).toEqual(["vol-1", "vol-2", "vol-3", "vol-4", "vol-5", "vol-6"]);
    const beforeMentions = chaptersIn(beforeSynopsis.content);

    const dry = await backfillArcSummaries({ storage: handle.storage, bookId: LONG_BOOK_ID, dryRun: true });
    // 已写完的 11 卷整卷摘要 + 1 份全书梗概（截至第 6 卷）；第 12 卷只写了 24 章，不到阶段摘要的步长。dryRun 不写库
    expect(dry.toGenerate).toBe(12);
    expect(listArcSummaries(handle.storage, LONG_BOOK_ID)).toEqual([]);

    const applied = await backfillArcSummaries({ storage: handle.storage, bookId: LONG_BOOK_ID, dryRun: false, generateText: createFakeModel().generateText });
    expect(applied.failed).toEqual([]);
    expect(applied.generated).toHaveLength(12);
    expect(getArcSummary(handle.storage, LONG_BOOK_ID, "synopsis", synopsisSegmentId("vol-6"))).toMatchObject({ chapterFrom: 1, chapterTo: 150, status: "needs-review" });

    const after = buildStoryArcCards({ storage: handle.storage, bookId: LONG_BOOK_ID, currentChapter: 300 });
    const synopsis = after.cards.find((card) => card.tags.includes("book-synopsis"))!;
    expect(synopsis.tags).toContain("model-summary");
    expect(synopsis.title).toContain("待确认");
    const afterMentions = chaptersIn(synopsis.content);

    for (let volume = 0; volume < 6; volume += 1) {
      const from = volume * 25 + 1;
      const to = from + 24;
      expect(thirdsCovered(afterMentions, from, to)).toEqual([true, true, true]);
      // 机械派生：每卷只截了前 120 字，卷尾三分之一没有任何回指
      expect(thirdsCovered(beforeMentions, from, to)[2]).toBe(false);
    }
    // 前 5 卷（第 7–11 卷）各一张模型卷摘要卡
    const volumeCards = after.cards.filter((card) => card.tags.includes("volume-summary"));
    expect(volumeCards).toHaveLength(5);
    expect(volumeCards.every((card) => card.tags.includes("model-summary"))).toBe(true);
    // 召回包整体不出现第 300 章及以后
    expect(arcCards(after.cards).flatMap((card) => chaptersIn((card as { content: string }).content)).every((chapter) => chapter < 300)).toBe(true);

    // 再跑一次回填：全部最新，不再调模型
    const again = await backfillArcSummaries({ storage: handle.storage, bookId: LONG_BOOK_ID, dryRun: true });
    expect(again.toGenerate).toBe(0);
  });
});

describe("卷纲确定性选择", () => {
  const volumes = (count: number) => Array.from({ length: count }, (_, index) => ({
    id: `v${index + 1}`, title: `第${index + 1}卷`, chapterRange: { from: index * 10 + 1, to: (index + 1) * 10 },
  }));

  it("已确认优先，同状态取最近更新，再按 id；没有有效卷的跳过", () => {
    const pick = (candidates: Parameters<typeof selectAuthoritativeVolumeOutline>[0]) => selectAuthoritativeVolumeOutline(candidates).entry?.id;
    expect(pick([
      { id: "draft-new", status: "needs-review", updatedAt: 300, fields: { volumes: volumes(3) } },
      { id: "confirmed-old", status: "confirmed", updatedAt: 100, fields: { volumes: volumes(2) } },
    ])).toBe("confirmed-old");
    expect(pick([
      { id: "a", status: "confirmed", updatedAt: 100, fields: { volumes: volumes(2) } },
      { id: "b", status: "confirmed", updatedAt: 200, fields: { volumes: volumes(2) } },
    ])).toBe("b");
    expect(pick([
      { id: "b", status: "confirmed", updatedAt: 100, fields: { volumes: volumes(2) } },
      { id: "a", status: "confirmed", updatedAt: 100, fields: { volumes: volumes(2) } },
    ])).toBe("a");
    expect(pick([
      { id: "empty", status: "confirmed", updatedAt: 999, fields: { volumes: [] } },
      { id: "draft", status: "needs-review", updatedAt: 1, fields: { volumes: volumes(1) } },
    ])).toBe("draft");
  });

  it("库里有多条「卷纲」时与插入顺序无关，层级前情按选中的那条分卷", async () => {
    for (const order of ["confirmed-first", "draft-first"] as const) {
      const handle = await book();
      await seedChapterSummaries(handle.storage, 120);
      await seedVolumeOutline(handle.storage, 1, 120);
      handle.storage.sqlite.prepare(`UPDATE story_jingwei_entry SET status = 'needs-review', updated_at = ? WHERE id = 'outline-volumes'`).run(Date.now());
      const repo = createStoryJingweiEntryRepository(handle.storage);
      const insert = async (id: string, status: "confirmed" | "needs-review", count: number, updatedAt: number) => {
        await repo.create({
          id, bookId: LONG_BOOK_ID, sectionId: "sec-outline", title: "卷纲", contentMd: "", summaryMd: "", tags: [], aliases: [], customFields: {},
          relatedChapterNumbers: [], relatedEntryIds: [], visibilityRule: { type: "global" }, participatesInAi: true, tokenBudget: null,
          priorityTier: "reference", importance: 40, summaryL0: "", createdAt: new Date(updatedAt), updatedAt: new Date(updatedAt),
          category: "outline", status, fields: { volumes: Array.from({ length: count }, (_, index) => ({ id: `${id}-v${index + 1}`, title: `${id}第${index + 1}卷`, chapterRange: { from: index * 40 + 1, to: (index + 1) * 40 } })) },
        });
      };
      if (order === "confirmed-first") {
        await insert("outline-confirmed", "confirmed", 3, 1000);
        await insert("outline-draft", "needs-review", 2, 9000);
      } else {
        await insert("outline-draft", "needs-review", 2, 9000);
        await insert("outline-confirmed", "confirmed", 3, 1000);
      }
      const selection = selectVolumeOutlineEntry(handle.storage, LONG_BOOK_ID);
      expect(selection.entry?.id).toBe("outline-confirmed");
      expect(selection.candidates).toBe(3);
      expect(loadCurrentVolumeContext(handle.storage, LONG_BOOK_ID, 100).volumes.map((volume) => volume.id)).toEqual(["outline-confirmed-v1", "outline-confirmed-v2", "outline-confirmed-v3"]);
      expect(planArcSummaries(handle.storage, LONG_BOOK_ID).targets.map((target) => target.segmentId)).toEqual(["outline-confirmed-v1", "outline-confirmed-v2", "outline-confirmed-v3"]);
      await handle.cleanup();
      handles.splice(handles.indexOf(handle), 1);
    }
  });
});

describe("结算后触发，不阻塞结算", () => {
  const emptyExtractor = async () => [];

  it("卷末章结算后排队生成该卷卷摘要；模型一直不返回时结算照样完成", async () => {
    const handle = await book();
    await seedVolumeOutline(handle.storage, 2, 50);
    await seedChapterSummaries(handle.storage, 49);
    const model = createFakeModel();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const generateText: ArcSummaryGenerateText = async (request) => {
      if (promptOf(request).system.includes("卷摘要整理器")) await gate;
      return model.generateText(request);
    };

    const result = await settleConfirmedChapter(
      { bookId: LONG_BOOK_ID, chapterNumber: 50, title: "卷末", content: "主角抵达卷末。" },
      { storage: handle.storage, llmExtractor: emptyExtractor, kernelGenerateText: generateText },
    );
    expect(result.status).toBe("completed");
    // 结算返回时卷摘要还没生成（模型被卡住）
    expect(listArcSummaries(handle.storage, LONG_BOOK_ID)).toEqual([]);

    release();
    await drainArcSummaryQueue(LONG_BOOK_ID);
    const record = getArcSummary(handle.storage, LONG_BOOK_ID, "volume", "vol-1")!;
    expect(record).toMatchObject({ chapterFrom: 1, chapterTo: 50, status: "needs-review" });
    expect(record.sourceChapters).toHaveLength(50);
  });

  it("卷摘要生成失败只记日志，结算不受影响，也不出现结算告警；之后回填可补", async () => {
    const handle = await book();
    await seedVolumeOutline(handle.storage, 2, 50);
    await seedChapterSummaries(handle.storage, 49);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = createFakeModel({ failOn: (prompt) => prompt.system.includes("卷摘要整理器") });

    const result = await settleConfirmedChapter(
      { bookId: LONG_BOOK_ID, chapterNumber: 50, title: "卷末", content: "主角抵达卷末。" },
      { storage: handle.storage, llmExtractor: emptyExtractor, kernelGenerateText: failing.generateText },
    );
    expect(result.status).toBe("completed");
    expect(result.warnings.some((warning) => warning.includes("卷摘要"))).toBe(false);
    await drainArcSummaryQueue(LONG_BOOK_ID);
    expect(listArcSummaries(handle.storage, LONG_BOOK_ID)).toEqual([]);
    expect(warn.mock.calls.some((call) => String(call[0]).includes("层级前情生成失败"))).toBe(true);

    const retry = await backfillArcSummaries({ storage: handle.storage, bookId: LONG_BOOK_ID, dryRun: false, generateText: createFakeModel().generateText });
    expect(retry.generated).toContain("vol-1");
  });

  it("重结算改了某章摘要：覆盖它的卷摘要被标过期", async () => {
    const handle = await book();
    await seedVolumeOutline(handle.storage, 3, 50);
    await seedChapterSummaries(handle.storage, 120);
    await runArcSummaryGeneration({ storage: handle.storage, bookId: LONG_BOOK_ID, generateText: createFakeModel().generateText });
    const scheduler = vi.fn();
    await settleConfirmedChapter(
      { bookId: LONG_BOOK_ID, chapterNumber: 30, title: "改写", content: "主角改写了第三十章。" },
      { storage: handle.storage, llmExtractor: emptyExtractor, kernelGenerateText: createFakeModel().generateText, arcSummaryScheduler: scheduler },
    );
    expect(scheduler).toHaveBeenCalledTimes(1);
    expect(getArcSummary(handle.storage, LONG_BOOK_ID, "volume", "vol-1")!.status).toBe("stale");
    expect(getArcSummary(handle.storage, LONG_BOOK_ID, "volume", "vol-2")!.status).toBe("needs-review");
  });
});

describe("维护路由", () => {
  it("dryRun 只报告不写库；apply 用宿主模型生成；没有模型时 422；确认过期摘要被拒", async () => {
    const handle = await book();
    await seedVolumeOutline(handle.storage, 3, 50);
    await seedChapterSummaries(handle.storage, 130);
    const model = createFakeModel();
    const app = createNarrativeMemoryRouter({
      storage: handle.storage,
      resolveTextGeneration: async () => ({ available: true, generateText: model.generateText }),
    });
    const base = `http://localhost/api/books/${LONG_BOOK_ID}/narrative-memory/arc-summaries`;

    const dry = await (await app.request(`${base}/backfill?dryRun=1`, { method: "POST" })).json() as Record<string, unknown>;
    expect(dry).toMatchObject({ ok: true, dryRun: true, toGenerate: 3 });
    expect(model.prompts).toHaveLength(0);
    expect(listArcSummaries(handle.storage, LONG_BOOK_ID)).toEqual([]);

    const applied = await (await app.request(`${base}/backfill`, { method: "POST" })).json() as { ok: boolean; generated: string[]; summary: string };
    expect(applied.ok).toBe(true);
    expect(applied.generated).toEqual(["vol-1", "vol-2", "vol-3@125"]);
    expect(applied.summary).toContain("待确认");

    const list = await (await app.request(base)).json() as { records: Array<{ id: string; fresh: boolean }>; volumeOutline: { candidates: number } };
    expect(list.records.every((record) => record.fresh)).toBe(true);
    expect(list.volumeOutline.candidates).toBe(1);

    setChapterSummary(handle, 5, "第5章改写。");
    const rejected = await app.request(`${base}/${encodeURIComponent(`arc:${LONG_BOOK_ID}:volume:vol-1`)}/confirm`, { method: "POST" });
    expect(rejected.status).toBe(409);
    const ok = await app.request(`${base}/${encodeURIComponent(`arc:${LONG_BOOK_ID}:volume:vol-2`)}/confirm`, { method: "POST" });
    expect(ok.status).toBe(200);
    expect(getArcSummary(handle.storage, LONG_BOOK_ID, "volume", "vol-2")!.status).toBe("confirmed");

    const noModel = createNarrativeMemoryRouter({ storage: handle.storage });
    expect((await noModel.request(`${base}/backfill`, { method: "POST" })).status).toBe(422);
  });
});
