import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 读取仓库内源码做契约断言；兼容 vitest 下 import.meta.url 非 file 协议的情况。 */
function sourcePath(relativeFromPackageRoot: string): string {
  return import.meta.url.startsWith("file:")
    ? resolve(dirname(fileURLToPath(import.meta.url)), "../..", relativeFromPackageRoot)
    : resolve(process.cwd(), relativeFromPackageRoot);
}

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ensureNarrativeMemorySchema,
  insertNarrativeEvent,
  updateNarrativeEventStatus,
} from "../engine/narrative-memory/storage.js";
import type { NarrativeEvent } from "../engine/narrative-memory/types.js";
import type { CockpitState } from "./cockpit-service.js";

let activeStorage: StorageDatabase | undefined;

/** T-13：对指定路径的 readFile 注入错误码，模拟 book.json 被同步盘/杀软占用或无权限。默认透传。 */
const fsControl = vi.hoisted(() => ({ readFailures: new Map<string, string>() }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const readFile = (async (path: Parameters<typeof actual.readFile>[0], ...rest: unknown[]) => {
    const code = fsControl.readFailures.get(String(path));
    if (code) {
      const error = new Error(`${code}: resource busy or locked, open '${String(path)}'`) as NodeJS.ErrnoException;
      error.code = code;
      throw error;
    }
    return (actual.readFile as (...args: unknown[]) => Promise<unknown>)(path, ...rest);
  }) as typeof actual.readFile;
  // jsdom 环境下内置模块的具名导入经 default 互操作读取，default 也要替换（同 chapter-path-guard.test.ts 的写法）。
  return { ...actual, readFile, default: { ...actual, readFile } };
});

