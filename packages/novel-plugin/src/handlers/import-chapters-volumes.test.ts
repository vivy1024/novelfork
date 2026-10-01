import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import * as coreModule from "@vivy1024/novelfork-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { executeRuntimeDomainTool, type TrustedRuntimeBookBinding } from "./runtime-domain-tools.js";

const tempDirs: string[] = [];
let activeStorage: StorageDatabase | undefined;
let testDir: string;
let binding: TrustedRuntimeBookBinding;

beforeEach(async () => {
  testDir = join(tmpdir(), `novelfork-import-volumes-${crypto.randomUUID()}`);
  await mkdir(join(testDir, "chapters"), { recursive: true });
  tempDirs.push(testDir);
  activeStorage = createStorageDatabase({ databasePath: join(testDir, "novelfork.db") });
  runStorageMigrations(activeStorage, { migrationsDir: join(process.cwd(), "..", "core", "src", "storage", "migrations") });
  activeStorage.sqlite.prepare(`INSERT INTO "book" (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run("book-test-1", "测试书", Date.now(), Date.now());
  vi.spyOn(coreModule, "getStorageDatabase").mockImplementation(() => activeStorage!);
  binding = { bookId: "book-test-1", root: testDir };
});

afterEach(async () => {
  if (activeStorage) {
    activeStorage.close();
    activeStorage = undefined;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("pipeline.import_chapters 的卷结构（T4.2 旧稿导入）", () => {
  it("带卷标题的旧稿：按卷分目录写章，并把卷纲落成经纬 outline", async () => {
    const filler = "这是一段足够长的正文，用来超过 1000 字的最小导入门槛。";
    const content = [
      "第一卷 光与影",
      "第一章 正义",
      filler.repeat(20),
      "第二章 坠落",
      filler.repeat(5),
      "第二卷 血海",
      "第三章 报仇",
      filler.repeat(5),
      "　第四卷　带空格的卷名",
      "第四章 折返",
      filler.repeat(5),
    ].join("\r\n");

    const result = await executeRuntimeDomainTool(
      "pipeline.import_chapters",
      { content, sourceName: "测试旧稿.txt", autoSettle: false, extractBrief: false } as never,
      binding,
      {} as never,
    );
    expect(result.ok).toBe(true);

    // 卷号按出现的顺序编号（不是原文「第四卷」那个汉字数字）：第 1、2 章在卷01；第 3 章在卷02；第 4 章在卷03
    const volumes = (await readdir(join(testDir, "chapters"))).filter((name) => name.startsWith("卷"));
    expect(volumes).toEqual(["卷01", "卷02", "卷03"]);
    const vol01 = await readdir(join(testDir, "chapters", "卷01"));
    expect(vol01).toHaveLength(2);
    const vol02 = await readdir(join(testDir, "chapters", "卷02"));
    expect(vol02).toHaveLength(1);

    const index = JSON.parse(await readFile(join(testDir, "chapters", "index.json"), "utf8")) as Array<{ fileName: string; number: number }>;
    expect(index.map((entry) => entry.fileName)).toEqual([
      "卷01/0001_正义.md",
      "卷01/0002_坠落.md",
      "卷02/0003_报仇.md",
      "卷03/0004_折返.md",
    ]);

    // 卷纲落到经纬 outline 分类
    const outline = activeStorage!.sqlite.prepare(
      `SELECT fields_json FROM story_jingwei_entry WHERE book_id = ? AND category = 'outline'`,
    ).all(binding.bookId) as Array<{ fields_json: string }>;
    expect(outline).toHaveLength(1);
    const fields = JSON.parse(outline[0]!.fields_json);
    expect(fields.volumes).toEqual([
      { title: "光与影", chapterRange: { from: 1, to: 2 } },
      { title: "血海", chapterRange: { from: 3, to: 3 } },
      { title: "带空格的卷名", chapterRange: { from: 4, to: 4 } },
    ]);
    expect(fields.importedFrom).toBe("测试旧稿.txt");
  });

  it("自定义 pattern 时不做卷捕获（与 splitChapters 兼容）", async () => {
    const content = `第一卷 x\r\n第一章 甲\r\n${"一段足够长的正文，过千字的门槛。".repeat(80)}\r\n第二章 乙\r\n第二段。`;
    const result = await executeRuntimeDomainTool(
      "pipeline.import_chapters",
      { content, splitPattern: "^第[一二三四五六七八九十百千万\\d]+章", autoSettle: false, extractBrief: false } as never,
      binding,
      {} as never,
    );
    expect(result.ok).toBe(true);
    const volumes = (await readdir(join(testDir, "chapters"))).filter((name) => name.startsWith("卷"));
    expect(volumes).toEqual(["卷01"]);
  });

  it("CRLF 正文里卷标题也能识别（之前 `…$\r` 不匹配导致全书进卷01）", async () => {
    const content = `第一卷 光\r\n第一章 甲\r\n${"一段足够长的正文，过千字的门槛。".repeat(80)}\r\n第二卷 影\r\n第二章 乙\r\nB。`;
    const result = await executeRuntimeDomainTool(
      "pipeline.import_chapters",
      { content, autoSettle: false, extractBrief: false } as never,
      binding,
      {} as never,
    );
    expect(result.ok).toBe(true);
    const volumes = (await readdir(join(testDir, "chapters"))).filter((name) => name.startsWith("卷"));
    expect(volumes).toEqual(["卷01", "卷02"]);
  });
});
