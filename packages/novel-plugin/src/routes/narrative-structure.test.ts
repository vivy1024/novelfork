/**
 * 叙事结构聚合路由（Narrative Structure）行为契约与单测。
 *
 * 验证：
 * 1. 空书返回默认空集合，ok=true，不报 500；
 * 2. 卷大纲、章节与张力分、场景（含 0036 补齐字段）、剧情线、挂载关系、伏笔债务、实体全部单次取全；
 * 3. 伏笔债务排序与判定正确（超期优先）；
 * 4. 拒绝空 bookId。
 */

import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, runStorageMigrations, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { buildCarrierTree, buildCausalTree } from "../engine/narrative-taxonomy/scene-trees.js";
import { createScene, createStoryline, mountSceneToStoryline } from "../engine/narrative-memory/scene-store.js";
import { createNarrativeStructureRouter } from "./narrative-structure.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-structure-test-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  runStorageMigrations(storage, { migrationsDir: join(process.cwd(), "../core/src/storage/migrations") });
  return storage;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("GET /api/books/:bookId/narrative-structure", () => {
  it("空书返回空集合而非报错", async () => {
    const storage = await createStorage();
    try {
      const app = createNarrativeStructureRouter({ storage });
      const res = await app.request("/api/books/empty-book/narrative-structure");
      expect(res.status).toBe(200);

      const body = await res.json() as Record<string, unknown>;
      expect(body.ok).toBe(true);
      expect(body.bookId).toBe("empty-book");
      expect(body.currentChapter).toBe(0);
      expect(body.volumes).toEqual([]);
      expect(body.chapters).toEqual([]);
      expect(body.scenes).toEqual([]);
      expect(body.storylines).toEqual([]);
      expect(body.mounts).toEqual([]);
      expect(body.foreshadows).toEqual([]);
      expect(body.entities).toEqual([]);
    } finally {
      storage.close();
    }
  });

  it("单次请求返回全部叙事结构字段，来源与关联准确", async () => {
    const storage = await createStorage();
    try {
      const bookId = "test-book-structure";
      const now = Date.now();

      // 0. 注入作品记录（外键约束所需）
      storage.sqlite.exec(`
        INSERT INTO book (id, name, created_at, updated_at)
        VALUES ('${bookId}', '测试结构专著', ${now}, ${now});
      `);

      // 1. 注入已采纳章节
      storage.sqlite.exec(`
        INSERT INTO writing_resource (id, book_id, type, status, chapter_number, title, content, created_at, updated_at)
        VALUES
          ('ch-1', '${bookId}', 'chapter', 'accepted', 1, '第一章：风起', '第一章正文内容...', ${now}, ${now}),
          ('ch-2', '${bookId}', 'chapter', 'accepted', 2, '第二章：云涌', '第二章正文较长内容，字数更多...', ${now}, ${now});
      `);

      // 2. 注入张力评分
      storage.sqlite.exec(`
        INSERT INTO narrative_structure_score (id, book_id, chapter_number, feature_id, dimension, value, numeric_value, recorded_at)
        VALUES
          ('score-1', '${bookId}', 1, 'f-1', 'tension', '75', 75.0, ${now}),
          ('score-2', '${bookId}', 2, 'f-2', 'tension', '88', 88.5, ${now});
      `);

      // 3. 注入卷大纲（经纬 outline 条目）
      const volumePayload = {
        volumes: [
          {
            id: "vol-1",
            title: "第一卷：青云之变",
            chapterRange: { from: 1, to: 30 },
            status: "active",
            goal: "走出新手村，查清家族血案",
            mainlineBeats: ["大宴受辱", "后山得宝", "击杀外门恶霸"],
          },
        ],
      };
      storage.sqlite.exec(`
        INSERT INTO story_jingwei_section (id, book_id, key, name, "order", created_at, updated_at)
        VALUES ('sec-outline', '${bookId}', 'outline', '大纲卷次', 1, ${now}, ${now});

        INSERT INTO story_jingwei_entry (id, section_id, book_id, category, title, fields_json, created_at, updated_at)
        VALUES ('entry-vol-1', 'sec-outline', '${bookId}', 'outline', '卷纲', '${JSON.stringify(volumePayload)}', ${now}, ${now});
      `);

      // 4. 注入剧情线与场景（含 0036 新列与正交挂载）
      const mainLine = createStoryline(storage, { bookId, name: "主线：复仇", kind: "main" }).data!;
      const subLine = createStoryline(storage, { bookId, name: "支线：寻剑", kind: "sub" }).data!;

      const scene1 = createScene(storage, {
        bookId,
        chapterNumber: 1,
        ordinal: 1,
        title: "祠堂夜读",
        conflict: "被恶管家刁难",
        mood: "压抑后反弹",
        outcome: "暗中立誓",
        characters: ["萧炎", "恶管家"],
        hooksPlanted: ["黑戒微光"],
      }).data!;

      mountSceneToStoryline(storage, scene1.id, mainLine.id, "primary");
      mountSceneToStoryline(storage, scene1.id, subLine.id, "supporting");

      // 5. 注入伏笔经纬条目
      const foreshadowEntry = {
        plantedChapter: 1,
        status: "planted",
      };
      storage.sqlite.exec(`
        INSERT INTO story_jingwei_section (id, book_id, key, name, "order", created_at, updated_at)
        VALUES ('sec-foreshadow', '${bookId}', 'foreshadowing', '伏笔库', 2, ${now}, ${now});

        INSERT INTO story_jingwei_entry (id, section_id, book_id, category, title, fields_json, created_at, updated_at)
        VALUES ('entry-fs-1', 'sec-foreshadow', '${bookId}', 'foreshadowing', '黑戒来历之谜', '${JSON.stringify(foreshadowEntry)}', ${now}, ${now});
      `);

      // 6. 注入实体
      storage.sqlite.exec(`
        INSERT INTO narrative_entity (id, book_id, canonical_name, entity_type, first_chapter, last_chapter, created_at, updated_at)
        VALUES ('ent-1', '${bookId}', '萧炎', 'character', 1, 2, '${new Date().toISOString()}', '${new Date().toISOString()}');
      `);

      // 发起真实 HTTP 请求测试
      const app = createNarrativeStructureRouter({ storage });
      const res = await app.request(`/api/books/${bookId}/narrative-structure`);
      expect(res.status).toBe(200);

      const body = await res.json() as Record<string, any>;
      expect(body.ok).toBe(true);
      expect(body.bookId).toBe(bookId);
      expect(body.currentChapter).toBe(2);

      // 卷验证
      expect(body.volumes.length).toBe(1);
      expect(body.volumes[0].title).toBe("第一卷：青云之变");
      expect(body.volumes[0].mainlineBeats).toEqual(["大宴受辱", "后山得宝", "击杀外门恶霸"]);

      // 章节与张力分
      expect(body.chapters.length).toBe(2);
      expect(body.chapters[0].number).toBe(1);
      expect(body.chapters[0].tensionScore).toBe(75.0);
      expect(body.chapters[1].number).toBe(2);
      expect(body.chapters[1].tensionScore).toBe(88.5);

      // 场景（含任务 1 新字段）
      expect(body.scenes.length).toBe(1);
      expect(body.scenes[0].title).toBe("祠堂夜读");
      expect(body.scenes[0].conflict).toBe("被恶管家刁难");
      expect(body.scenes[0].characters).toEqual(["萧炎", "恶管家"]);
      expect(body.scenes[0].hooksPlanted).toEqual(["黑戒微光"]);

      // 剧情线与挂载
      expect(body.storylines.length).toBe(2);
      expect(body.mounts.length).toBe(2);
      expect(body.mounts.some((m: any) => m.sceneId === scene1.id && m.storylineId === mainLine.id && m.role === "primary")).toBe(true);

      // 伏笔债务计算
      expect(body.foreshadows.length).toBe(1);
      expect(body.foreshadows[0].title).toBe("黑戒来历之谜");
      expect(body.foreshadows[0].plantedChapter).toBe(1);
      expect(body.foreshadows[0].chaptersPending).toBe(1);

      // 实体
      expect(body.entities.length).toBe(1);
      expect(body.entities[0].canonicalName).toBe("萧炎");

      // 验证单次请求返回的数据可直接驱动承载树与因果树装配
      const carrier = buildCarrierTree({
        volumes: body.volumes,
        chapters: body.chapters,
        scenes: body.scenes,
      });
      expect(carrier.root.children.length).toBeGreaterThan(0);
      expect(carrier.root.children[0].label).toContain("第一卷：青云之变");

      const causal = buildCausalTree({
        storylines: body.storylines,
        scenes: body.scenes,
        mounts: body.mounts,
      });
      expect(causal.root.children.length).toBeGreaterThan(0);
      expect(causal.root.children.some((t) => t.label.includes("主线：复仇"))).toBe(true);
    } finally {
      storage.close();
    }
  });

  it("拒绝空 bookId", async () => {
    const storage = await createStorage();
    try {
      const app = createNarrativeStructureRouter({ storage });
      const res = await app.request("/api/books/%20/narrative-structure");
      expect(res.status).toBe(400);
    } finally {
      storage.close();
    }
  });
});

