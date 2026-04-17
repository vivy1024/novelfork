/**
 * Lorebook RAG 单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryDB } from "../state/memory-db.js";
import { retrieveLorebookEntries, formatLorebookContext } from "../utils/lorebook-rag.js";
import type { Entity } from "../utils/ner-extractor.js";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("lorebook-rag", () => {
  let testDir: string;
  let memoryDb: MemoryDB;

  beforeEach(() => {
    // 创建临时测试目录
    testDir = mkdtempSync(join(tmpdir(), "inkos-test-"));
    // 创建 story 子目录（MemoryDB 需要）
    mkdirSync(join(testDir, "story"), { recursive: true });
    memoryDb = new MemoryDB(testDir);

    // 插入测试数据
    memoryDb.addWorldEntry({
      dimension: "characters",
      name: "林动",
      keywords: "林动,主角",
      content: "青阳镇林家少年，修炼《祖符》，性格坚韧不拔。",
      priority: 100,
      enabled: true,
      sourceChapter: 1,
    });

    memoryDb.addWorldEntry({
      dimension: "items",
      name: "祖符",
      keywords: "祖符,符文",
      content: "远古时代八大祖符之一，蕴含无上力量。",
      priority: 90,
      enabled: true,
      sourceChapter: 1,
    });

    memoryDb.addWorldEntry({
      dimension: "geography",
      name: "青阳镇",
      keywords: "青阳镇,林家",
      content: "大炎王朝边陲小镇，林家所在地。",
      priority: 80,
      enabled: true,
      sourceChapter: 1,
    });

    memoryDb.addWorldEntry({
      dimension: "factions",
      name: "道宗",
      keywords: "道宗,宗门",
      content: "东玄域顶级宗门，掌控符师传承。",
      priority: 70,
      enabled: true,
      sourceChapter: 10,
    });

    memoryDb.addWorldEntry({
      dimension: "characters",
      name: "林琅天",
      keywords: "林琅天,林家",
      content: "林家天才，林动的堂兄，后成为反派。",
      priority: 85,
      enabled: false, // 禁用
      sourceChapter: 2,
    });
  });

  afterEach(() => {
    memoryDb.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("retrieveLorebookEntries", () => {
    it("应该根据关键词匹配词条", async () => {
      const entities: Entity[] = [
        { text: "林动", type: "person", confidence: 0.9 },
        { text: "祖符", type: "item", confidence: 0.85 },
      ];

      const result = await retrieveLorebookEntries(entities, memoryDb, {
        tokenBudget: 2000,
      });

      expect(result.length).toBe(2);
      expect(result[0].name).toBe("林动"); // priority 100
      expect(result[1].name).toBe("祖符"); // priority 90
    });

    it("应该按优先级降序排序", async () => {
      const entities: Entity[] = [
        { text: "青阳镇", type: "location", confidence: 0.8 },
        { text: "林动", type: "person", confidence: 0.9 },
        { text: "道宗", type: "term", confidence: 0.85 },
      ];

      const result = await retrieveLorebookEntries(entities, memoryDb, {
        tokenBudget: 2000,
      });

      expect(result.length).toBe(3);
      expect(result[0].priority).toBe(100); // 林动
      expect(result[1].priority).toBe(80);  // 青阳镇
      expect(result[2].priority).toBe(70);  // 道宗
    });

    it("应该过滤禁用的词条", async () => {
      const entities: Entity[] = [
        { text: "林琅天", type: "person", confidence: 0.9 },
      ];

      const result = await retrieveLorebookEntries(entities, memoryDb, {
        tokenBudget: 2000,
      });

      expect(result.length).toBe(0); // 林琅天被禁用
    });

    it("应该根据 token 预算裁剪", async () => {
      const entities: Entity[] = [
        { text: "林动", type: "person", confidence: 0.9 },
        { text: "祖符", type: "item", confidence: 0.85 },
        { text: "青阳镇", type: "location", confidence: 0.8 },
      ];

      // 设置很小的 token 预算，只能容纳第一个词条
      const result = await retrieveLorebookEntries(entities, memoryDb, {
        tokenBudget: 50, // 只够容纳"林动"词条（约 40 tokens）
      });

      expect(result.length).toBe(1);
      expect(result[0].name).toBe("林动");
    });

    it("应该过滤低于最低优先级的词条", async () => {
      const entities: Entity[] = [
        { text: "林动", type: "person", confidence: 0.9 },
        { text: "祖符", type: "item", confidence: 0.85 },
        { text: "青阳镇", type: "location", confidence: 0.8 },
        { text: "道宗", type: "term", confidence: 0.85 },
      ];

      const result = await retrieveLorebookEntries(entities, memoryDb, {
        tokenBudget: 2000,
        minPriority: 85, // 只保留优先级 >= 85 的
      });

      expect(result.length).toBe(2);
      expect(result[0].name).toBe("林动"); // priority 100
      expect(result[1].name).toBe("祖符"); // priority 90
    });

    it("空实体列表应返回空数组", async () => {
      const result = await retrieveLorebookEntries([], memoryDb, {
        tokenBudget: 2000,
      });

      expect(result.length).toBe(0);
    });

    it("没有匹配的关键词应返回空数组", async () => {
      const entities: Entity[] = [
        { text: "不存在的角色", type: "person", confidence: 0.9 },
      ];

      const result = await retrieveLorebookEntries(entities, memoryDb, {
        tokenBudget: 2000,
      });

      expect(result.length).toBe(0);
    });

    it("应该支持部分关键词匹配", async () => {
      const entities: Entity[] = [
        { text: "林家", type: "location", confidence: 0.8 }, // 匹配"青阳镇"的关键词
      ];

      const result = await retrieveLorebookEntries(entities, memoryDb, {
        tokenBudget: 2000,
      });

      expect(result.length).toBeGreaterThan(0);
      expect(result.some((e) => e.name === "青阳镇")).toBe(true);
    });
  });

  describe("formatLorebookContext", () => {
    it("应该格式化词条为 Markdown 上下文", async () => {
      const entities: Entity[] = [
        { text: "林动", type: "person", confidence: 0.9 },
        { text: "祖符", type: "item", confidence: 0.85 },
      ];

      const entries = await retrieveLorebookEntries(entities, memoryDb, {
        tokenBudget: 2000,
      });

      const context = formatLorebookContext(entries);

      expect(context).toContain("# 世界设定");
      expect(context).toContain("## 林动 (characters)");
      expect(context).toContain("青阳镇林家少年");
      expect(context).toContain("## 祖符 (items)");
      expect(context).toContain("远古时代八大祖符");
    });

    it("空词条列表应返回空字符串", () => {
      const context = formatLorebookContext([]);
      expect(context).toBe("");
    });
  });
});
