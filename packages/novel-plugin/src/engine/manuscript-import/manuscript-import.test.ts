import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyPlanEdit,
  createManuscriptImportJob,
  decodeManuscriptBytes,
  loadManuscriptImportJob,
  loadPlan,
  ManuscriptImportError,
  previewPlan,
  readManuscriptSnapshot,
  sortManuscriptFiles,
  splitByRule,
} from "./manuscript-import.js";

const encoder = new TextEncoder();
const tempDirs: string[] = [];

async function tempBook(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "novelfork-manuscript-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const body = (seed: string, repeat = 40) => `${seed}走过长街，风吹起衣角。`.repeat(repeat);

const sample = [
  "旧稿·作者自留",
  "",
  "第一章 雨夜",
  body("林照"),
  "",
  "第二章 来客",
  body("沈默"),
  "第三章 旧信",
  body("林照"),
].join("\r\n");

describe("旧稿解码", () => {
  it("UTF-8 BOM、UTF-16LE 与 GBK 都能读出", () => {
    expect(decodeManuscriptBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode("你好")]))).toEqual({ text: "你好", encoding: "utf-8" });
    expect(decodeManuscriptBytes(new Uint8Array([0xff, 0xfe, 0x60, 0x4f, 0x7d, 0x59]))).toEqual({ text: "你好", encoding: "utf-16le" });
    expect(decodeManuscriptBytes(new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]))).toEqual({ text: "你好", encoding: "gb18030" });
  });

  it("文件夹里的章节文件按自然序排", () => {
    expect(sortManuscriptFiles([{ name: "第10章.txt" }, { name: "第2章.txt" }, { name: "第1章.txt" }]).map((file) => file.name))
      .toEqual(["第1章.txt", "第2章.txt", "第10章.txt"]);
  });
});

describe("按规则切分", () => {
  it("复用 core 切章，找回标题行与序言字数", () => {
    const { chapters, preambleChars } = splitByRule(sample.replace(/\r\n/gu, "\n"));
    expect(chapters.map((chapter) => chapter.title)).toEqual(["雨夜", "来客", "旧信"]);
    expect(chapters.map((chapter) => chapter.headingLine)).toEqual(["第一章 雨夜", "第二章 来客", "第三章 旧信"]);
    expect(preambleChars).toBe("旧稿·作者自留".length);
  });

  it("危险规则被 T-07 校验拦下，带三段式说明", () => {
    try {
      splitByRule("第一章\n正文", "(a+)+$");
      throw new Error("应当拒绝");
    } catch (error) {
      expect(error).toBeInstanceOf(ManuscriptImportError);
      expect((error as ManuscriptImportError).code).toBe("MANUSCRIPT_IMPORT_INVALID_PATTERN");
      expect((error as ManuscriptImportError).explanation.suggestedAction).toContain("规则");
    }
  });
});

describe("源快照与计划", () => {
  it("原样存字节与哈希，之后只读快照；快照被改则拒绝", async () => {
    const bookRoot = await tempBook();
    const bytes = encoder.encode(sample);
    const { job, plan } = await createManuscriptImportJob({ bookRoot, bookId: "book-1", sourceName: "旧稿.txt", files: [{ name: "旧稿.txt", bytes }] });
    expect(job.phase).toBe("preview");
    expect(job.source.kind).toBe("text");
    expect(job.source.bytes).toBe(bytes.byteLength);
    expect(job.source.files[0]!.storedAs).toBe("source.txt");
    const stored = await readFile(join(bookRoot, "story", "import", job.jobId, "source.txt"));
    expect(Buffer.compare(stored, Buffer.from(bytes))).toBe(0);
    expect(plan.chapters).toHaveLength(3);

    const reloaded = await loadPlan(bookRoot, await loadManuscriptImportJob(bookRoot, job.jobId));
    expect(reloaded.revision).toBe(1);

    await writeFile(join(bookRoot, "story", "import", job.jobId, "source.txt"), "被改过");
    await expect(readManuscriptSnapshot(bookRoot, job)).rejects.toMatchObject({ code: "MANUSCRIPT_IMPORT_SNAPSHOT_MISMATCH" });
  });

  it("只有章节文件的文件夹默认按文件切，每个文件一章", async () => {
    const bookRoot = await tempBook();
    const { job, plan } = await createManuscriptImportJob({
      bookRoot,
      bookId: "book-1",
      sourceName: "旧稿文件夹",
      files: [
        { name: "旧稿/002 来客.md", bytes: encoder.encode(body("沈默")) },
        { name: "旧稿/001 雨夜.md", bytes: encoder.encode(`第一章 雨夜\n${body("林照")}`) },
      ],
    });
    expect(job.source.kind).toBe("files");
    expect(job.split.mode).toBe("by-file");
    expect(plan.chapters.map((chapter) => chapter.title)).toEqual(["雨夜", "来客"]);
    expect(job.source.files.map((file) => file.storedAs)).toEqual(["source/0001-001 雨夜.md", "source/0002-002 来客.md"]);
  });
});