describe("GET /api/books/:bookId/narrative-structure 伏笔阈值按书设置", () => {
  async function seedBook(storage: StorageDatabase, bookId: string): Promise<void> {
    const now = Date.now();
    storage.sqlite.exec(`
      INSERT INTO book (id, name, created_at, updated_at) VALUES ('${bookId}', '阈值测试', ${now}, ${now});
      INSERT INTO writing_resource (id, book_id, type, status, chapter_number, title, content, created_at, updated_at)
      VALUES
        ('${bookId}-ch-1', '${bookId}', 'chapter', 'accepted', 1, '第一章', '正文', ${now}, ${now}),
        ('${bookId}-ch-2', '${bookId}', 'chapter', 'accepted', 2, '第二章', '正文', ${now}, ${now}),
        ('${bookId}-ch-3', '${bookId}', 'chapter', 'accepted', 3, '第三章', '正文', ${now}, ${now});
      INSERT INTO story_jingwei_section (id, book_id, key, name, "order", created_at, updated_at)
      VALUES ('${bookId}-sec', '${bookId}', 'foreshadowing', '伏笔库', 1, ${now}, ${now});
      INSERT INTO story_jingwei_entry (id, section_id, book_id, category, title, fields_json, created_at, updated_at)
      VALUES ('${bookId}-fs', '${bookId}-sec', '${bookId}', 'foreshadowing', '断剑之谜', '{"plantedChapter":1,"status":"planted"}', ${now}, ${now});
    `);
  }

  it("作者在 book.json 设置的阈值决定伏笔判定，并随快照返回", async () => {
    const storage = await createStorage();
    try {
      await seedBook(storage, "fast-book");
      const app = createNarrativeStructureRouter({
        storage,
        loadBookConfig: async () => ({ foreshadowDebtThresholds: { watchChapters: 1, overdueChapters: 2 } }),
      });
      const body = await (await app.request("/api/books/fast-book/narrative-structure")).json() as any;
      // 悬置 2 章：默认阈值下还是 ok，这本书把超期线设为 2 章，所以已超期。
      expect(body.foreshadowThresholds).toEqual({ watchChapters: 1, overdueChapters: 2 });
      expect(body.foreshadows[0].chaptersPending).toBe(2);
      expect(body.foreshadows[0].urgency).toBe("overdue");
    } finally {
      storage.close();
    }
  });

  it("没设置、设置不合法或读不到 book.json 时用默认阈值，快照照常返回", async () => {
    const storage = await createStorage();
    try {
      await seedBook(storage, "default-book");
      const loaders = [
        undefined,
        async () => ({}),
        async () => ({ foreshadowDebtThresholds: { watchChapters: 8, overdueChapters: 3 } }),
        async () => {
          throw new Error("book.json 损坏");
        },
      ];
      for (const loadBookConfig of loaders) {
        const app = createNarrativeStructureRouter({ storage, ...(loadBookConfig ? { loadBookConfig } : {}) });
        const res = await app.request("/api/books/default-book/narrative-structure");
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.foreshadowThresholds).toEqual({ watchChapters: 5, overdueChapters: 12 });
        expect(body.foreshadows[0].urgency).toBe("ok");
      }
    } finally {
      storage.close();
    }
  });
});
