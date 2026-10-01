import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { afterEach, describe, expect, it } from "vitest";

import { createNarrativeMemoryRouter } from "./narrative-memory.js";
import { insertRetrievalLog } from "../engine/narrative-memory/storage.js";
import type { NarrativeRetrievalDiagnostics } from "../engine/narrative-memory/types.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<StorageDatabase> {
  const dir = join(tmpdir(), `novelfork-write-injection-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  return createStorageDatabase({ databasePath: join(dir, "novelfork.db") });
}

async function createBookRoot(): Promise<string> {
  const dir = join(tmpdir(), `novelfork-write-injection-book-${crypto.randomUUID()}`);
  await mkdir(dir, { recursive: true });
  tempDirs.push(dir);
  await writeFile(join(dir, "book.json"), `${JSON.stringify({ id: "book-1", title: "测试书籍" }, null, 2)}\n`, "utf8");
  return dir;
}

async function addProjectSkill(bookRoot: string, slug: string, name: string, entry?: string): Promise<void> {
  await mkdir(join(bookRoot, ".novelfork", "skills", slug), { recursive: true });
  await writeFile(
    join(bookRoot, ".novelfork", "skills", slug, "SKILL.md"),
    `---\nname: ${name}\ndescription: 测试技能${entry ? `\nentry: ${entry}` : ""}\nkind: prose\nmode: manual\n---\n\n技能正文：写章时要注意节奏。\n`,
    "utf8",
  );
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function diagnostics(overrides: Partial<NarrativeRetrievalDiagnostics> = {}): NarrativeRetrievalDiagnostics {
  return {
    totalMs: 42,
    totalEstimatedTokens: 1234,
    channelStats: [],
    injectedTokensByChannel: {},
    droppedCardIds: [],
    degradedCards: [],
    warnings: [],
    ...overrides,
  };
}

/** 完整（新版）日志：文风通道带 styleSamples + fixedCards + voices，另有 named-keep 保护与降档。 */
function fullDiagnostics(): NarrativeRetrievalDiagnostics {
  const column = (key: string, title: string) => ({ key, title, items: [], candidateCount: 0, trimmed: 0 });
  return diagnostics({
    injectedTokensByChannel: { hard: 380, style: 210, "recent-summary": 90 },
    droppedCardIds: ["style:sample:src/old", "facts:stale"],
    degradedCards: [{ id: "timeline:runtime", from: "full", to: "brief" }],
    trimReasons: [
      { id: "character:韩立", reason: "点名实体「韩立」超过核心角色上限，仍保留。", channel: "state", kind: "named-keep" },
      { id: "facts:stale", reason: "token 预算不足，卡片被丢弃。", channel: "facts", kind: "token-budget" },
    ],
    writeProfile: {
      locationAndTime: column("locationAndTime", "地点与时间"),
      hardConstraints: column("hardConstraints", "硬约束"),
      coreCharacters: column("coreCharacters", "核心角色"),
      activeHooks: column("activeHooks", "活跃伏笔"),
      recentSummaries: column("recentSummaries", "近章摘要"),
      nextCommitments: column("nextCommitments", "待兑现承诺"),
      continuityRisks: column("continuityRisks", "连续性风险"),
      caps: { coreCharacters: 6, activeHooks: 8, recentSummaries: 3 },
      namedEntities: ["韩立"],
      trimReasons: [],
    },
    channelStats: [
      { channel: "hard", status: "ok", latencyMs: 3, candidateCount: 4, returnedCount: 4, estimatedTokens: 380 },
      {
        channel: "style",
        status: "ok",
        latencyMs: 9,
        candidateCount: 6,
        returnedCount: 5,
        estimatedTokens: 240,
        metadata: {
          fixedCards: [
            { id: "style:style-guide", title: "文风指南", estimatedTokens: 120 },
            { id: "style:voice-constraints", title: "角色声线", estimatedTokens: 60 },
          ],
          voices: {
            provided: true,
            characters: [{ name: "韩立", confirmedFields: ["声音定位", "长短句倾向"] }],
          },
          styleSamples: {
            sceneTypes: {
              types: ["action"],
              labels: ["动作"],
              source: "narrative-scene",
              evidence: ["第12章第1场「突围」功能 climax → 动作"],
              attempts: [],
            },
            totalSamples: 3,
            confirmedSamples: 2,
            unconfirmedSamples: 1,
            selected: [
              {
                key: "src/fight", sourceTitle: "参考作品", sampleId: "fight", sceneType: "action", transfer: "source-only",
                rank: 1, match: "scene-type", title: "范文示例·动作", reason: "本章需要动作场景的写法示范；作者已确认。",
                estimatedTokens: 80,
              },
              {
                key: "src/old", sourceTitle: "参考作品", sampleId: "old", sceneType: "general", transfer: "transferable",
                rank: 2, match: "general", title: "范文示例·通用", reason: "补位。",
                estimatedTokens: 70,
              },
            ],
            trimmed: [
              {
                key: "src/draft", sourceTitle: "参考作品", sceneType: "dialogue", rank: 3, estimatedTokens: 66,
                kind: "token-budget", reason: "文风通道剩余预算 0 tokens，放不下这段约 66 tokens 的范文。",
              },
            ],
            budget: { availableTokens: 150, usedTokens: 150, channelBudgetTokens: 1000, reservedTokens: 180 },
            voiceConstraintsProvided: true,
            explanations: [],
            droppedAfterPacking: [{ cardId: "style:sample:src/old", reason: "全局上下文预算不足，打包时整段裁掉。" }],
          },
        },
      },
    ],
  });
}

describe("write-injection route（W6）", () => {
  it("章号非法 → 400；purpose 非法 → 400", async () => {
    const storage = await createStorage();
    try {
      const app = createNarrativeMemoryRouter({ storage });
      const bad = await app.request("http://localhost/api/books/book-1/narrative-memory/write-injection?chapter=0");
      expect(bad.status).toBe(400);
      const notInt = await app.request("http://localhost/api/books/book-1/narrative-memory/write-injection");
      expect(notInt.status).toBe(400);
      const badPurpose = await app.request("http://localhost/api/books/book-1/narrative-memory/write-injection?chapter=3&purpose=whatever");
      expect(badPurpose.status).toBe(400);
    } finally {
      storage.close();
    }
  });

  it("该章没有写作记录 → 200 exists:false，附三段式解释，不编造内容", async () => {
    const storage = await createStorage();
    try {
      const app = createNarrativeMemoryRouter({ storage });
      const response = await app.request("http://localhost/api/books/book-1/narrative-memory/write-injection?chapter=7");
      expect(response.status).toBe(200);
      const payload = await response.json() as any;
      expect(payload.ok).toBe(true);
      expect(payload.exists).toBe(false);
      expect(payload.chapterNumber).toBe(7);
      expect(payload.purpose).toBe("write_chapter");
      expect(payload.summary).toContain("第 7 章");
      expect(payload.explanation.whatHappened).toContain("第 7 章");
      expect(payload.explanation.whyItMatters).toBeTruthy();
      expect(payload.explanation.suggestedAction).toBeTruthy();
    } finally {
      storage.close();
    }
  });

  it("有写作记录 → exists:true，还原技能以外的完整注入清单", async () => {
    const storage = await createStorage();
    try {
      insertRetrievalLog(storage, {
        id: "log-1", bookId: "book-1", chapterNumber: 12, purpose: "write_chapter",
        totalTokens: 1234, diagnostics: fullDiagnostics(), createdAt: "2026-06-22T00:00:00.000Z",
      });
      // 更新的同章记录应当覆盖旧记录成为「最近一次」。
      insertRetrievalLog(storage, {
        id: "log-2", bookId: "book-1", chapterNumber: 12, purpose: "write_chapter",
        totalTokens: 1234, diagnostics: fullDiagnostics(), createdAt: "2026-06-22T01:00:00.000Z",
      });

      const app = createNarrativeMemoryRouter({ storage });
      const response = await app.request("http://localhost/api/books/book-1/narrative-memory/write-injection?chapter=12");
      expect(response.status).toBe(200);
      const payload = await response.json() as any;

      expect(payload.exists).toBe(true);
      expect(payload.logId).toBe("log-2");
      expect(payload.purposeLabel).toBe("写章");
      expect(payload.totalEstimatedTokens).toBe(1234);

      // 通道：状态 + 注入 tokens。
      const style = payload.channels.find((item: any) => item.channel === "style");
      expect(style.channelLabel).toBe("文风");
      expect(style.injectedTokens).toBe(210);

      // 文风指南等非范文卡片：id + tokens。
      expect(payload.style.fixedCardsRecorded).toBe(true);
      expect(payload.style.fixedCards.map((item: any) => item.id)).toEqual(["style:style-guide", "style:voice-constraints"]);
      expect(payload.style.fixedCards.every((item: any) => item.droppedInPacking === false)).toBe(true);

      // 角色声线：逐角色 + 已确认字段。
      expect(payload.style.voices).toEqual({
        provided: true,
        recorded: true,
        characters: [{ name: "韩立", confirmedFields: ["声音定位", "长短句倾向"] }],
      });

      // 范文：选中（含全局打包被裁标注）与裁剪（含原因与类型标签）。
      const samples = payload.style.samples;
      expect(samples.sceneTypes).toMatchObject({ labels: ["动作"], source: "narrative-scene", sourceLabel: "本章场景记录" });
      expect(samples.sceneTypes.evidence[0]).toContain("突围");
      expect(samples.selected).toHaveLength(2);
      const packed = samples.selected.find((item: any) => item.key === "src/old");
      expect(packed.droppedInPacking).toBe(true);
      const kept = samples.selected.find((item: any) => item.key === "src/fight");
      expect(kept.droppedInPacking).toBe(false);
      expect(kept.sceneTypeLabel).toBe("动作");
      expect(kept.transferLabel).toContain("作品专属");
      expect(kept.matchLabel).toBe("场景匹配");
      expect(samples.trimmed).toHaveLength(1);
      expect(samples.trimmed[0]).toMatchObject({ key: "src/draft", kindLabel: "预算不足", sceneTypeLabel: "对话" });
      expect(samples.budget).toMatchObject({ channelBudgetTokens: 1000, reservedTokens: 180, availableTokens: 150, usedTokens: 150 });

      // 受保护：named-keep 与点名实体。
      expect(payload.protection.namedKeeps).toHaveLength(1);
      expect(payload.protection.namedKeeps[0].kindLabel).toBe("点名保留");
      expect(payload.protection.namedEntities).toEqual(["韩立"]);

      // 裁剪：非 named-keep 的 trimReasons + dropped/degraded 全量。
      expect(payload.trimming.reasons).toHaveLength(2);
      expect(payload.trimming.droppedCardIds).toEqual(["style:sample:src/old", "facts:stale"]);
      expect(payload.trimming.degradedCards).toEqual([{ id: "timeline:runtime", from: "full", to: "brief" }]);

      // 明细齐全时不应有「旧日志缺字段」说明。
      expect(payload.notes).toEqual([]);

      // 未提供 resolveBookRoot：技能区块如实说明读不到，不编造启用清单。
      expect(payload.skills.source).toBe("unavailable");
      expect(payload.skills.items).toEqual([]);
    } finally {
      storage.close();
    }
  });

  it("旧版日志（无 fixedCards / voices 明细）→ 给出既有信息并附说明 notes", async () => {
    const storage = await createStorage();
    try {
      insertRetrievalLog(storage, {
        id: "log-old", bookId: "book-1", chapterNumber: 5, purpose: "write_chapter", totalTokens: 300,
        diagnostics: diagnostics({
          channelStats: [{
            channel: "style", status: "ok", latencyMs: 2, candidateCount: 3, returnedCount: 3, estimatedTokens: 200,
            metadata: {
              styleSamples: {
                sceneTypes: { types: [], labels: [], source: "none", evidence: [], attempts: ["第5章还没有场景记录。"] },
                totalSamples: 0, confirmedSamples: 0, unconfirmedSamples: 2,
                selected: [], trimmed: [],
                budget: { availableTokens: null, usedTokens: 0, channelBudgetTokens: 1000, reservedTokens: 100 },
                voiceConstraintsProvided: true,
                explanations: [],
              },
            },
          }],
        }),
        createdAt: "2026-06-20T00:00:00.000Z",
      });

      const app = createNarrativeMemoryRouter({ storage });
      const response = await app.request("http://localhost/api/books/book-1/narrative-memory/write-injection?chapter=5");
      expect(response.status).toBe(200);
      const payload = await response.json() as any;

      expect(payload.exists).toBe(true);
      expect(payload.style.fixedCardsRecorded).toBe(false);
      expect(payload.style.fixedCards).toEqual([]);
      // 旧日志的 voiceConstraintsProvided 布尔值仍然可用，但逐角色明细缺失要说明。
      expect(payload.style.voices.provided).toBe(true);
      expect(payload.style.voices.recorded).toBe(false);
      expect(payload.style.voices.characters).toEqual([]);
      expect(payload.notes.join("")).toContain("声线");
      expect(payload.notes.join("")).toContain("文风指南");
    } finally {
      storage.close();
    }
  });

  it("提供 resolveBookRoot 时列出当前启用技能（名称 + 估算 tokens），并说明它是当前状态", async () => {
    const storage = await createStorage();
    const bookRoot = await createBookRoot();
    await addProjectSkill(bookRoot, "chapter-hook", "强化章末钩子", "写下一章");
    await addProjectSkill(bookRoot, "plain-prose", "白描文风");
    try {
      insertRetrievalLog(storage, {
        id: "log-1", bookId: "book-1", chapterNumber: 3, purpose: "write_chapter",
        totalTokens: 10, diagnostics: diagnostics(), createdAt: "2026-06-22T00:00:00.000Z",
      });

      const app = createNarrativeMemoryRouter({ storage, resolveBookRoot: () => bookRoot });
      const response = await app.request("http://localhost/api/books/book-1/narrative-memory/write-injection?chapter=3");
      expect(response.status).toBe(200);
      const payload = await response.json() as any;

      expect(payload.skills.source).toBe("current-enabled");
      expect(payload.skills.note).toContain("当前启用");
      const names = payload.skills.items.map((item: any) => item.name);
      expect(names).toEqual(expect.arrayContaining(["强化章末钩子", "白描文风"]));
      const hook = payload.skills.items.find((item: any) => item.slug === "chapter-hook");
      expect(hook.entry).toBe("写下一章");
      expect(hook.estimatedTokens).toBeGreaterThan(0);
    } finally {
      storage.close();
    }
  });

  it("purpose 参数可查其他目的（如 audit）的最近注入记录", async () => {
    const storage = await createStorage();
    try {
      insertRetrievalLog(storage, {
        id: "log-audit", bookId: "book-1", chapterNumber: 4, purpose: "audit",
        totalTokens: 20, diagnostics: diagnostics(), createdAt: "2026-06-21T00:00:00.000Z",
      });
      const app = createNarrativeMemoryRouter({ storage });
      const miss = await app.request("http://localhost/api/books/book-1/narrative-memory/write-injection?chapter=4");
      expect((await miss.json() as any).exists).toBe(false);
      const hit = await app.request("http://localhost/api/books/book-1/narrative-memory/write-injection?chapter=4&purpose=audit");
      const payload = await hit.json() as any;
      expect(payload.exists).toBe(true);
      expect(payload.purposeLabel).toBe("审计");
    } finally {
      storage.close();
    }
  });
});
