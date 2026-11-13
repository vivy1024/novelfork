import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  BookTextFileError,
  buildMechanicalBookIndex,
  listWorkspaceReferenceFiles,
  MAX_BOOK_TEXT_FILE_BYTES,
  readBookTextFile,
  resolveSafeBookFilePath,
} from "./source-file-index.js";
import { MAX_CHAPTERS, parseTxt } from "../tools/import/file-parser.js";
import { MAX_MANUSCRIPT_BYTES, MAX_MANUSCRIPT_CHAPTERS } from "../manuscript-import/manuscript-import.js";
import { MAX_SCAN_CHAPTERS } from "../../routes/character-voice.js";

const SCRATCH_BASE = "D:/DESKTOP/novelfork/tmp";
const tempDirs: string[] = [];

async function makeTempBook(): Promise<string> {
  await mkdir(SCRATCH_BASE, { recursive: true });
  const dir = await mkdtemp(join(SCRATCH_BASE, "nf-source-index-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// 「第一章 算账」的 GBK / GB18030 字节序列（含非 UTF-8 合法双字节）
const GBK_SAMPLE_BYTES = new Uint8Array([
  0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x20, 0xcb, 0xe3, 0xd5, 0xcb, 0x0d, 0x0a,
  0xc1, 0xe9, 0xca, 0xaf, 0xb4, 0xfb, 0xbf, 0xee, 0xc0, 0xfb, 0xcf, 0xa2, 0xa1, 0xa3,
]);

describe("source-file-index 安全沙箱与编码读取", () => {
  it("拦截 .. 越界、内部受保护目录、目录本身与超 60MB 大文件", async () => {
    const root = await makeTempBook();
    const outside = await makeTempBook();
    await writeFile(join(outside, "secret.txt"), "机密", "utf8");
    await mkdir(join(root, ".git"), { recursive: true });
    await mkdir(join(root, ".narrafork"), { recursive: true });
    await mkdir(join(root, ".novelfork"), { recursive: true });
    await writeFile(join(root, ".git", "config.txt"), "x", "utf8");
    await writeFile(join(root, ".narrafork", "db.txt"), "x", "utf8");
    await writeFile(join(root, ".novelfork", "state.txt"), "x", "utf8");
    await mkdir(join(root, "subdir"), { recursive: true });

    await expect(resolveSafeBookFilePath(root, "../secret.txt")).rejects.toMatchObject({ code: "BOOK_FILE_UNSAFE" });
    await expect(resolveSafeBookFilePath(root, join(outside, "secret.txt"))).rejects.toMatchObject({ code: "BOOK_FILE_UNSAFE" });
    await expect(resolveSafeBookFilePath(root, ".git/config.txt")).rejects.toMatchObject({ code: "BOOK_FILE_UNSAFE" });
    await expect(resolveSafeBookFilePath(root, ".narrafork/db.txt")).rejects.toMatchObject({ code: "BOOK_FILE_UNSAFE" });
    await expect(resolveSafeBookFilePath(root, ".novelfork/state.txt")).rejects.toMatchObject({ code: "BOOK_FILE_UNSAFE" });
    await expect(resolveSafeBookFilePath(root, "subdir")).rejects.toMatchObject({ code: "BOOK_FILE_INVALID" });

    // 符号链接越界拦截（Windows 无权限创建符号链接时跳过该断言）
    const linkPath = join(root, "escape.txt");
    let linked = false;
    try {
      await symlink(join(outside, "secret.txt"), linkPath);
      linked = true;
    } catch {
      linked = false;
    }
    if (linked) {
      await expect(resolveSafeBookFilePath(root, "escape.txt")).rejects.toBeInstanceOf(BookTextFileError);
    }

    // 超 60MB 稀疏文件拦截
    const oversized = join(root, "oversized.txt");
    await writeFile(oversized, "x", "utf8");
    await truncate(oversized, MAX_BOOK_TEXT_FILE_BYTES + 1024);
    await expect(resolveSafeBookFilePath(root, "oversized.txt")).rejects.toMatchObject({ code: "BOOK_FILE_TOO_LARGE" });
  });

  it("枚举书根参考文件时跳过 chapters/story/.git/.narrafork/.novelfork/node_modules", async () => {
    const root = await makeTempBook();
    await mkdir(join(root, "chapters"), { recursive: true });
    await mkdir(join(root, "story"), { recursive: true });
    await mkdir(join(root, "node_modules"), { recursive: true });
    await mkdir(join(root, "refs"), { recursive: true });
    await writeFile(join(root, "chapters", "0001.md"), "正文", "utf8");
    await writeFile(join(root, "story", "outline.md"), "大纲", "utf8");
    await writeFile(join(root, "node_modules", "pkg.txt"), "依赖", "utf8");
    await writeFile(join(root, "参考A.txt"), "参考甲", "utf8");
    await writeFile(join(root, "refs", "设定B.md"), "参考乙", "utf8");
    await writeFile(join(root, "ignore.json"), "{}", "utf8");

    const listed = await listWorkspaceReferenceFiles(root);
    expect(listed.map((item) => item.filePath)).toEqual(["refs/设定B.md", "参考A.txt"]);
  });

  it("自动识别 UTF-8 BOM 与 GB18030/GBK 并统一换行为 LF", async () => {
    const root = await makeTempBook();
    const utf8Bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("第一章 晨光\r\n山风微凉。\r\n", "utf8")]);
    await writeFile(join(root, "utf8.txt"), utf8Bom);
    await writeFile(join(root, "gbk.txt"), GBK_SAMPLE_BYTES);

    const r1 = await readBookTextFile(root, "utf8.txt");
    expect(r1).toEqual({
      text: "第一章 晨光\n山风微凉。\n",
      encoding: "utf-8",
      byteLength: utf8Bom.byteLength,
    });

    const r2 = await readBookTextFile(root, "gbk.txt");
    expect(r2.encoding).toBe("gb18030");
    expect(r2.text).toBe("第一章 算账\n灵石贷款利息。");
  });
});

describe("buildMechanicalBookIndex 零 Token 机械索引与全站上限", () => {
  it("1200 章合成长书 1 秒内完成机械索引，准确识别特征并给出 12~18 章高能推荐", () => {
    const chapters: string[] = [];
    for (let i = 1; i <= 1200; i += 1) {
      let body: string;
      if (i === 24 || i === 320) {
        body = "本月工时折算 320 枚灵石，扣除贷款利息 45 灵石、违约罚款 12 灵石，账户余额仅剩 8 块灵石，算账成本极高。".repeat(25);
      } else if (i === 88 || i === 640) {
        body = "剑光骤然轰破护山大阵，他催动真元闪避偷袭，反手一刀格挡神通，灵力激荡杀穿重围。".repeat(25);
      } else if (i === 156 || i === 900) {
        body = "古卷残篇有云：虚空仙基乃大道之始，遂凝紫府果位，皆顺天机诏命，道统亦由此立。".repeat(25);
      } else if (i === 278 || i === 512) {
        body = "“哈哈，你小子扯淡呢？！”“卧槽，啧，别吐槽我啊，咱们谁跟谁？！”他翻了个白眼。".repeat(25);
      } else if (i === 410) {
        body = "按照宗门合同第三条款，甲方拥有最高权限，乙方考核学分不足即按条例签署剥削违约书。".repeat(25);
      } else {
        body = "山路蜿蜒向上，夜色落在青石阶上，远处灯火一点点亮起。".repeat(25);
      }
      chapters.push(`第${i}章 标题${i}\n${body}`);
    }
    const fullText = chapters.join("\n\n");
    const t0 = performance.now();
    const index = buildMechanicalBookIndex({ sourceName: "合成修仙传", text: fullText });
    const elapsedMs = performance.now() - t0;

    expect(elapsedMs).toBeLessThan(1_000);
    expect(index.chapterCount).toBe(1200);
    expect(index.topChapters.bill[0]?.number).toBe(24);
    expect(index.topChapters.combat[0]?.number).toBe(88);
    expect(index.topChapters.ancient[0]?.number).toBe(156);
    expect(index.topChapters.banter[0]?.number).toBe(278);
    expect(index.chapters[409]?.dominantFeatures).toContain("institution_rule");

    const rec = index.recommendedChapters.chapterNumbers;
    expect(rec.length).toBeGreaterThanOrEqual(12);
    expect(rec.length).toBeLessThanOrEqual(20);
    expect(rec).toEqual(expect.arrayContaining([1, 2, 3, 24, 88, 156, 278, 410]));
    // 升序去重
    expect([...new Set(rec)].sort((a, b) => a - b)).toEqual(rec);
  });

  it("全站解限常量核对：file-parser 5000 章、manuscript-import 60MB/6000 章、声线扫描 500 章", () => {
    expect(MAX_CHAPTERS).toBe(5_000);
    expect(MAX_MANUSCRIPT_BYTES).toBe(60 * 1024 * 1024);
    expect(MAX_MANUSCRIPT_CHAPTERS).toBe(6_000);
    expect(MAX_SCAN_CHAPTERS).toBe(500);

    // file-parser 不再在 101 章处静默截断
    const blocks = Array.from({ length: 260 }, (_, idx) => `第${idx + 1}章\n正文${idx + 1}`).join("\n\n");
    const parsed = parseTxt(blocks);
    expect(parsed.chapters).toHaveLength(260);
    expect(parsed.warnings).toBeUndefined();
  });
});

const REAL_DOCS_ROOT = "D:/DESKTOP/文字修仙docs这个世界修仙讲科学";
const HAS_REAL_BOOKS = existsSync(join(REAL_DOCS_ROOT, "没钱11.6.txt")) && existsSync(join(REAL_DOCS_ROOT, "玄鉴11.6.txt"));

describe("真实百万字网文 TXT 只读机械索引验证", () => {
  it.skipIf(!HAS_REAL_BOOKS)("只读扫描《没钱11.6.txt》与《玄鉴11.6.txt》并输出编码、章数、字数、耗时与推荐高能章", async () => {
    for (const fileName of ["没钱11.6.txt", "玄鉴11.6.txt"]) {
      const tRead0 = performance.now();
      const loaded = await readBookTextFile(REAL_DOCS_ROOT, fileName);
      const readMs = Math.round(performance.now() - tRead0);

      const tIdx0 = performance.now();
      const index = buildMechanicalBookIndex({ sourceName: fileName.replace(/\.txt$/u, ""), text: loaded.text });
      const indexMs = Math.round(performance.now() - tIdx0);

      console.info(`[REAL_BOOK_BENCH] ${JSON.stringify({
        fileName,
        encoding: loaded.encoding,
        byteLength: loaded.byteLength,
        chapterCount: index.chapterCount,
        totalCharCount: index.totalCharCount,
        readMs,
        indexMs,
        recommendedChapters: index.recommendedChapters.chapterNumbers,
        rationale: index.recommendedChapters.rationale,
        topBill: index.topChapters.bill.slice(0, 3),
        topCombat: index.topChapters.combat.slice(0, 3),
        topAncient: index.topChapters.ancient.slice(0, 3),
        topBanter: index.topChapters.banter.slice(0, 3),
      })}`);

      expect(index.chapterCount).toBeGreaterThan(100);
      expect(index.totalCharCount).toBeGreaterThan(1_000_000);
      expect(index.recommendedChapters.chapterNumbers.length).toBeGreaterThanOrEqual(12);
    }
  });
});
