import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { handleChapterDiscardRange } from "../../handlers/chapter-discard-range.js";
import {
  buildPassageSnippet,
  ensureBookPassageIndexFresh,
  indexChapterPassages,
  passageQueryTerms,
  readPassageTexts,
  searchPassageCandidates,
  sharedCjkPhrases,
  sliceCodePoints,
  splitChapterIntoPassages,
  PASSAGE_MAX_CHARS,
} from "./chapter-passage-index.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function setup(): Promise<{ storage: StorageDatabase; bookRoot: string }> {
  const dir = await mkdtemp(join(tmpdir(), "novelfork-passage-index-"));
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  const bookRoot = join(dir, "book");
  await mkdir(join(bookRoot, "chapters", "卷01"), { recursive: true });
  cleanups.push(async () => {
    try {
      storage.close();
    } catch {
      // already closed
    }
    await rm(dir, { recursive: true, force: true });
  });
  return { storage, bookRoot };
}

function chapterPath(bookRoot: string, chapter: number): string {
  return join(bookRoot, "chapters", "卷01", `${String(chapter).padStart(4, "0")}_第${chapter}章.md`);
}

async function writeChapter(bookRoot: string, chapter: number, body: string): Promise<string> {
  const path = chapterPath(bookRoot, chapter);
  await writeFile(path, `# 第${chapter}章\n\n${body}`, "utf8");
  return path;
}

async function search(storage: StorageDatabase, bookId: string, query: string) {
  const { terms } = passageQueryTerms(query.split(/\s+/u));
  return searchPassageCandidates(storage, { bookId, phrases: terms.map((term) => term.phrase), mode: "all", limit: 20 });
}

describe("段落切分", () => {
  it("短段落合并成窗口，超长段落按上限硬切并留重叠，偏移能切回原文", () => {
    const shortParagraphs = Array.from({ length: 12 }, (_, index) => `第${index}段：${"山风吹过石阶。".repeat(8)}`);
    const longParagraph = "长".repeat(1500);
    const content = `---\ntitle: 测试\n---\n# 标题\n\n${shortParagraphs.join("\n\n")}\n\n${longParagraph}`;
    const spans = splitChapterIntoPassages(content);
    expect(spans.length).toBeGreaterThan(3);
    for (const span of spans) expect(span.end - span.start).toBeLessThanOrEqual(PASSAGE_MAX_CHARS);
    // frontmatter 不进索引
    expect(spans.some((span) => sliceCodePoints(content, span.start, span.end).includes("title:"))).toBe(false);
    // 第一个窗口凑够 300 字
    expect(spans[0]!.end - spans[0]!.start).toBeGreaterThanOrEqual(300);
    // 硬切的窗口之间有重叠
    const longSpans = spans.filter((span) => /^长+$/u.test(sliceCodePoints(content, span.start, span.end)));
    expect(longSpans.length).toBeGreaterThanOrEqual(3);
    expect(longSpans[1]!.start).toBeLessThan(longSpans[0]!.end);
  });

  it("偏移按码点计（含扩展区汉字与 emoji），与 chapter.read 同口径", () => {
    const content = `# 题\n\n𠀋前缀😀${"字".repeat(20)}铜镜在此`;
    const [span] = splitChapterIntoPassages(content);
    expect(sliceCodePoints(content, span!.start, span!.end)).toBe(`# 题\n\n𠀋前缀😀${"字".repeat(20)}铜镜在此`);
    const offset = Array.from(content).join("").indexOf("铜镜");
    const codePointOffset = Array.from(content.slice(0, offset)).length;
    expect(sliceCodePoints(content, codePointOffset, codePointOffset + 2)).toBe("铜镜");
    expect(codePointOffset).toBe(Array.from("# 题\n\n𠀋前缀😀").length + 20);
  });
});

describe("CJK 检索", () => {
  it("两字人名、三字地名、英文词都能命中；单字被忽略", async () => {
    const { storage } = await setup();
    indexChapterPassages(storage, "book-a", 3, "# 三\n\n韩立在太清门外遇见了 Lina，手里攥着一枚铜镜。");
    indexChapterPassages(storage, "book-a", 4, "# 四\n\n南宫婉独自守着药园。");
    expect((await search(storage, "book-a", "韩立")).map((hit) => hit.chapterNumber)).toEqual([3]);
    expect((await search(storage, "book-a", "太清门")).map((hit) => hit.chapterNumber)).toEqual([3]);
    expect((await search(storage, "book-a", "lina")).map((hit) => hit.chapterNumber)).toEqual([3]);
    expect((await search(storage, "book-a", "南宫婉 药园")).map((hit) => hit.chapterNumber)).toEqual([4]);
    expect(await search(storage, "book-a", "韩立 药园")).toEqual([]);
    expect(passageQueryTerms(["镜", "铜镜"]).ignored).toEqual(["镜"]);
  });

  it("按书隔离：别的书同名词不命中", async () => {
    const { storage } = await setup();
    indexChapterPassages(storage, "book-a", 1, "# 一\n\n青铜罗盘指向北方。");
    indexChapterPassages(storage, "book-b", 1, "# 一\n\n青铜罗盘碎了。");
    const hits = await search(storage, "book-b", "青铜罗盘");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.chapterNumber).toBe(1);
    const all = searchPassageCandidates(storage, { bookId: "book-a", phrases: passageQueryTerms(["罗盘"]).terms.map((t) => t.phrase), mode: "any", limit: 10 });
    expect(all).toHaveLength(1);
  });

  it("片段以命中词为中心并加【】，偏移指回原文", () => {
    const text = `${"甲".repeat(200)}青铜罗盘${"乙".repeat(200)}`;
    const snippet = buildPassageSnippet(text, 1000, ["青铜罗盘"], 60);
    expect(snippet.snippet).toContain("【青铜罗盘】");
    expect(snippet.length).toBe(60);
    expect(snippet.offset).toBeGreaterThan(1000);
    expect(sliceCodePoints(text, snippet.offset - 1000, snippet.offset - 1000 + snippet.length)).toContain("青铜罗盘");
  });

  it("共享片段：至少三个连续汉字", () => {
    expect(sharedCjkPhrases("他取出师父留下的青铜罗盘辨认方向", "那只青铜罗盘静静躺在匣中")).toContain("青铜罗盘");
    expect(sharedCjkPhrases("他走了", "她走了很远")).toEqual([]);
  });
});

