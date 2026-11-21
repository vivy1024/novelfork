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

  it("清洗分隔线与站内尾注、合并重复空章、排除拟声词实体并正确覆盖单章精炼段落", async () => {
    const dirtyText = [
      "第1章 初入",
      "陆江仙握住《太阴吐纳练气诀》，看向李通崖。",
      "“轰隆！”远处传来雷鸣。",
      "“哦？”李通崖问道。",
      "难道这古镜竟有灵智？",
      "(本章完)",
      "",
      "------------",
      "",
      "第2章 诱入",
      "第2章 诱入",
      "先都军旗南下，李曦明冷笑一声：“不错。”",
      "本周热推：某些不相关书籍",
      "------------",
      "请假一天逃跑！",
      "本章想法",
      "------------",
      "",
      "第3章 请假一日",
      "本章想法",
      "",
      "第4章 明煞",
      "黑气弥散，李周巍皱眉望向……",
    ].join("\n");

    const built = await buildDissectLibrary(root, { bookTitle: "清洗测试", category: "仙侠", text: dirtyText });
    // 第 2 章重复标题不产生 0 字空章，总数应为 4 章
    expect(built.meta.totalChapters).toBe(4);

    const outlineDoc = await readDissectDocument(root, "story/dissect-library/小说/清洗测试/报告/章纲.md");
    expect(outlineDoc.content).not.toContain("------------");
    expect(outlineDoc.content).not.toContain("本章完");
    expect(outlineDoc.content).not.toContain("本周热推");
    expect(outlineDoc.content).not.toContain("请假一天逃跑");
    expect(outlineDoc.content).toContain("[公告]");
    expect(outlineDoc.content).toContain("李曦明冷笑一声：“不错。”");

    const eventDoc = await readDissectDocument(root, "story/dissect-library/小说/清洗测试/报告/事件线.md");
    expect(eventDoc.content).toContain("核心冲突与高张力事件脉络");

    const cardDoc = await readDissectDocument(root, "story/dissect-library/小说/清洗测试/结构卡/核心结构卡.md");
    expect(cardDoc.content).toContain("《太阴吐纳练气诀》");
    expect(cardDoc.content).toContain("李通崖");
    expect(cardDoc.content).not.toContain("轰隆");
    expect(cardDoc.content).not.toContain("哦？");
    expect(cardDoc.content).not.toContain("不错。");

    const generate = vi
      .fn()
      .mockResolvedValueOnce({ text: "## 拆书报告\n初版结构$\\rightarrow$冲突。\n\n## 本章细拆\n初版细拆$\\rightarrow$钩子。" })
      .mockResolvedValueOnce({ text: "## 拆书报告\n新版结构$\\rightarrow$升级。\n\n## 本章细拆\n新版细拆$\\rightarrow$反转。" });

    await buildDissectLibrary(
      root,
      { bookTitle: "清洗测试", reuseStoredSource: true, useModel: true, dissectMode: "per-chapter", chapterSelection: { preset: "range", from: 1, to: 1 } },
      generate,
    );
    await buildDissectLibrary(
      root,
      { bookTitle: "清洗测试", reuseStoredSource: true, useModel: true, dissectMode: "per-chapter", chapterSelection: { preset: "range", from: 1, to: 1 } },
      generate,
    );

    const reportAfter = (await readDissectDocument(root, "story/dissect-library/小说/清洗测试/报告/拆书报告.md")).content;
    expect(reportAfter).toContain("### 第 1 章深度精炼");
    expect(reportAfter).not.toContain("第 1–1 章");
    expect(reportAfter).not.toContain("$\\rightarrow$");
    expect(reportAfter).toContain("新版结构 → 升级");
    expect(reportAfter).not.toContain("初版结构");

    const ch1After = (await readDissectDocument(root, "story/dissect-library/小说/清洗测试/逐章拆解/第1章.md")).content;
    expect(ch1After).toContain("新版细拆 → 反转");
    expect(ch1After).not.toContain("初版细拆");
    expect(ch1After).not.toContain("（更新）");
  });

  it("rebuildReports 清理超界孤儿文件、归一旧 1–1 标题、保留已精拆并守住不同原文 409 校验", async () => {
    const text = [
      "第1章 初入",
      "李项平问道：“此事如何？”陆江仙默然。",
      "ps:真的不是在水，借角色丰富一下形象QAQ",
      "[大哭]求票票，求追读。",
      "",
      "第2章 暗涌",
      "李通崖冷笑一声，抬剑指向前路。",
      "",
      "第3章 空壳",
      "(本章完)",
    ].join("\n");

    await buildDissectLibrary(root, { bookTitle: "收口测试", category: "仙侠", text });

    // 验证表情前缀求票 + ps 被剥离，第 3 章剥空后被标为 truncated
    const wsBefore = await getDissectBookWorkspace(root, "收口测试");
    expect(wsBefore.chapters[0]?.tail).not.toContain("求票票");
    expect(wsBefore.chapters[0]?.tail).not.toContain("ps:");
    expect(wsBefore.chapters[2]?.words).toBe(0);
    expect(wsBefore.chapters[2]?.anomaly).toBe("truncated");

    // 模拟旧库残留：1–1 标题、超界孤儿逐章文件第 4 章、超界 analyzedRanges/refinedChapters
    const reportPath = join(root, "story/dissect-library/小说/收口测试/报告/拆书报告.md");
    const oldReport = await readFile(reportPath, "utf8");
    await writeFile(reportPath, `${oldReport.trimEnd()}\n\n### 第 1–1 章深度精炼\n\n旧版第一段$\\rightarrow$保留。\n`, "utf8");
    const orphanChapterPath = join(root, "story/dissect-library/小说/收口测试/逐章拆解/第4章.md");
    await writeFile(orphanChapterPath, "# 第 4 章 · 孤儿\n------------\n", "utf8");
    const metaPath = join(root, "story/dissect-library/小说/收口测试/_meta.json");
    const metaRaw = JSON.parse(await readFile(metaPath, "utf8")) as Record<string, unknown>;
    metaRaw.analyzedRanges = [{ from: 1, to: 5 }];
    metaRaw.refinedChapters = [1, 5];
    await writeFile(metaPath, JSON.stringify(metaRaw, null, 2), "utf8");

    // 传不同原文 + rebuildReports 依然被 409 拦截
    await expect(
      buildDissectLibrary(root, {
        bookTitle: "收口测试",
        rebuildReports: true,
        text: "第1章 完全不同的书\n不同正文。",
      }),
    ).rejects.toThrow("原文已变化");

    // rebuildReports + useModel（精拆第 2 章，且模型未输出 `## 本章细拆` 标题）
    const gen = vi.fn().mockResolvedValueOnce({
      text: "## 拆书报告\n## 小节冲突\n第二章精拆正文。\n\n## 开篇分析\n开篇补充。",
    });
    const rebuilt = await buildDissectLibrary(
      root,
      {
        bookTitle: "收口测试",
        reuseStoredSource: true,
        rebuildReports: true,
        useModel: true,
        dissectMode: "per-chapter",
        chapterSelection: { preset: "range", from: 2, to: 2 },
      },
      gen,
    );

    // 区间与精拆章号裁剪回 1..3，孤儿第 4 章已清理
    expect(rebuilt.meta.analyzedRanges).toEqual([{ from: 1, to: 3 }]);
    expect(rebuilt.meta.refinedChapters).toEqual([1, 2]);
    await expect(readFile(orphanChapterPath, "utf8")).rejects.toThrow();

    // 旧第 1 章精炼被保留且标题从 1–1 归一为 `第 1 章`，新第 2 章同时存在
    const reportNow = (await readDissectDocument(root, "story/dissect-library/小说/收口测试/报告/拆书报告.md")).content;
    expect(reportNow).toContain("### 第 1 章深度精炼");
    expect(reportNow).not.toContain("第 1–1 章");
    expect(reportNow).toContain("旧版第一段 → 保留");
    expect(reportNow).toContain("### 第 2 章深度精炼");

    // 第 2 章单章底稿在缺少 `## 本章细拆` 时只取核心分节且降级内部二级标题
    const ch2Doc = (await readDissectDocument(root, "story/dissect-library/小说/收口测试/逐章拆解/第2章.md")).content;
    expect(ch2Doc).toContain("## 模型深度细拆");
    expect(ch2Doc).toContain("### 小节冲突");
    expect(ch2Doc).not.toContain("## 开篇分析");
  });

  it("超长书事件线等距覆盖全书首尾而不截断后半本", async () => {
    const longBook = Array.from({ length: 360 }, (_, idx) => {
      const n = idx + 1;
      return `第${n}章 激战${n}\n敌军压迫而来，众人反击死战不退！究竟谁能活到最后？`;
    }).join("\n\n");

    await buildDissectLibrary(root, { bookTitle: "长篇事件线", text: longBook });
    const timeline = (await readDissectDocument(root, "story/dissect-library/小说/长篇事件线/报告/事件线.md")).content;
    expect(timeline).toContain("共 300 处关键节点");
    expect(timeline).toContain("【第1章】");
    expect(timeline).toMatch(/【第35\d章】|【第360章】/);
  });

  it("支持知识书模式（段落指纹、增量复用模型分析与《本书精华》聚合）", async () => {
    const bookText = [
      "第1章 场景结构",
      "主动场景必须以明确目标开始，随后制造连续冲突，最后以挫折收束。",
      "步骤：1. 先确定视点角色目标；2. 加入外部阻力；3. 用代价更高的挫折收尾。",
      "限制与注意：纯情绪过渡可跳过主动场景，不可生搬硬套。",
      "",
      "第2章 视角控制",
      "有限第三人称必须严守信息边界，不可写出视角人物看不见的自身神态。",
    ].join("\n\n");

    const localBuild = await buildDissectLibrary(root, {
      bookTitle: "故事技法",
      bookKind: "knowledge",
      category: "写作技巧",
      text: bookText,
    });
    expect(localBuild.meta.bookKind).toBe("knowledge");
    expect(localBuild.meta.totalChapters).toBe(2);

    const essenceDoc = await readDissectDocument(root, "story/dissect-library/知识书/故事技法/报告/本书精华.md");
    expect(essenceDoc.content).toContain("本书精华");
    expect(essenceDoc.content).toContain("回看原文");

    const generate = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        purpose: "拆解主动场景三要素与边界条件",
        candidates: [
          {
            kind: "skill",
            topic: "场景规划",
            title: "用目标—冲突—挫折构造主动场景",
            problem: "场景流水账没有推进动力",
            explanation: "主动场景以视点角色具体目标开头，用阻碍构成中段冲突，以挫折关闭旧路。",
            steps: ["确定具体目标", "设计连续阻力", "以挫折收束"],
            example: "查案遇阻反遭伏击",
            conditions: "适用于情节推进型主场景",
            limits: "情绪过渡场景可改用被动场景",
            evidence: [{ paragraphs: [1, 2], quote: "主动场景必须以明确目标开始" }],
          },
        ],
      }),
    });

    await buildDissectLibrary(
      root,
      {
        bookTitle: "故事技法",
        bookKind: "knowledge",
        reuseStoredSource: true,
        chapterSelection: { preset: "range", from: 1, to: 1 },
        useModel: true,
      },
      generate,
    );
    expect(generate).toHaveBeenCalledTimes(1);

    // 再次请求同一区间时，因 bodyHash 未变化且已有模型结果，应直接增量复用、不重复调模型
    await buildDissectLibrary(
      root,
      {
        bookTitle: "故事技法",
        bookKind: "knowledge",
        reuseStoredSource: true,
        chapterSelection: { preset: "range", from: 1, to: 1 },
        useModel: true,
      },
      generate,
    );
    expect(generate).toHaveBeenCalledTimes(1);

    const ws = await getDissectBookWorkspace(root, "故事技法");
    expect(ws.bookKind).toBe("knowledge");
    expect(ws.essence?.coreItems[0]?.title).toBe("用目标—冲突—挫折构造主动场景");

    const pair = await getDissectChapterPair(root, "故事技法", 1);
    expect(pair.bookKind).toBe("knowledge");
    expect(pair.paragraphs?.length).toBeGreaterThanOrEqual(2);
    expect(pair.knowledgeAnalysis?.candidates[0]?.evidence[0]?.paragraphs).toEqual([1, 2]);
  });

  it("自动识别并导入 Obsidian 知识书拆书目录（保留原文、学习分析 JSON 与《本书精华》）", async () => {
    const enc = new TextEncoder();
    const files = [
      {
        name: "雪花写作法/00 作品.md",
        bytes: enc.encode('---\n类型: "作品"\n作品类型: "知识书"\n书名: "雪花写作法"\n作者: "兰迪·英格曼森"\n---\n# 雪花写作法\n'),
      },
      {
        name: "雪花写作法/分类.md",
        bytes: enc.encode("---\n类型: \"分类\"\n---\n# 分类\n\n- 类别：写作技巧\n"),
      },
      {
        name: "雪花写作法/正文/0001 第一章 雪花法原理.md",
        bytes: enc.encode('---\n类型: "正文"\n章序: "1"\n原标题: "第一章 雪花法原理"\n---\n# 第一章 雪花法原理\n\n先用一句话概括故事。\n\n每轮只增加少量细节，保持整体对称。\n'),
      },
      {
        name: "雪花写作法/学习分析/0001 第一章 雪花法原理.md",
        bytes: enc.encode(
          '---\n类型: "精华分析材料"\n章序: "1"\n---\n# 第一章 雪花法原理\n\n<!--\n```json\n' +
            JSON.stringify({
              version: 1,
              ordinal: 1,
              bodyHash: "hash-ch1",
              purpose: "分轮扩写原则",
              coveredParagraphs: [1, 2],
              candidates: [
                {
                  id: "s1-c1",
                  kind: "skill",
                  title: "分轮扩写保持整体对称",
                  problem: "边写边大改导致结构失控",
                  explanation: "从一句话概括起步，每轮在前一轮完整版本上增加细节。",
                  steps: ["写一句话概括", "逐轮扩充细节"],
                  example: "三角形逐轮扩成雪花",
                  conditions: "适合长篇规划",
                  limits: "并非人人适用",
                  evidence: [{ chapter: 1, paragraphs: [2], quote: "每轮只增加少量细节" }],
                },
              ],
            }) +
            "\n```\n-->\n",
        ),
      },
      {
        name: "雪花写作法/报告/本书精华.md",
        bytes: enc.encode(
          [
            "---",
            '类型: "本书精华"',
            "---",
            "# 《雪花写作法》本书精华",
            "",
            "## 这本书能给你什么",
            "",
            "本书用十步流程组织长篇初稿规划。",
            "",
            "**范围和局限**：仅作方法参考，需结合个人习惯裁剪。",
            "",
            "## 值得掌握的核心内容",
            "",
            "### 分轮扩写保持整体对称",
            "",
            "**雪花法** · 操作技巧",
            "",
            "**解决什么问题**：初稿容易失控。",
            "",
            "先一句话概括，再分轮加细节。",
            "",
            "**怎么做**",
            "",
            "1. 写一句话概括。",
            "2. 逐轮扩写并保持对称。",
            "",
            "**适用条件**：适合愿意前期规划的作者。",
            "",
            "**限制与注意**：不适用于所有人。",
            "",
            "> [!info]- 回看原文，自行核对",
            '> - [[拆书库/知识书/雪花写作法/正文/0001 第一章 雪花法原理|第一章 雪花法原理]] · 段 2 · 定位原句：“每轮只增加少量细节”',
          ].join("\n"),
        ),
      },
    ];

    const preview = await previewDissectSource(root, { uploadedFiles: files });
    expect(preview.obsidianDetected).toBe(true);
    expect(preview.bookKind).toBe("knowledge");
    expect(preview.detectedTitle).toBe("雪花写作法");
    expect(preview.detectedAuthor).toBe("兰迪·英格曼森");
    expect(preview.totalChapters).toBe(1);

    const built = await buildDissectLibrary(root, {
      bookTitle: "",
      uploadedFiles: files,
    });
    expect(built.slug).toBe("雪花写作法");
    expect(built.meta.bookKind).toBe("knowledge");
    expect(built.meta.sourceEncoding).toBe("obsidian");
    expect(built.meta.essenceItemCount).toBe(1);

    const ws = await getDissectBookWorkspace(root, "雪花写作法");
    expect(ws.essence?.coreItems[0]?.title).toBe("分轮扩写保持整体对称");
    expect(ws.essence?.coreItems[0]?.evidence[0]).toMatchObject({ chapter: 1, paragraphs: [2] });

    const tree = await getDissectLibraryTree(root);
    expect(tree.tree.children?.map((n) => n.title)).toContain("知识书");

    await deleteDissectBook(root, "雪花写作法");
    await expect(getDissectBookWorkspace(root, "雪花写作法")).rejects.toThrow("找不到");
  });
});
