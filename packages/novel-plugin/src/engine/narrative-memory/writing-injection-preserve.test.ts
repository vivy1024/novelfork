import { join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import {
  loadWritingInjectionPreserve,
  preserveLatestWritingInjection,
  renderWritingInjectionPreserve,
  WRITING_INJECTION_PRESERVE_FILE,
} from "./writing-injection-preserve.js";
import type { NarrativeContextPackage } from "./types.js";

const tempDirs: string[] = [];

function makeBookRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "writing-injection-preserve-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function makePack(overrides: Partial<NarrativeContextPackage> = {}): NarrativeContextPackage {
  return {
    bookId: "book-1",
    chapterNumber: 7,
    purpose: "write_chapter",
    cards: [],
    sections: {
      hard: "<hard_constraints>\n硬状态 A\n</hard_constraints>",
      state: "<narrative_state>\n状态 B\n</narrative_state>",
      timeline: "",
      hooks: "<active_hooks>\n伏笔 C\n</active_hooks>",
      facts: "",
      style: "",
      semantic: "",
      "character-kernel": "",
      "recent-summary": "",
      knowledge: "",
    },
    diagnostics: {
      totalMs: 3,
      totalEstimatedTokens: 1234,
      channelStats: [],
      injectedTokensByChannel: {},
      droppedCardIds: [],
      degradedCards: [],
      warnings: [],
      trimReasons: [],
    },
    ...overrides,
  };
}

describe("写作注入保留件（T4.7 尾巴）", () => {
  it("装配成功后原样落盘，读回逐字段一致", async () => {
    const bookRoot = makeBookRoot();
    const pack = makePack();
    await preserveLatestWritingInjection(bookRoot, pack);

    const snapshot = await loadWritingInjectionPreserve(bookRoot, "book-1");
    expect(snapshot).not.toBeNull();
    expect(snapshot!.bookId).toBe("book-1");
    expect(snapshot!.purpose).toBe("write_chapter");
    expect(snapshot!.chapterNumber).toBe(7);
    expect(snapshot!.totalEstimatedTokens).toBe(1234);
    // 原文原样保留：含空通道在内与注入 sections 逐字一致
    expect(snapshot!.sections).toEqual(pack.sections);
  });

  it("后一次写作注入覆盖前一份，每书只留一份", async () => {
    const bookRoot = makeBookRoot();
    await preserveLatestWritingInjection(bookRoot, makePack());
    await preserveLatestWritingInjection(bookRoot, makePack({ chapterNumber: 8, purpose: "revise" }));

    const snapshot = await loadWritingInjectionPreserve(bookRoot);
    expect(snapshot!.chapterNumber).toBe(8);
    expect(snapshot!.purpose).toBe("revise");
  });

  it("缺文件、损坏或书不匹配都返回 null（不注入保留件）", async () => {
    const bookRoot = makeBookRoot();
    expect(await loadWritingInjectionPreserve(bookRoot)).toBeNull();

    mkdirSync(join(bookRoot, "story"), { recursive: true });
    writeFileSync(join(bookRoot, "story", WRITING_INJECTION_PRESERVE_FILE), "{损坏", "utf8");
    expect(await loadWritingInjectionPreserve(bookRoot)).toBeNull();

    writeFileSync(join(bookRoot, "story", WRITING_INJECTION_PRESERVE_FILE), JSON.stringify({ hello: 1 }), "utf8");
    expect(await loadWritingInjectionPreserve(bookRoot)).toBeNull();

    await preserveLatestWritingInjection(bookRoot, makePack());
    expect(await loadWritingInjectionPreserve(bookRoot, "other-book")).toBeNull();
  });

  it("渲染：头部说明快照性质，空通道整栏略过且如实写明，正文原文原样拼接", async () => {
    const bookRoot = makeBookRoot();
    await preserveLatestWritingInjection(bookRoot, makePack());
    const snapshot = (await loadWritingInjectionPreserve(bookRoot, "book-1"))!;
    const text = renderWritingInjectionPreserve(snapshot);

    expect(text).toContain("写作注入保留件");
    expect(text).toContain("第 7 章");
    expect(text).toContain("约 1234 估算 token");
    expect(text).toContain("不被摘要掉");
    // 空通道略过并明说，不是静默裁剪
    expect(text).toContain("个通道当时无注入内容，已整栏略过");
    // 有内容的通道原文原样出现在文本里
    expect(text).toContain("硬状态 A");
    expect(text).toContain("伏笔 C");
    expect(text).toContain("<hard_constraints>");
    // 空通道的 tag 不渲染
    expect(text).not.toContain("<timeline_context>");
    expect(text).not.toContain("<style_rules>");
  });
});
