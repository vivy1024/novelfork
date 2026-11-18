import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeZip } from "../book-archive/zip";
import {
  buildDissectLibrary,
  deleteDissectBook,
  getDissectBookWorkspace,
  getDissectChapterPair,
  getDissectLibraryTree,
  MAX_DISSECT_BYTES,
  previewDissectSource,
  readDissectDocument,
  readDissectSource,
  REPORT_NAMES,
  saveDissectDocument,
  selectDissectChapters,
  splitDissectChapters,
} from "./dissect-library";

let root: string;
const text = Array.from(
  { length: 105 },
  (_, i) => `第${i + 1}章 风起\n唐三转身，长老手中握着钥匙。\n“不能失败！”唐三说道。\n敌人突然出现，秘密究竟是什么？`,
).join("\n\n");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dissect-library-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("结构化拆书库", () => {
  it("UTF-8 百章原文生成完整非空 Markdown 树、工作台索引与逐章底稿", async () => {
    await writeFile(join(root, "原文.txt"), text);
    const result = await buildDissectLibrary(root, {
      bookTitle: "风起",
      category: "仙侠",
      filePath: "原文.txt",
      chapterSelection: { preset: "first5" },
    });
    expect(result.meta.totalChapters).toBe(105);
    expect(result.selectedRange).toEqual({ from: 1, to: 5 });

    const folder = "story/dissect-library/小说/风起";
    expect(await readdir(join(root, folder, "报告"))).toHaveLength(12);
    for (const name of REPORT_NAMES) {
      const doc = await readDissectDocument(root, `${folder}/报告/${name}.md`);
      expect(doc.content.length).toBeGreaterThan(200);
      expect(doc.content).toContain("章");
    }
    expect(await readFile(join(root, folder, "结构卡/核心结构卡.md"), "utf8")).toContain("唐三");
    expect(await readdir(join(root, folder, "卷摘要"))).toEqual(expect.arrayContaining(["第 1–100 章.md", "第 101–200 章.md"]));

    const workspace = await getDissectBookWorkspace(root, "风起");
    expect(workspace.hasStoredSource).toBe(true);
    expect(workspace.chapters).toHaveLength(105);
    expect(workspace.chapters[0]?.tension).toBeTypeOf("number");

    const pair = await getDissectChapterPair(root, "风起", 1);
    expect(pair.sourceText).toContain("唐三转身");
    expect(pair.analysisContent).toContain("第 1 章");

    const tree = await getDissectLibraryTree(root);
    expect(tree.tree.children?.map((node) => node.title)).toContain("_分类");
    expect(tree.referenceFiles.map((file) => file.path)).toContain("原文.txt");
    expect((await readDissectDocument(root, "story/dissect-library/_分类/题材索引.md")).content).toContain("仙侠");
  });

  it("支持本地上传 DOCX / EPUB / GBK TXT 并支持分章预览", async () => {
    const docxBytes = writeZip([
      {
        path: "word/document.xml",
        data: Buffer.from(
          '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>第一章 破局</w:t></w:r></w:p><w:p><w:r><w:t>林墨推开大门，冷风灌入。</w:t></w:r></w:p></w:body></w:document>',
        ),
      },
    ]);
    const preview = await previewDissectSource(root, {
      uploadedFiles: [{ name: "破局.docx", bytes: docxBytes }],
    });
    expect(preview.encoding).toBe("docx");
    expect(preview.totalChapters).toBe(1);
    expect(preview.chapters[0]?.title).toContain("破局");

    const epubBytes = writeZip([
      {
        path: "META-INF/container.xml",
        data: Buffer.from('<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'),
      },
      {
        path: "OEBPS/content.opf",
        data: Buffer.from(
          '<package><manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>',
        ),
      },
      {
        path: "OEBPS/ch1.xhtml",
        data: Buffer.from("<html><body><h1>第一章 青云</h1><p>青云宗外门大比开始，众人屏息以待，少年缓步登台。</p></body></html>"),
      },
    ]);
    const epubBuild = await buildDissectLibrary(root, {
      bookTitle: "青云",
      category: "仙侠",
      uploadedFiles: [{ name: "青云.epub", bytes: epubBytes }],
    });
    expect(epubBuild.meta.sourceEncoding).toBe("epub");
    const pair = await getDissectChapterPair(root, "青云", 1);
    expect(pair.sourceText).toContain("青云宗外门大比开始");
  });

  it("自适应 GB18030，并支持无章号文本", async () => {
    await writeFile(join(root, "gbk.txt"), Buffer.from([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x0a, 0xc4, 0xe3, 0xba, 0xc3]));
    expect(await readDissectSource(root, "gbk.txt")).toBe("第一章\n你好");
    const result = await buildDissectLibrary(root, { bookTitle: "编码", filePath: "gbk.txt" });
    expect(result.meta.totalChapters).toBe(1);
    expect(splitDissectChapters("无章号的完整故事。")[0]?.text).toBe("无章号的完整故事。");
  });

  it("前五章、前十章和向后增选十章合并已拆范围，保留作者编辑，并支持复用快照增量精拆", async () => {
    await buildDissectLibrary(root, { bookTitle: "风起", text, chapterSelection: { preset: "first5" } });
    const path = "story/dissect-library/小说/风起/报告/技法库.md";
    await saveDissectDocument(root, path, "# 作者自己的技法笔记\n不可覆盖");
    const result = await buildDissectLibrary(root, {
      bookTitle: "风起",
      text,
      chapterSelection: { preset: "range", from: 6, to: 15 },
    });
    expect(result.meta.analyzedRanges).toEqual([{ from: 1, to: 15 }]);
    expect((await readDissectDocument(root, path)).content).toContain("不可覆盖");
    expect(selectDissectChapters(105, { preset: "first10" })).toEqual({ from: 1, to: 10 });
    expect(() => selectDissectChapters(2, { preset: "range", from: 1, to: 4 })).toThrow();

    const generate = vi.fn().mockResolvedValue({ text: "## 拆书报告\n全书结构。\n\n## 本章细拆\n第1章节奏紧凑。" });
    const refined = await buildDissectLibrary(
      root,
      {
        bookTitle: "风起",
        reuseStoredSource: true,
        useModel: true,
        dissectMode: "per-chapter",
        chapterSelection: { preset: "range", from: 1, to: 1 },
      },
      generate,
    );
    expect(refined.meta.refinedChapters).toEqual([1]);
    expect((await getDissectChapterPair(root, "风起", 1)).analysisContent).toContain("第1章节奏紧凑");
  });

  it("分章精炼只提交选中原文，模型失败不改文件", async () => {
    const generate = vi.fn().mockResolvedValue({ text: "## 章纲\n有证据的细纲。" });
    const result = await buildDissectLibrary(
      root,
      {
        bookTitle: "精炼",
        text,
        useModel: true,
        template: "chapter-outline",
        dissectMode: "per-chapter",
        chapterSelection: { preset: "range", from: 6, to: 7 },
      },
      generate,
    );
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[0]![0].messages[1].content).toContain("【第6章】");
    expect(result.modelRefined).toBe(true);
    const path = "story/dissect-library/小说/精炼/报告/章纲.md";
    const before = (await readDissectDocument(root, path)).content;
    await expect(buildDissectLibrary(root, { bookTitle: "精炼", text, useModel: true }, async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    expect((await readDissectDocument(root, path)).content).toBe(before);
  });

  it("拦截目录遍历、特殊书名、输出链接与超大原文", async () => {
    await expect(readDissectSource(root, "../secret.txt")).rejects.toThrow("超出");
    await expect(readDissectDocument(root, "story/dissect-library/../secret.md")).rejects.toThrow();
    await expect(saveDissectDocument(root, "story/dissect-library/../../secret.md", "bad")).rejects.toThrow();
    await expect(buildDissectLibrary(root, { bookTitle: "../越界", text })).rejects.toThrow();
    await expect(buildDissectLibrary(root, { bookTitle: "大文件", text: "a".repeat(MAX_DISSECT_BYTES + 1) })).rejects.toThrow("60MB");
    await symlink(join(root, ".."), join(root, "linked"), "junction");
    await expect(readDissectSource(root, "linked/secret.txt")).rejects.toThrow("链接");
  });

  it("删除条目同时更新分类索引", async () => {
    await buildDissectLibrary(root, { bookTitle: "删除测试", text: "第一章\n故事。" });
    await deleteDissectBook(root, "删除测试");
    expect((await readDissectDocument(root, "story/dissect-library/_分类/题材索引.md")).content).not.toContain("删除测试");
  });
});