describe("计划调整与异常提示", () => {
  function basePlan() {
    const { chapters } = splitByRule(sample.replace(/\r\n/gu, "\n"));
    return { schemaVersion: 1 as const, jobId: "job-00000001", sourceSha256: "a".repeat(64), revision: 1, preambleChars: 0, notes: [], chapters };
  }

  it("合并相邻章时把下一章标题行还原进正文", () => {
    const merged = applyPlanEdit(basePlan(), { op: "merge", index: 1 });
    expect(merged.chapters).toHaveLength(2);
    expect(merged.revision).toBe(2);
    expect(merged.chapters[0]!.content).toContain("第二章 来客");
  });

  it("从某一行拆开：短行当新章标题", () => {
    const plan = basePlan();
    plan.chapters[0] = { ...plan.chapters[0]!, content: "前半段正文。\n楔子之后\n后半段正文。" };
    const split = applyPlanEdit(plan, { op: "split", index: 1, atLine: 1 });
    expect(split.chapters).toHaveLength(4);
    expect(split.chapters[0]!.content).toBe("前半段正文。");
    expect(split.chapters[1]).toMatchObject({ title: "楔子之后", content: "后半段正文。" });
  });

  it("合并后从原标题行拆回：标题按分章规则取出，与自动切分一致", () => {
    const merged = applyPlanEdit(basePlan(), { op: "merge", index: 2 });
    const lines = merged.chapters[1]!.content.split("\n");
    const at = lines.findIndex((line) => line.trim() === "第三章 旧信");
    const restored = applyPlanEdit(merged, { op: "split", index: 2, atLine: at });
    expect(restored.chapters.map((chapter) => chapter.title)).toEqual(["雨夜", "来客", "旧信"]);
    expect(restored.chapters[2]!.headingLine).toBe("第三章 旧信");
  });

  it("改标题与越界操作", () => {
    expect(applyPlanEdit(basePlan(), { op: "rename", index: 2, title: " 新的 来客 " }).chapters[1]!.title).toBe("新的 来客");
    expect(() => applyPlanEdit(basePlan(), { op: "merge", index: 3 })).toThrow(ManuscriptImportError);
    expect(() => applyPlanEdit(basePlan(), { op: "rename", index: 9, title: "x" })).toThrow(ManuscriptImportError);
  });

  it("提示过短章、过长章与重复标题", () => {
    const plan = basePlan();
    plan.chapters.push({ title: "雨夜", content: "很短。", headingLine: "第四章 雨夜" });
    plan.chapters.push({ title: "长章", content: "字".repeat(30_000), headingLine: "第五章 长章" });
    const preview = previewPlan(plan);
    const codes = (index: number) => preview.chapters[index]!.anomalies.map((item) => item.code);
    expect(codes(3)).toEqual(expect.arrayContaining(["too-short", "duplicate-title"]));
    expect(codes(0)).toContain("duplicate-title");
    expect(codes(4)).toContain("too-long");
    expect(preview.chapters[0]!.head.length).toBeLessThanOrEqual(61);
    expect(preview.chapters[0]!.tail.startsWith("…")).toBe(true);
  });

  it("序言未入章时给出全局提示", () => {
    const { chapters, preambleChars } = splitByRule(sample.replace(/\r\n/gu, "\n"));
    const preview = previewPlan({ ...basePlan(), chapters, preambleChars });
    expect(preview.warnings.some((warning) => warning.includes("没有归入任何章节"))).toBe(true);
  });
});
