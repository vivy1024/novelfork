import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildRuleVolumeSuggestion,
  findVolumeRangeIssue,
  handleOutlineVolume,
  loadCurrentVolumeContext,
  normalizeVolumes,
  pickCurrentVolume,
  renderCurrentVolumeFocus,
  renderVolumeMarkdown,
  resolveChapterVolumeDirectory,
  type VolumeEntry,
} from "./outline-volume.js";

const tempDirs: string[] = [];
let activeStorage: StorageDatabase | undefined;

function jingweiSchema(storage: StorageDatabase): void {
  storage.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS story_jingwei_section (
      id TEXT PRIMARY KEY NOT NULL, book_id TEXT NOT NULL, key TEXT NOT NULL,
      name TEXT NOT NULL, description TEXT, "order" INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1, show_in_sidebar INTEGER DEFAULT 1,
      participates_in_ai INTEGER DEFAULT 1, default_visibility TEXT DEFAULT 'tracked',
      fields_json TEXT DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS story_jingwei_entry (
      id TEXT PRIMARY KEY NOT NULL, book_id TEXT NOT NULL, section_id TEXT NOT NULL,
      category TEXT DEFAULT 'setting', title TEXT NOT NULL, content_md TEXT DEFAULT '',
      summary_md TEXT, tags_json TEXT DEFAULT '[]', aliases_json TEXT DEFAULT '[]',
      custom_fields_json TEXT DEFAULT '{}', fields_json TEXT DEFAULT '{}',
      related_chapter_numbers_json TEXT DEFAULT '[]', related_entry_ids_json TEXT DEFAULT '[]',
      visibility_rule_json TEXT DEFAULT '{"type":"tracked"}', participates_in_ai INTEGER DEFAULT 1,
      token_budget INTEGER, layer TEXT DEFAULT 'dynamic', priority_tier TEXT DEFAULT 'auto',
      importance INTEGER DEFAULT 40, status TEXT DEFAULT 'confirmed', lifecycle TEXT DEFAULT 'active',
      sort_order INTEGER DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
  `);
}

async function createBook(options: { chapters?: number[]; targetChapters?: number } = {}): Promise<string> {
  const dir = join(tmpdir(), `novelfork-volume-${crypto.randomUUID()}`);
  await mkdir(join(dir, "chapters"), { recursive: true });
  await mkdir(join(dir, "story"), { recursive: true });
  tempDirs.push(dir);
  activeStorage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  jingweiSchema(activeStorage);
  await writeFile(join(dir, "book.json"), JSON.stringify({
    id: "book-1",
    title: "测试书",
    targetChapters: options.targetChapters ?? 90,
  }), "utf8");
  const index = (options.chapters ?? []).map((number) => ({
    number,
    title: `第${number}章`,
    fileName: `${String(number).padStart(4, "0")}-ch.md`,
    wordCount: 3000,
    status: "accepted",
  }));
  await writeFile(join(dir, "chapters", "index.json"), JSON.stringify(index), "utf8");
  return dir;
}

afterEach(async () => {
  activeStorage?.close();
  activeStorage = undefined;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("normalizeVolumes", () => {
  it("drops entries without a title and sorts by start chapter", () => {
    const volumes = normalizeVolumes([
      { title: "第二卷", chapterRange: { from: 31, to: 60 } },
      { goal: "无标题应丢弃" },
      { title: "第一卷", chapterRange: { from: 1, to: 30 }, status: "active" },
    ]);
    expect(volumes).toHaveLength(2);
    expect(volumes[0]?.title).toBe("第一卷");
    expect(volumes[0]?.status).toBe("active");
    expect(volumes[1]?.chapterRange).toEqual({ from: 31, to: 60 });
  });

  it("repairs inverted or invalid ranges", () => {
    const volumes = normalizeVolumes([{ title: "卷", chapterRange: { from: 50, to: 10 } }]);
    expect(volumes[0]?.chapterRange).toEqual({ from: 50, to: 50 });
  });
});

describe("pickCurrentVolume", () => {
  const volumes: VolumeEntry[] = [
    { id: "v1", title: "一卷", chapterRange: { from: 1, to: 30 }, goal: "", status: "done" },
    { id: "v2", title: "二卷", chapterRange: { from: 31, to: 60 }, goal: "", status: "planned" },
  ];

  it("prefers the active volume", () => {
    const withActive = [...volumes, { id: "v3", title: "三卷", chapterRange: { from: 61, to: 90 }, goal: "", status: "active" as const }];
    expect(pickCurrentVolume(withActive, 5)?.title).toBe("三卷");
  });

  it("falls back to the volume containing the latest chapter", () => {
    expect(pickCurrentVolume(volumes, 45)?.title).toBe("二卷");
  });

  it("returns null for an empty outline", () => {
    expect(pickCurrentVolume([], 3)).toBeNull();
  });
});

describe("buildRuleVolumeSuggestion", () => {
  it("splits target chapters evenly and marks the active volume", () => {
    const volumes = buildRuleVolumeSuggestion({ targetChapters: 90, volumeCount: 3, latestChapter: 35 });
    expect(volumes).toHaveLength(3);
    expect(volumes[0]?.chapterRange).toEqual({ from: 1, to: 30 });
    expect(volumes[2]?.chapterRange.to).toBe(90);
    expect(volumes[0]?.status).toBe("done");
    expect(volumes[1]?.status).toBe("active");
    expect(volumes[2]?.status).toBe("planned");
  });

  it("clamps volume count and keeps ranges contiguous", () => {
    const volumes = buildRuleVolumeSuggestion({ targetChapters: 10, volumeCount: 99 });
    expect(volumes.length).toBeLessThanOrEqual(12);
    expect(volumes[0]?.chapterRange.from).toBe(1);
  });
});

describe("renderVolumeMarkdown", () => {
  it("marks the current volume and lists ranges", () => {
    const md = renderVolumeMarkdown({
      bookId: "book-1",
      updatedAt: "2026-07-24T00:00:00.000Z",
      volumes: [{ id: "v1", title: "开篇卷", chapterRange: { from: 1, to: 20 }, goal: "立住主角动机", status: "active" }],
    });
    expect(md).toContain("## 开篇卷（当前）");
    expect(md).toContain("第 1-20 章");
    expect(md).toContain("立住主角动机");
  });
});

describe("loadCurrentVolumeContext / renderCurrentVolumeFocus", () => {
  async function seedVolumes(): Promise<void> {
    const bookRoot = await createBook({ chapters: [1, 2] });
    await handleOutlineVolume({
      bookId: "book-1",
      bookRoot,
      action: "set",
      storage: activeStorage,
      volumes: [
        { title: "开篇卷", chapterRange: { from: 1, to: 30 }, goal: "立住动机", status: "active" },
        { title: "中盘卷", chapterRange: { from: 31, to: 60 }, goal: "扩大冲突" },
      ],
    });
  }

  it("resolves physical chapter directories from the ledger chapterRange", async () => {
    await seedVolumes();
    expect(resolveChapterVolumeDirectory(activeStorage!, "book-1", 12)).toBe("卷01");
    expect(resolveChapterVolumeDirectory(activeStorage!, "book-1", 45)).toBe("卷02");
    expect(resolveChapterVolumeDirectory(activeStorage!, "book-1", 99)).toBe("卷03");
  });

  it("renders the volume goal layer that used to be missing from writing context", async () => {
    await seedVolumes();
    const context = loadCurrentVolumeContext(activeStorage!, "book-1", 12);
    expect(context.current?.title).toBe("开篇卷");
    expect(context.index).toBe(1);
    expect(context.inRange).toBe(true);

    const focus = renderCurrentVolumeFocus(context, 12);
    expect(focus).toContain("第 1 卷《开篇卷》");
    expect(focus).toContain("第 1-30 章");
    expect(focus).toContain("立住动机");
    expect(focus).toContain("本卷第 12/30 章");
  });

  it("flags a chapter number that falls outside the active volume range", async () => {
    await seedVolumes();
    const context = loadCurrentVolumeContext(activeStorage!, "book-1", 45);
    expect(context.current?.title).toBe("开篇卷");
    expect(context.inRange).toBe(false);
    expect(renderCurrentVolumeFocus(context, 45)).toContain("不在本卷区间内");
  });

  it("does not judge range when no volume outline exists", async () => {
    await createBook();
    const context = loadCurrentVolumeContext(activeStorage!, "book-1", 3);
    expect(context.current).toBeNull();
    expect(context.inRange).toBeNull();
    expect(renderCurrentVolumeFocus(context, 3)).toBe("");
  });
});

describe("volume planning fields", () => {
  it("normalizes targets and mainline beats without breaking legacy fields", () => {
    const volumes = normalizeVolumes([{
      title: "主线卷",
      chapterRange: { from: 1, to: 30 },
      goal: "完成第一次觉醒",
      targetChapters: 30,
      targetWords: 60_000,
      mainlineBeats: [
        { id: "beat-1", title: "发现异常", status: "done" },
        { name: "完成觉醒", status: "active", notes: "不能提前揭示真相" },
      ],
    }]);
    expect(volumes[0]?.targetChapters).toBe(30);
    expect(volumes[0]?.targetWords).toBe(60_000);
    expect(volumes[0]?.mainlineBeats).toEqual([
      { id: "beat-1", title: "发现异常", status: "done" },
      { id: "beat-2", title: "完成觉醒", status: "active", notes: "不能提前揭示真相" },
    ]);

    const markdown = renderVolumeMarkdown({ bookId: "book-1", volumes, updatedAt: "2026-08-06T00:00:00.000Z" });
    expect(markdown).toContain("目标章数：30");
    expect(markdown).toContain("目标字数：60000");
    expect(markdown).toContain("[已完成] 发现异常");
    expect(markdown).toContain("[进行中] 完成觉醒");
  });
});

describe("findVolumeRangeIssue", () => {
  it("rejects overlapping volume ranges on set", async () => {
    const bookRoot = await createBook();
    const result = await handleOutlineVolume({
      bookId: "book-1",
      bookRoot,
      action: "set",
      storage: activeStorage,
      volumes: [
        { title: "开篇卷", chapterRange: { from: 1, to: 30 } },
        { title: "中盘卷", chapterRange: { from: 25, to: 60 } },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("volume-range-invalid");
    expect(result.summary).toContain("区间重叠");
    expect(result.summary).toContain("建议怎么做");
    // 校验失败不得落盘
    const rows = activeStorage!.sqlite.prepare(
      `SELECT COUNT(*) AS c FROM story_jingwei_entry WHERE book_id = ? AND category = 'outline'`,
    ).get("book-1") as { c: number };
    expect(rows.c).toBe(0);
  });

  it("rejects a gap between volume ranges on set", async () => {
    const bookRoot = await createBook();
    const result = await handleOutlineVolume({
      bookId: "book-1",
      bookRoot,
      action: "set",
      storage: activeStorage,
      volumes: [
        { title: "开篇卷", chapterRange: { from: 1, to: 30 } },
        { title: "中盘卷", chapterRange: { from: 41, to: 60 } },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("volume-range-invalid");
    expect(result.summary).toContain("第 31-40 章不属于任何卷");
  });

  it("accepts contiguous ranges", () => {
    const volumes = normalizeVolumes([
      { title: "一", chapterRange: { from: 1, to: 30 } },
      { title: "二", chapterRange: { from: 31, to: 60 } },
      { title: "三", chapterRange: { from: 61, to: 90 } },
    ]);
    expect(findVolumeRangeIssue(volumes)).toBeNull();
  });
});

describe("handleOutlineVolume", () => {
  it("reports missing outline on get", async () => {
    const bookRoot = await createBook();
    const result = await handleOutlineVolume({ bookId: "book-1", bookRoot, action: "get", storage: activeStorage });
    expect(result.ok).toBe(true);
    expect(result.outline).toBeNull();
    expect(result.summary).toContain("尚未设置卷纲");
  });

  it("suggests volumes without persisting anything", async () => {
    const bookRoot = await createBook({ chapters: [1, 2, 3], targetChapters: 60 });
    const result = await handleOutlineVolume({
      bookId: "book-1", bookRoot, action: "suggest", volumeCount: 2, storage: activeStorage,
    });
    expect(result.ok).toBe(true);
    expect(result.suggestion).toHaveLength(2);
    expect(result.writtenFiles).toEqual([]);
    const rows = activeStorage!.sqlite.prepare(
      `SELECT COUNT(*) AS c FROM story_jingwei_entry WHERE book_id = ? AND category = 'outline'`,
    ).get("book-1") as { c: number };
    expect(rows.c).toBe(0);
  });

  it("writes the volume outline into jingwei as the single authority", async () => {
    const bookRoot = await createBook({ chapters: [1, 2] });
    const result = await handleOutlineVolume({
      bookId: "book-1",
      bookRoot,
      action: "set",
      storage: activeStorage,
      volumes: [
        { title: "开篇卷", chapterRange: { from: 1, to: 30 }, goal: "立住动机", status: "active" },
        { title: "中盘卷", chapterRange: { from: 31, to: 60 }, goal: "扩大冲突" },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.writtenFiles).toContain("jingwei:outline/卷纲");
    expect(result.currentVolume?.title).toBe("开篇卷");

    // 权威源在经纬：layer=dynamic，fields_json 带 volumes
    const row = activeStorage!.sqlite.prepare(
      `SELECT layer, fields_json AS fieldsJson FROM story_jingwei_entry WHERE book_id = ? AND category = 'outline'`,
    ).get("book-1") as { layer: string; fieldsJson: string };
    expect(row.layer).toBe("dynamic");
    expect((JSON.parse(row.fieldsJson) as { volumes: unknown[] }).volumes).toHaveLength(2);

    // 不再写 JSON 权威文件
    await expect(readFile(join(bookRoot, "story", "volume_outline.json"), "utf8")).rejects.toThrow();
    // md 仍作导出物
    expect(await readFile(join(bookRoot, "story", "volume_outline.md"), "utf8")).toContain("开篇卷");

    const reread = await handleOutlineVolume({ bookId: "book-1", bookRoot, action: "get", storage: activeStorage });
    expect(reread.outline?.volumes).toHaveLength(2);
    expect(reread.currentVolume?.goal).toBe("立住动机");
    expect(reread.summary).toContain("经纬 outline");
  });

  it("migrates a legacy volume_outline.json into jingwei once", async () => {
    const bookRoot = await createBook({ chapters: [1] });
    await writeFile(
      join(bookRoot, "story", "volume_outline.json"),
      JSON.stringify({
        bookId: "book-1",
        updatedAt: "2026-01-01T00:00:00.000Z",
        volumes: [{ id: "v1", title: "旧卷", chapterRange: { from: 1, to: 20 }, goal: "历史目标", status: "active" }],
      }),
      "utf8",
    );

    const migrated = await handleOutlineVolume({ bookId: "book-1", bookRoot, action: "get", storage: activeStorage });
    expect(migrated.outline?.volumes[0]?.title).toBe("旧卷");

    const row = activeStorage!.sqlite.prepare(
      `SELECT fields_json AS fieldsJson FROM story_jingwei_entry WHERE book_id = ? AND category = 'outline'`,
    ).get("book-1") as { fieldsJson: string } | undefined;
    expect(row).toBeTruthy();
    expect(JSON.parse(row!.fieldsJson).migratedFrom).toBe("story/volume_outline.json");
  });

  it("rejects set without valid volumes", async () => {
    const bookRoot = await createBook();
    const result = await handleOutlineVolume({
      bookId: "book-1", bookRoot, action: "set", volumes: [{ goal: "无标题" }], storage: activeStorage,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid-volumes");
  });

  it("requires a trusted book root", async () => {
    const result = await handleOutlineVolume({ bookId: "book-1", bookRoot: "" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("missing-book-root");
  });
});

describe("终局储备与卷纲一起持久化", () => {
  const volumes = [
    { id: "v1", title: "开篇卷", chapterRange: { from: 1, to: 30 }, goal: "立住动机", status: "active" },
    { id: "v2", title: "山门卷", chapterRange: { from: 31, to: 80 }, goal: "拿到资格", status: "planned" },
  ];
  const reserve = {
    trumpCards: [
      { id: "t1", kind: "arch-enemy", name: "血河老祖", unlockAtVolume: 2 },
      { id: "t2", kind: "ultimate-truth", name: "灭门真凶", unlockAtVolume: 2 },
    ],
    ladders: [{ id: "l1", name: "境界", totalSteps: 9, currentStep: 2, maxStepThisVolume: 3 }],
  };

  it("set 写入后 get 能读回，且给出透支报告", async () => {
    const root = await createBook({ chapters: [1, 2, 3] });
    const saved = await handleOutlineVolume({
      bookId: "book-1", bookRoot: root, action: "set",
      volumes, endgameReserve: reserve, storage: activeStorage,
    });
    expect(saved.ok).toBe(true);
    expect(saved.overdraft?.remainingTrumps).toBe(2);

    const read = await handleOutlineVolume({
      bookId: "book-1", bookRoot: root, action: "get", storage: activeStorage,
    });
    expect(read.outline?.endgameReserve?.trumpCards).toHaveLength(2);
    expect(read.outline?.endgameReserve?.ladders[0]?.totalSteps).toBe(9);
    expect(read.overdraft?.findings).toEqual([]);
  });

  it("再次 set 卷纲但不传储备时，储备不会被清掉", async () => {
    const root = await createBook({ chapters: [1] });
    await handleOutlineVolume({
      bookId: "book-1", bookRoot: root, action: "set",
      volumes, endgameReserve: reserve, storage: activeStorage,
    });
    // 只改卷纲，不带 endgameReserve
    await handleOutlineVolume({
      bookId: "book-1", bookRoot: root, action: "set",
      volumes: [{ ...volumes[0]!, goal: "改了目标" }], storage: activeStorage,
    });
    const read = await handleOutlineVolume({
      bookId: "book-1", bookRoot: root, action: "get", storage: activeStorage,
    });
    expect(read.outline?.volumes[0]?.goal).toBe("改了目标");
    expect(read.outline?.endgameReserve?.trumpCards).toHaveLength(2);
  });

  it("底牌提前动用时，get 的 summary 会带出风险", async () => {
    const root = await createBook({ chapters: [1] });
    await handleOutlineVolume({
      bookId: "book-1", bookRoot: root, action: "set", volumes,
      endgameReserve: {
        ...reserve,
        // 第 2 卷才解锁，却记为第 1 卷已动用
        trumpCards: [{ id: "t1", kind: "arch-enemy", name: "血河老祖", unlockAtVolume: 2, spentAtVolume: 1 }],
      },
      storage: activeStorage,
    });
    const read = await handleOutlineVolume({
      bookId: "book-1", bookRoot: root, action: "get", storage: activeStorage,
    });
    expect(read.overdraft?.spentLockedTrump).toBe(true);
    expect(read.summary).toContain("底牌提前动用");
  });

  it("未声明储备时 get 给出提示而非报错", async () => {
    const root = await createBook({ chapters: [1] });
    await handleOutlineVolume({
      bookId: "book-1", bookRoot: root, action: "set", volumes, storage: activeStorage,
    });
    const read = await handleOutlineVolume({
      bookId: "book-1", bookRoot: root, action: "get", storage: activeStorage,
    });
    expect(read.ok).toBe(true);
    expect(read.overdraft?.findings[0]?.code).toBe("no-reserve-declared");
  });
});