vi.mock("@vivy1024/novelfork-core", () => ({
  getStorageDatabase: () => {
    if (!activeStorage) throw new Error("test storage not initialized");
    return activeStorage;
  },
}));

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-write-preflight-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  const storage = createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
  storage.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS book (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS story_jingwei_entry (
      id TEXT PRIMARY KEY NOT NULL,
      book_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content_md TEXT,
      fields_json TEXT,
      related_chapter_numbers_json TEXT,
      category TEXT,
      sort_order INTEGER DEFAULT 0,
      updated_at TEXT,
      deleted_at TEXT
    );
  `);
  storage.sqlite.prepare(`INSERT INTO book (id, name, created_at, updated_at) VALUES ('book-1', '测试书', 0, 0)`).run();
  ensureNarrativeMemorySchema(storage);
  return storage;
}

function pendingHighRiskEvent(id: string, chapterNumber: number): NarrativeEvent {
  return {
    ...appliedEvent({ id, chapterNumber }),
    eventType: "world_fact_introduced",
    status: "pending",
    riskLevel: "high",
  };
}

function appliedEvent(partial: Partial<NarrativeEvent> & Pick<NarrativeEvent, "id" | "chapterNumber">): NarrativeEvent {
  return {
    id: partial.id,
    bookId: "book-1",
    chapterNumber: partial.chapterNumber,
    eventType: "timeline_advanced",
    subject: partial.subject ?? "主角",
    predicate: partial.predicate ?? "完成",
    object: partial.object ?? `第${partial.chapterNumber}章关键事件`,
    evidenceText: partial.evidenceText ?? `第${partial.chapterNumber}章发生了关键事件。`,
    confidence: 0.9,
    source: "settle",
    status: "applied",
    riskLevel: "low",
    createdAt: "2026-06-22T00:00:00.000Z",
    appliedAt: "2026-06-22T00:00:00.000Z",
  };
}

function cockpitState(input: {
  formalChapterCount?: number;
  focus?: string | null;
}): CockpitState {
  const formalChapterCount = input.formalChapterCount ?? 0;
  return {
    loadBookConfig: async () => ({
      id: "book-1",
      title: "测试书",
      genre: "xianxia",
      platform: "qidian",
      status: "writing",
      chapterWordCount: 3000,
      language: "zh",
    }) as any,
    loadChapterIndex: async () => Array.from({ length: formalChapterCount }, (_, i) => ({
      number: i + 1,
      title: `第${i + 1}章`,
      wordCount: 3000,
      status: "published",
    })) as any,
    bookDir: () => "/tmp/book-1",
  };
}

beforeEach(async () => {
  activeStorage = await createStorage();
});

afterEach(async () => {
  fsControl.readFailures.clear();
  activeStorage?.close();
  activeStorage = undefined;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("write.preflight：book.json 读不出是独立阻断（T-13）", () => {
  async function bookRootWith(content: string | null): Promise<string> {
    const bookRoot = join(tmpdir(), `novelfork-t13-config-${crypto.randomUUID()}`);
    tempDirs.push(bookRoot);
    await mkdir(bookRoot, { recursive: true });
    if (content !== null) await writeFile(join(bookRoot, "book.json"), content, "utf-8");
    return bookRoot;
  }

  async function preflight(bookRoot: string, state?: CockpitState) {
    const { handleWritePreflight } = await import("./write-preflight.js");
    return handleWritePreflight({
      bookId: "book-1",
      userDirectives: "继续写药园试探，推进小瓶秘密。",
      storage: activeStorage,
      bookRoot,
      ...(state ? { cockpitState: state } : {}),
    });
  }

  it("内容损坏：即使没有高风险待审事件也阻断，explanation 用「损坏」措辞", async () => {
    const bookRoot = await bookRootWith("{ this is not valid json");
    const result = await preflight(bookRoot, cockpitState({ formalChapterCount: 0 }));

    expect(result.ok).toBe(false);
    const blocker = result.blockers.find((item) => item.code === "book-config-unreadable");
    expect(blocker, "corrupt book.json must be an independent blocker").toBeDefined();
    expect(blocker?.explanation?.whatHappened).toMatch(/损坏|不是合法/u);
    expect(blocker?.explanation?.whyItMatters).toBeTruthy();
    expect(blocker?.explanation?.suggestedAction).toMatch(/备份|修复/u);
  });

  it("文件被占用或无权限（EBUSY/EPERM/EACCES）：阻断，explanation 提示稍后重试或检查占用", async () => {
    for (const code of ["EBUSY", "EPERM", "EACCES"]) {
      const bookRoot = await bookRootWith(JSON.stringify({ id: "book-1", title: "测试书" }));
      fsControl.readFailures.set(join(bookRoot, "book.json"), code);
      const result = await preflight(bookRoot, cockpitState({ formalChapterCount: 0 }));

      expect(result.ok, `${code} must block`).toBe(false);
      const blocker = result.blockers.find((item) => item.code === "book-config-unreadable");
      expect(blocker, `${code} must be reported as book-config-unreadable`).toBeDefined();
      expect(blocker?.explanation?.whatHappened).toContain(code);
      expect(blocker?.explanation?.suggestedAction).toMatch(/稍后重试/u);
      expect(blocker?.explanation?.suggestedAction).toMatch(/占用/u);
      expect(blocker?.explanation?.whatHappened).not.toMatch(/损坏/u);
      fsControl.readFailures.clear();
    }
  });

  it("驾驶舱自己读 book.json（生产路径）时，损坏报 book-config-unreadable，不误报成书不存在", async () => {
    const bookRoot = await bookRootWith("{ broken");
    const result = await preflight(bookRoot);

    expect(result.ok).toBe(false);
    expect(result.blockers.map((item) => item.code)).toContain("book-config-unreadable");
    expect(result.blockers.map((item) => item.code)).not.toContain("book-not-found");
  });

  it("对照：book.json 不存在（新书）不报 book-config-unreadable；可读时也不报", async () => {
    const missing = await preflight(await bookRootWith(null), cockpitState({ formalChapterCount: 0 }));
    expect(missing.blockers.map((item) => item.code)).not.toContain("book-config-unreadable");

    const readable = await preflight(
      await bookRootWith(JSON.stringify({ id: "book-1", title: "测试书" })),
      cockpitState({ formalChapterCount: 0 }),
    );
    expect(readable.blockers.map((item) => item.code)).not.toContain("book-config-unreadable");
    expect(readable.ok).toBe(true);
  });
});

describe("write.preflight", () => {
  it("allows clean open when book has no formal chapters", async () => {
    const { handleWritePreflight } = await import("./write-preflight.js");
    const result = await handleWritePreflight({
      bookId: "book-1",
      userDirectives: "开篇写主角下山寻仇，先从客栈冲突切入。",
      storage: activeStorage,
      cockpitState: cockpitState({ formalChapterCount: 0, focus: null }),
    });

    expect(result.ok).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.formalChapterCount).toBe(0);
    expect(result.resolvedDirective).toContain("开篇写主角下山寻仇");
  });

  it("blocks missing directive when no focus is available", async () => {
    const { handleWritePreflight } = await import("./write-preflight.js");
    const result = await handleWritePreflight({
      bookId: "book-1",
      storage: activeStorage,
      cockpitState: cockpitState({ formalChapterCount: 0 }),
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.some((item) => item.code === "missing-directive")).toBe(true);
  });

  it("uses focus default and sets needsUserConfirm", async () => {
    activeStorage!.sqlite.prepare(`
      INSERT INTO story_jingwei_entry (id, book_id, title, content_md, category, updated_at, deleted_at)
      VALUES ('focus-1', 'book-1', '当前焦点', '本章推进：药园试探小瓶秘密', 'focus', '2026-06-22T00:00:00.000Z', NULL)
    `).run();

    const { handleWritePreflight } = await import("./write-preflight.js");
    const result = await handleWritePreflight({
      bookId: "book-1",
      storage: activeStorage,
      cockpitState: cockpitState({ formalChapterCount: 0 }),
    });

    expect(result.resolvedDirective).toContain("药园试探小瓶秘密");
    expect(result.needsUserConfirm).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("blocks empty-recent-progress when formal chapters exist but memory is empty", async () => {
    const { handleWritePreflight } = await import("./write-preflight.js");
    const result = await handleWritePreflight({
      bookId: "book-1",
      userDirectives: "继续写药园试探，推进小瓶秘密。",
      storage: activeStorage,
      cockpitState: cockpitState({ formalChapterCount: 3 }),
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.some((item) => item.code === "empty-recent-progress")).toBe(true);
  });

  it("passes when formal chapters have applied memory events", async () => {
    insertNarrativeEvent(activeStorage!, appliedEvent({ id: "e-10", chapterNumber: 10 }));
    insertNarrativeEvent(activeStorage!, appliedEvent({ id: "e-11", chapterNumber: 11 }));

    const { handleWritePreflight } = await import("./write-preflight.js");
    const result = await handleWritePreflight({
      bookId: "book-1",
      userDirectives: "继续写药园试探，推进小瓶秘密。",
      storage: activeStorage,
      cockpitState: cockpitState({ formalChapterCount: 11 }),
    });

    expect(result.ok).toBe(true);
    expect(result.recentChapters.length).toBeGreaterThan(0);
    expect(result.memoryHealth.timeline).toBe("ok");
    expect(result.warningItems.some((item) => item.code === "style-disabled")).toBe(true);
  });

  it("attaches human-readable explanation to blockers and warnings", async () => {
    const { handleWritePreflight } = await import("./write-preflight.js");
    const result = await handleWritePreflight({
      bookId: "book-1",
      userDirectives: "继续写药园试探，推进小瓶秘密。",
      storage: activeStorage,
      cockpitState: cockpitState({ formalChapterCount: 3 }),
    });

    const blocker = result.blockers.find((item) => item.code === "empty-recent-progress");
    expect(blocker?.kind).toBe("persistent");
    expect(blocker?.explanation?.whatHappened).toBeTruthy();
    expect(blocker?.explanation?.suggestedAction).toContain("补结算近章记忆");

    const warning = result.warningItems.find((item) => item.code === "style-disabled");
    expect(warning?.kind).toBe("advisory");
    expect(warning?.explanation?.whyItMatters).toBeTruthy();
  });

  it("resolves the platform profile and warns on chapter target mismatch", async () => {
    const { handleWritePreflight } = await import("./write-preflight.js");
    const result = await handleWritePreflight({
      bookId: "book-1",
      userDirectives: "开篇写主角下山寻仇，先从客栈冲突切入。",
      storage: activeStorage,
      cockpitState: {
        ...cockpitState({ formalChapterCount: 0 }),
        loadBookConfig: async () => ({
          id: "book-1",
          title: "测试书",
          platform: "tomato",
          genre: "xianxia",
          status: "writing",
          chapterWordCount: 9000,
          language: "zh",
        }) as never,
      },
    });

    expect(result.platform?.platform).toBe("fanqie");
    expect(result.platform?.label).toBe("番茄小说");
    expect(result.platform?.chapterTargetStatus).toBe("above-max");
    expect(result.warningItems.some((item) => item.code === "platform-target-mismatch")).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("blocks writing when book.json is unreadable and high-risk pending events exist (T-13)", async () => {
    const bookRoot = join(tmpdir(), `novelfork-t13-${crypto.randomUUID()}`);
    tempDirs.push(bookRoot);
    await mkdir(bookRoot, { recursive: true });
    await writeFile(join(bookRoot, "book.json"), "{ this is not valid json", "utf-8");
    insertNarrativeEvent(activeStorage!, pendingHighRiskEvent("e-t13-high", 10));

    const { handleWritePreflight } = await import("./write-preflight.js");
    const result = await handleWritePreflight({
      bookId: "book-1",
      userDirectives: "继续写药园试探，推进小瓶秘密。",
      storage: activeStorage,
      bookRoot,
      cockpitState: cockpitState({ formalChapterCount: 11 }),
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.some((item) => item.code === "high-risk-pending")).toBe(true);
  });

});

/**
 * 高风险待确认事件门禁（作者 2026-10-15 的决定）：没有本书开关，存在就停写；
 * 放行只走 NarraFork 的通道——AskUserQuestion 请作者逐条批准/驳回，再按选择调 memory.events approve/reject，
 * 或作者在「待确认」面板处理。NovelFork 不按权限模式替作者放行。
 */
describe("write.preflight：高风险待确认事件一律阻断，放行只走 NarraFork 的通道", () => {
  async function bookRootWithJson(book: Record<string, unknown>): Promise<string> {
    const bookRoot = join(tmpdir(), `novelfork-high-risk-${crypto.randomUUID()}`);
    tempDirs.push(bookRoot);
    await mkdir(bookRoot, { recursive: true });
    await writeFile(join(bookRoot, "book.json"), JSON.stringify({ id: "book-1", title: "测试书", ...book }), "utf-8");
    return bookRoot;
  }

  async function preflight(bookRoot?: string) {
    const { handleWritePreflight } = await import("./write-preflight.js");
    return handleWritePreflight({
      bookId: "book-1",
      userDirectives: "开篇写主角下山寻仇，先从客栈冲突切入。",
      storage: activeStorage,
      ...(bookRoot ? { bookRoot } : {}),
      cockpitState: cockpitState({ formalChapterCount: 0, focus: null }),
    });
  }

  function expectReleaseFlow(text: string | undefined): void {
    const value = text ?? "";
    expect(value).toContain("AskUserQuestion");
    expect(value).toContain("memory.events");
    expect(value).toContain("approve");
    expect(value).toContain("reject");
    expect(value).toContain("「待确认」面板");
    // 同步阻塞地问作者，不用异步提问；也不许绕过。
    expect(value).toMatch(/不要用异步|不要 async/u);
    expect(value).toContain("不要换别的工具绕过");
  }

  it("没有任何本书设置时，存在高风险待确认事件就阻断，三段式说明写明 AskUserQuestion → memory.events 的流程", async () => {
    const bookRoot = await bookRootWithJson({});
    insertNarrativeEvent(activeStorage!, { ...pendingHighRiskEvent("e-hr-1", 3), subject: "山门", predicate: "规则", object: "外人入山者死" });

    const result = await preflight(bookRoot);

    expect(result.ok).toBe(false);
    const blocker = result.blockers.find((item) => item.code === "high-risk-pending");
    expect(blocker).toBeTruthy();
    expect(blocker?.explanation?.whatHappened).toContain("外人入山者死");
    expect(blocker?.explanation?.whyItMatters).toBeTruthy();
    expectReleaseFlow(blocker?.explanation?.suggestedAction);
    // 不再有「只提醒、默认不拦」的分支。
    expect(result.warningItems.some((item) => item.code === "high-risk-pending")).toBe(false);
    expect(result.warnings.join("\n")).not.toContain("高风险");
  });

  it("不传 bookRoot 时同样阻断（门禁不依赖任何本书配置）", async () => {
    insertNarrativeEvent(activeStorage!, pendingHighRiskEvent("e-hr-noroot", 3));

    const result = await preflight();

    expect(result.ok).toBe(false);
    expect(result.blockers.some((item) => item.code === "high-risk-pending")).toBe(true);
  });

  it("旧书 book.json 残留 blockWriteOnHighRiskPending=false：正常读取，照样阻断", async () => {
    const bookRoot = await bookRootWithJson({
      narrativeMemory: { settlement: { blockWriteOnHighRiskPending: false, minConfidence: 0.8 } },
    });
    insertNarrativeEvent(activeStorage!, pendingHighRiskEvent("e-hr-legacy", 3));

    const result = await preflight(bookRoot);

    expect(result.blockers.some((item) => item.code === "book-config-unreadable")).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.blockers.some((item) => item.code === "high-risk-pending")).toBe(true);
  });

  it("作者批准或驳回后放行；只剩中风险待确认时不阻断", async () => {
    const bookRoot = await bookRootWithJson({});
    insertNarrativeEvent(activeStorage!, pendingHighRiskEvent("e-hr-approve", 3));
    insertNarrativeEvent(activeStorage!, pendingHighRiskEvent("e-hr-reject", 4));
    insertNarrativeEvent(activeStorage!, { ...pendingHighRiskEvent("e-medium", 4), riskLevel: "medium" });

    expect((await preflight(bookRoot)).ok).toBe(false);

    updateNarrativeEventStatus(activeStorage!, { id: "e-hr-approve", status: "applied" });
    expect((await preflight(bookRoot)).ok).toBe(false);

    updateNarrativeEventStatus(activeStorage!, { id: "e-hr-reject", status: "rejected" });
    const released = await preflight(bookRoot);
    expect(released.blockers).toEqual([]);
    expect(released.ok).toBe(true);
  });

  it("没有高风险待确认事件时照常放行", async () => {
    const bookRoot = await bookRootWithJson({});
    const result = await preflight(bookRoot);
    expect(result.ok).toBe(true);
    expect(result.blockers).toEqual([]);
  });
});

describe("assertDirectiveReady", () => {
  it("requires acceptFocusDefault when only focus default is available", async () => {
    const { assertDirectiveReady } = await import("./write-preflight.js");
    const blocked = assertDirectiveReady({
      preflight: {
        ok: true,
        resolvedDirective: "按当前焦点推进：药园试探",
        needsUserConfirm: true,
        blockers: [],
      },
    });
    expect(blocked.ok).toBe(false);

    const accepted = assertDirectiveReady({
      acceptFocusDefault: true,
      preflight: {
        ok: true,
        resolvedDirective: "按当前焦点推进：药园试探",
        needsUserConfirm: true,
        blockers: [],
      },
    });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.directive).toContain("药园试探");
  });
});

describe("Writing Skills 入口只告知不阻断", () => {
  it("skills-not-acknowledged 不再出现在 blockers 里", async () => {
    insertNarrativeEvent(activeStorage!, appliedEvent({ id: "e-20", chapterNumber: 10 }));
    insertNarrativeEvent(activeStorage!, appliedEvent({ id: "e-21", chapterNumber: 11 }));

    const { handleWritePreflight } = await import("./write-preflight.js");
    const result = await handleWritePreflight({
      bookId: "book-1",
      userDirectives: "继续写药园试探，推进小瓶秘密。",
      storage: activeStorage,
      cockpitState: cockpitState({ formalChapterCount: 11 }),
      // 故意不传 acknowledgedSkills / loadedSkills：入口不该因此拦人。
    });

    // 弱证据（agent 自称的原文引用）不再硬拦；技能是否生效由出口查成品。
    expect(result.blockers.some((item) => item.code === "skills-not-acknowledged")).toBe(false);
  });

  it("缺技能引用与缺 loadedSkills 都不影响 ok", async () => {
    insertNarrativeEvent(activeStorage!, appliedEvent({ id: "e-22", chapterNumber: 10 }));
    insertNarrativeEvent(activeStorage!, appliedEvent({ id: "e-23", chapterNumber: 11 }));

    const { handleWritePreflight } = await import("./write-preflight.js");
    const result = await handleWritePreflight({
      bookId: "book-1",
      userDirectives: "继续写药园试探，推进小瓶秘密。",
      storage: activeStorage,
      cockpitState: cockpitState({ formalChapterCount: 11 }),
    });

    expect(result.ok).toBe(true);
  });

  it("若产出 skills-not-acknowledged 提醒，必须带 explanation 三段式", async () => {
    insertNarrativeEvent(activeStorage!, appliedEvent({ id: "e-24", chapterNumber: 10 }));
    insertNarrativeEvent(activeStorage!, appliedEvent({ id: "e-25", chapterNumber: 11 }));

    const { handleWritePreflight } = await import("./write-preflight.js");
    const result = await handleWritePreflight({
      bookId: "book-1",
      userDirectives: "继续写药园试探，推进小瓶秘密。",
      storage: activeStorage,
      cockpitState: cockpitState({ formalChapterCount: 11 }),
    });

    const warning = result.warningItems.find((item) => item.code === "skills-not-acknowledged");
    // 本书未启用技能时不产出该提醒；一旦产出就必须可直接转述，不许前端按 code 造文案。
    if (warning) {
      expect(warning.explanation?.whatHappened).toBeTruthy();
      expect(warning.explanation?.whyItMatters).toBeTruthy();
      expect(warning.explanation?.suggestedAction).toBeTruthy();
    }
  });

  it("返回 writingSkillConstraints 摘要供 scene.spec 使用", async () => {
    insertNarrativeEvent(activeStorage!, appliedEvent({ id: "e-26", chapterNumber: 10 }));
    insertNarrativeEvent(activeStorage!, appliedEvent({ id: "e-27", chapterNumber: 11 }));

    const { handleWritePreflight } = await import("./write-preflight.js");
    const result = await handleWritePreflight({
      bookId: "book-1",
      userDirectives: "继续写药园试探，推进小瓶秘密。",
      storage: activeStorage,
      cockpitState: cockpitState({ formalChapterCount: 11 }),
    });

    // 字段必须始终存在（未启用技能时为空摘要），否则下游要到处判 undefined。
    expect(result.writingSkillConstraints).toBeTruthy();
    expect(Array.isArray(result.writingSkillConstraints.items)).toBe(true);
    expect(typeof result.writingSkillConstraints.blockingCount).toBe("number");
  });
});

describe("审修阶段的技能约束来源", () => {
  it("ReviserAgent 不保留无人传值的 writingSkillConstraints 死参数", async () => {
    // 管线 v2 已把 Auditor+Reviser 合并为 chapter-audit-v2 的确定性审计，
    // reviseChapter 没有生产调用方。约束改由 sceneSpec.constraints 流到审计，
    // 这里锁死「不留永不生效的参数」——留着会让人误以为它在工作。
    const source = await readFile(sourcePath("src/engine/agents/reviser.ts"), "utf8");
    expect(source).not.toContain("writingSkillConstraints");
  });

  it("确定性审计接收 sceneSpec.constraints，约束经此进入审修", async () => {
    const source = await readFile(sourcePath("src/handlers/chapter-audit-v2.ts"), "utf8");
    expect(source).toContain("constraints");
  });
});

describe("scene.spec hard gate descriptions", () => {
  it("requires write.preflight in tool registry description", async () => {
    const { NOVEL_SESSION_TOOL_DEFINITIONS } = await import("./tool-registry.js");
    const preflight = NOVEL_SESSION_TOOL_DEFINITIONS.find((tool) => tool.name === "write.preflight");
    const scene = NOVEL_SESSION_TOOL_DEFINITIONS.find((tool) => tool.name === "scene.spec");
    const pipeline = NOVEL_SESSION_TOOL_DEFINITIONS.find((tool) => tool.name === "pipeline.write");

    expect(preflight).toBeTruthy();
    expect(scene?.description).toContain("write.preflight");
    expect(pipeline?.description).toContain("write.preflight");
    expect(pipeline?.description).toContain("context-not-ready");
  });
});
