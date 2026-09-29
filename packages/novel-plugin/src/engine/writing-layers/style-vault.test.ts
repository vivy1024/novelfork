import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { chapterRelativePath, writeChapterIndex } from "../writing-resource/chapter-layout.js";
import { loadStylePreset } from "./style-preset-store.js";
import { composeStyleGuide } from "./style-preset.js";
import {
  adoptRevisionSamples,
  AUTHOR_REVISION_SOURCE_ID,
  computeAuthorShare,
  extractRevisionPairs,
  readChapterAiDraft,
  readChapterVaultDetail,
  saveChapterAiDraft,
  STYLE_VAULT_RELATIVE_DIR,
  summarizeStyleVault,
} from "./style-vault.js";

const aiText = [
  "雨落在旧站台上。她把信封放进外套，指尖沾着一点冷水。",
  "“末班车还来吗？”她问。值班员没有抬头，只把墙上的钟拨正。",
  "远处传来铁轨轻轻的震动，她站起身，鞋底在湿地上留下一道浅浅的印子，像一个没写完的句号。",
].join("\n");

describe("computeAuthorShare", () => {
  it("原样保留的句子算 AI，改写与新写的算作者", () => {
    expect(computeAuthorShare(aiText, aiText)).toMatchObject({ authorChars: 0, authorRatio: 0 });

    const revised = aiText.replace("她把信封放进外套，指尖沾着一点冷水。", "她把信封塞进外套内袋，手指还是湿的。") + "\n她没等到车。";
    const share = computeAuthorShare(aiText, revised);
    expect(share.authorChars).toBe("她把信封塞进外套内袋，手指还是湿的。".length + "她没等到车。".length);
    expect(share.authorRatio).toBeGreaterThan(0);
    expect(share.authorRatio).toBeLessThan(1);
  });

  it("同一句重复出现只按原稿次数计为 AI；空正文占比为 0", () => {
    expect(computeAuthorShare("好。", "好。好。")).toMatchObject({ aiChars: 2, authorChars: 2 });
    expect(computeAuthorShare(aiText, "").authorRatio).toBe(0);
  });
});

describe("extractRevisionPairs", () => {
  it("只收「改过但认得出」的段落，不收原样保留与另起炉灶的段", () => {
    const current = [
      "雨落在旧站台上。她把信封放进外套，指尖沾着一点冷水。",
      "“车还来吗？”她问。值班员头也没抬，只伸手把墙上那只慢了的钟拨正。",
      "隔壁摊主在收伞，塑料布上的水哗啦一声全泼在她脚边，谁也没道歉，她也懒得看。",
    ].join("\n");
    const pairs = extractRevisionPairs(aiText, current);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.aiText).toContain("末班车还来吗");
    expect(pairs[0]!.authorText).toContain("车还来吗");
    expect(pairs[0]!.similarity).toBeGreaterThan(0.25);
    expect(pairs[0]!.similarity).toBeLessThan(0.9);
  });
});

describe("文风金库文件", () => {
  let bookRoot: string;
  beforeEach(async () => {
    bookRoot = join(tmpdir(), `novelfork-style-vault-${crypto.randomUUID()}`);
    await mkdir(join(bookRoot, "chapters", "卷01"), { recursive: true });
  });
  afterEach(async () => { await rm(bookRoot, { recursive: true, force: true }); });

  async function chapter(number: number, title: string, content: string) {
    const fileName = chapterRelativePath("卷01", number, title);
    await writeFile(join(bookRoot, "chapters", fileName), content, "utf8");
    return { number, title, fileName, wordCount: content.length, updatedAt: "2026-09-29T00:00:00.000Z" };
  }

  it("保存与读取原稿；全书汇总区分有无原稿，按字数加权总占比", async () => {
    const edited = `${aiText}\n她没等到车。`;
    await writeChapterIndex(bookRoot, [await chapter(1, "雨夜", edited), await chapter(2, "手写", "作者自己写的一章。")]);
    await saveChapterAiDraft(bookRoot, { chapterNumber: 1, text: aiText, source: "pipeline.write" });

    expect(await readChapterAiDraft(bookRoot, 1)).toMatchObject({ chapterNumber: 1, text: aiText, source: "pipeline.write" });
    expect(await readChapterAiDraft(bookRoot, 2)).toBeNull();

    const summary = await summarizeStyleVault(bookRoot);
    expect(summary.chapters.map((item) => [item.chapterNumber, item.hasAiDraft])).toEqual([[1, true], [2, false]]);
    expect(summary.chapters[0]!.share!.authorChars).toBe("她没等到车。".length);
    expect(summary.overallAuthorRatio).toBeCloseTo(summary.chapters[0]!.share!.authorRatio);

    const detail = await readChapterVaultDetail(bookRoot, 1);
    expect(detail).toMatchObject({ hasAiDraft: true, revisionPairs: [] });
  });

  it("原稿损坏时如实报错，不当作没有 AI 参与", async () => {
    await writeChapterIndex(bookRoot, [await chapter(1, "雨夜", aiText)]);
    await mkdir(join(bookRoot, STYLE_VAULT_RELATIVE_DIR), { recursive: true });
    await writeFile(join(bookRoot, STYLE_VAULT_RELATIVE_DIR, "chapter-0001.json"), JSON.stringify({ schemaVersion: 9 }), "utf8");
    const summary = await summarizeStyleVault(bookRoot);
    expect(summary.chapters[0]).toMatchObject({ hasAiDraft: true, error: expect.stringContaining("格式不对") });
    expect(summary.overallAuthorRatio).toBeNull();
  });

  it("采纳改稿写入「作者改稿」来源并排在最前，重复采纳去重，版本不符拒绝", async () => {
    const first = await adoptRevisionSamples(bookRoot, [
      { chapterNumber: 3, authorText: "“车还来吗？”她问。值班员头也没抬。", aiText: "“末班车还来吗？”她问。值班员没有抬头。", sceneType: "dialogue" },
    ], null);
    const source = first.preset!.sources[0]!;
    expect(source.id).toBe(AUTHOR_REVISION_SOURCE_ID);
    expect(source.samples).toHaveLength(1);
    expect(source.samples[0]).toMatchObject({ sceneType: "dialogue", status: "confirmed", transfer: "transferable" });
    expect(source.samples[0]!.evidence).toContain("AI 原文");

    const again = await adoptRevisionSamples(bookRoot, [
      { chapterNumber: 3, authorText: "“车还来吗？”她问。值班员头也没抬。", aiText: "x" },
    ], first.revision);
    expect(again.preset!.sources[0]!.samples).toHaveLength(1);

    // 内容未变，版本号也不变
    expect(again.revision).toBe(first.revision);
    await expect(adoptRevisionSamples(bookRoot, [{ chapterNumber: 4, authorText: "新段落。", aiText: "旧段落。" }], "stale-revision"))
      .rejects.toMatchObject({ code: "STYLE_PRESET_CONFLICT" });
    expect((await loadStylePreset(bookRoot)).revision).toBe(again.revision);
    void composeStyleGuide;
  });
});