describe("增量维护", () => {
  it("首次检索整本回填；正文改了按 sha256 重建该章，没改不读不建；文件删了清掉索引", async () => {
    const { storage, bookRoot } = await setup();
    await writeChapter(bookRoot, 1, "开篇。少年拾到一枚铜镜。");
    await writeChapter(bookRoot, 2, "第二章，雨夜赶路。");
    const first = await ensureBookPassageIndexFresh(storage, "book-a", bookRoot);
    expect(first.reindexed).toEqual([1, 2]);
    expect(first.totalChapters).toBe(2);

    const second = await ensureBookPassageIndexFresh(storage, "book-a", bookRoot);
    expect(second.reindexed).toEqual([]);
    expect(second.upToDate).toBe(2);

    // 只改修改时间、内容不变：读文件比 sha256 后不重建
    const touched = new Date(Date.now() + 5000);
    await utimes(chapterPath(bookRoot, 2), touched, touched);
    expect((await ensureBookPassageIndexFresh(storage, "book-a", bookRoot)).reindexed).toEqual([]);

    await writeChapter(bookRoot, 1, "开篇改写：少年拾到一只青铜罗盘。");
    const later = new Date(Date.now() + 10_000);
    await utimes(chapterPath(bookRoot, 1), later, later);
    const third = await ensureBookPassageIndexFresh(storage, "book-a", bookRoot);
    expect(third.reindexed).toEqual([1]);
    expect(await search(storage, "book-a", "铜镜")).toEqual([]);
    expect((await search(storage, "book-a", "青铜罗盘")).map((hit) => hit.chapterNumber)).toEqual([1]);

    await rm(chapterPath(bookRoot, 2));
    const fourth = await ensureBookPassageIndexFresh(storage, "book-a", bookRoot);
    expect(fourth.removed).toEqual([2]);
    expect(await search(storage, "book-a", "雨夜")).toEqual([]);
  });

  it("dryRun 只报告不写库", async () => {
    const { storage, bookRoot } = await setup();
    await writeChapter(bookRoot, 1, "铜镜。");
    const dry = await ensureBookPassageIndexFresh(storage, "book-a", bookRoot, { dryRun: true });
    expect(dry.reindexed).toEqual([1]);
    expect(await search(storage, "book-a", "铜镜")).toEqual([]);
  });

  it("超出时间预算的章留到下次（pending）", async () => {
    const { storage, bookRoot } = await setup();
    for (let chapter = 1; chapter <= 3; chapter += 1) await writeChapter(bookRoot, chapter, `第${chapter}章正文。`);
    const result = await ensureBookPassageIndexFresh(storage, "book-a", bookRoot, { budgetMs: -1 });
    expect(result.pending).toEqual([1, 2, 3]);
    expect((await ensureBookPassageIndexFresh(storage, "book-a", bookRoot)).reindexed).toEqual([1, 2, 3]);
  });

  it("回读时 sha256 对不上：丢弃命中并当场重建该章", async () => {
    const { storage, bookRoot } = await setup();
    await writeChapter(bookRoot, 1, "少年拾到一枚铜镜。");
    const fresh = await ensureBookPassageIndexFresh(storage, "book-a", bookRoot);
    // 绕过 mtime 检查直接改正文（同一毫秒内的外部改写）
    await writeChapter(bookRoot, 1, "少年什么也没捡到，铜镜换成了别的东西。前面多了很多字。".repeat(3));
    const candidates = await search(storage, "book-a", "铜镜");
    const read = await readPassageTexts(storage, "book-a", bookRoot, candidates, fresh.files);
    expect(read.staleChapters).toEqual([1]);
    expect(read.passages).toEqual([]);
    const again = await search(storage, "book-a", "铜镜");
    const reread = await readPassageTexts(storage, "book-a", bookRoot, again, fresh.files);
    expect(reread.passages[0]?.text).toContain("铜镜");
  });

  it("删章级联：chapter.discard_range 同事务删掉该段索引", async () => {
    const { storage, bookRoot } = await setup();
    await writeChapter(bookRoot, 1, "第一章的铜镜。");
    await writeChapter(bookRoot, 2, "第二章的铜镜。");
    await ensureBookPassageIndexFresh(storage, "book-a", bookRoot);
    expect((await search(storage, "book-a", "铜镜")).map((hit) => hit.chapterNumber).sort()).toEqual([1, 2]);
    const result = await handleChapterDiscardRange({ bookId: "book-a", bookRoot, fromChapter: 2, toChapter: 2, confirm: true, resetHooks: "none", storage });
    expect(result.ok).toBe(true);
    expect((await search(storage, "book-a", "铜镜")).map((hit) => hit.chapterNumber)).toEqual([1]);
    const docs = storage.sqlite.prepare(`SELECT chapter_number AS n FROM narrative_chapter_passage_doc WHERE book_id = ?`).all("book-a") as Array<{ n: number }>;
    expect(docs.map((row) => row.n)).toEqual([1]);
  });
});
