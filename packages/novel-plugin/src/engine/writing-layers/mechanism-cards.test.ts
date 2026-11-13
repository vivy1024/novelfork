import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { createStorageDatabase, type StorageDatabase } from "@vivy1024/novelfork-core/storage";
import type { RuntimeTextGenerator } from "@vivy1024/novelfork-core/plugins";
import { afterEach, describe, expect, it } from "vitest";

import { executeMechanismDistillTool, executeStyleConsolidateTool } from "../../handlers/mechanism-distill-tools.js";
import { handleOutlineVolume } from "../../handlers/outline-volume.js";
import { handleSceneSpec } from "../../handlers/scene-spec-handler.js";
import { buildWriteChapterRecall } from "../../handlers/write-recall.js";
import { createMechanismCardsRouter } from "../../routes/mechanism-cards.js";
import type { RouterContext } from "../../routes/context.js";
import {
  auditMechanismCardResiduals,
  extractAndSaveMechanismCards,
  loadMechanismCards,
  recallMechanismCardsForPlanning,
  updateMechanismCard,
} from "./mechanism-cards.js";
import { createStylePreset } from "./style-preset.js";
import { saveStylePreset } from "./style-preset-store.js";

const tempDirs: string[] = [];
const openDatabases: StorageDatabase[] = [];

afterEach(async () => {
  for (const db of openDatabases.splice(0)) {
    try { db.close(); } catch { /* ignore */ }
  }
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeBookEnv(): Promise<{ bookRoot: string; storage: StorageDatabase }> {
  const dir = await mkdtemp(join(tmpdir(), "nf-mechanism-v2-"));
  tempDirs.push(dir);
  const bookRoot = join(dir, "book-1");
  await mkdir(join(bookRoot, "story"), { recursive: true });
  await mkdir(join(bookRoot, "chapters", "卷01"), { recursive: true });
  await writeFile(join(bookRoot, "book.json"), JSON.stringify({
    id: "book-1",
    title: "测试小说",
    chapterWordCount: 3000,
  }), "utf8");
  const storage = createStorageDatabase({ databasePath: join(dir, "test.db") });
  openDatabases.push(storage);
  return { bookRoot, storage };
}

describe("改造目标 3：中观可迁移机制卡（抽取、专名残留守卫、跨书归并与规划/正文物理隔离墙）", () => {
  it("支持从本地文件抽取机制卡，自动识别原著专名残留并阻断带病确认，清洗后才可进入规划召回", async () => {
    const { bookRoot } = await makeBookEnv();
    const refFile = join(bookRoot, "ref-sample.txt");
    await writeFile(refFile, [
      "第1章 催债账单",
      "张羽看着眼骸里弹出的昆墟助学贷款账单，本月还要还三千块工钱。".repeat(8),
      "",
      "第2章 功法降维打工",
      "张羽把昆墟基础吐纳法拆成搬砖省力呼吸节拍，在工地一晚上多赚了两百块收益。".repeat(8),
    ].join("\n"), "utf8");

    // 模型故意在 triggerAndPayoff 里残留原著专名「昆墟」-> 机械校验必须自动抓出并标 needsTermSanitization: true！
    const leakyModel: RuntimeTextGenerator = async () => ({
      text: JSON.stringify({
        cards: [{
          name: "底层打工功法降维实用化",
          readerDesire: "看主角在债务高压下把高冷体系技能拆成赚钱手艺",
          emotionChain: "账单紧逼 -> 常规苦修亏钱 -> 降维改造成打工神技 -> 账面进账反超",
          triggerAndPayoff: "助学债务触发危机 -> 拆解昆墟基础功法用于民用打工套利 -> 结清欠款",
          abstractSlots: [
            { slot: "硬性定期债务", roleDescription: "按月催缴的刚性生存成本" },
            { slot: "基础功法民用化", roleDescription: "将战斗或修行底子转化为高薪劳务效率" },
          ],
          forbiddenSourceTerms: ["张羽", "眼骸", "法骸", "福姬", "昆墟"],
          tags: ["校园搞钱", "制度套利", "开局破局"],
        }],
      }),
    });

    const extracted = await extractAndSaveMechanismCards({
      bookRoot,
      sourceTitle: "没钱修什么仙",
      filePath: refFile,
      chapterRange: { from: 1, to: 2 },
      generateText: leakyModel,
    });
    expect(extracted.usedModel).toBe(true);
    expect(extracted.extracted[0]!.needsTermSanitization).toBe(true);
    expect(extracted.extracted[0]!.residualTerms).toContain("昆墟");
    expect(extracted.warnings.join(" ")).toContain("昆墟");

    const cardId = extracted.allCards[0]!.id;
    // 未清洗前即使尝试设 status=confirmed，auditMechanismCardResiduals 也会强制打回 needs-review！
    const blockedConfirm = await updateMechanismCard(bookRoot, cardId, { status: "confirmed" });
    expect(blockedConfirm.card.status).toBe("needs-review");
    expect(await recallMechanismCardsForPlanning(bookRoot, "校园搞钱 制度套利")).toEqual([]);

    // 清洗掉「昆墟」后再确认 -> 顺利通过！
    const cleaned = await updateMechanismCard(bookRoot, cardId, {
      triggerAndPayoff: "硬性债务触发危机 -> 拆解高门派基础功法用于民用打工套利 -> 账单与实力双兑现",
      status: "confirmed",
    });
    expect(cleaned.card.status).toBe("confirmed");
    expect(cleaned.card.needsTermSanitization).toBeUndefined();

    // 第二本参考书出现同构机制 -> 自动跨书聚合升级 validationStatus = "cross_book"
    const secondBookModel: RuntimeTextGenerator = async () => ({
      text: JSON.stringify({
        cards: [{
          name: "底层打工功法降维实用化",
          readerDesire: "看寒门弟子把基础法术改造成流水线手艺攒第一桶金",
          emotionChain: "欠债压顶 -> 拆解基础法术套利 -> 攒够资粮破局",
          triggerAndPayoff: "硬性债务触发危机 -> 拆解高门派基础功法用于民用打工套利 -> 账单与实力双兑现",
          abstractSlots: [{ slot: "刚性欠款", roleDescription: "定期催收的资源压力" }],
          forbiddenSourceTerms: ["韩某", "七玄门"],
          tags: ["制度套利", "开局破局"],
        }],
      }),
    });
    const merged = await extractAndSaveMechanismCards({
      bookRoot,
      sourceTitle: "另一本种田仙侠",
      text: "第1章 灵田算账\n外门弟子按月核算灵砂收支与符箓工钱。".repeat(10),
      generateText: secondBookModel,
    });
    expect(merged.allCards).toHaveLength(1);
    expect(merged.allCards[0]!.validationStatus).toBe("cross_book");
    expect(merged.allCards[0]!.forbiddenSourceTerms).toEqual(expect.arrayContaining(["眼骸", "昆墟", "七玄门"]));
  });

  it("严格物理隔离消费墙：机制卡只进入 scene.spec 与 outline.volume 规划参考，绝不进入 write.preflight / buildWriteChapterRecall 的正文上下文", async () => {
    const { bookRoot, storage } = await makeBookEnv();

    // 写入并确认一张特征鲜明的机制卡
    const extracted = await extractAndSaveMechanismCards({
      bookRoot,
      sourceTitle: "玄鉴仙族",
      text: "第1章 仙基推演\n道基配伍讲究君臣佐使，古籍残卷里暗藏相克死局。".repeat(12),
      extraForbiddenTerms: ["陆江仙", "青池宗"],
    });
    const cardId = extracted.allCards[0]!.id;
    await updateMechanismCard(bookRoot, cardId, {
      name: "【独有机制标记】同参道基君臣配伍死局",
      triggerAndPayoff: "【独有闭环标记】主流进阶暗藏反噬 -> 逆推冷门古法重排配伍 -> 险中破局晋升",
      tags: ["功法推演", "破局设计"],
      status: "confirmed",
    });

    // 同时配置本书文风预设
    const preset = createStylePreset();
    preset.generalRules = ["叙述干净克制"];
    await saveStylePreset(bookRoot, preset, null);

    // 1. 规划侧（scene.spec）：应召回该机制卡作为蓝图辅助参考
    const specRes = await handleSceneSpec({
      bookId: "book-1",
      bookRoot,
      chapterNumber: 1,
      userDirectives: "主角夜探藏书阁，进行功法推演与破局设计",
      skipContextGate: true,
      sceneSpec: {
        chapter: 1,
        title: "功法推演",
        wordTarget: 3000,
        scenes: [{
          characters: ["林渊"],
          location: "藏书阁",
          conflict: "功法推演陷入死局，需要破局设计",
          mood: "凝重",
          outcome: "找出新配伍思路",
          hooks_used: [],
          hooks_planted: [],
        }],
        constraints: [],
      },
    });
    expect(specRes.ok).toBe(true);
    if (specRes.ok) {
      expect(specRes.data.planningMechanisms).toHaveLength(1);
      expect(specRes.data.planningMechanisms?.[0]?.name).toContain("同参道基君臣配伍死局");
    }

    // 2. 卷纲规划侧（outline.volume action=suggest）：也应附上规划期机制参考
    const volRes = await handleOutlineVolume({
      bookId: "book-1",
      bookRoot,
      action: "suggest",
      volumeCount: 2,
      targetChapters: 60,
      storage,
    });
    expect(volRes.ok).toBe(true);
    expect(volRes.planningMechanisms?.[0]?.name).toContain("同参道基君臣配伍死局");

    // 3. 正文写前召回侧（buildWriteChapterRecall，即 write.preflight 与 pipeline.write 共用入口）：
    //    绝不包含机制卡名称或机制卡全文！
    const recallPkg = await buildWriteChapterRecall({
      storage,
      bookId: "book-1",
      bookRoot,
      chapterNumber: 1,
      sceneSpec: specRes.ok ? specRes.data.sceneSpec : undefined,
      sceneText: "功法推演 破局设计",
    });
    const allSectionTexts = Object.values(recallPkg.sections).join("\n");
    const allCardTexts = recallPkg.cards.map((c) => `${c.title}\n${c.content}`).join("\n");
    expect(allSectionTexts).not.toContain("【独有机制标记】");
    expect(allSectionTexts).not.toContain("【独有闭环标记】");
    expect(allCardTexts).not.toContain("【独有机制标记】");
    expect(allCardTexts).not.toContain("【独有闭环标记】");
  });

  it("mechanism.distill、style.consolidate 工具与 HTTP 路由增删改查完整闭环", async () => {
    const { bookRoot } = await makeBookEnv();
    const binding = { bookId: "book-1", root: bookRoot };
    const toolCtx = { projectRoot: bookRoot } as never;

    const ext = await executeMechanismDistillTool({
      action: "extract",
      sourceTitle: "没钱修什么仙",
      text: "第1章 账单\n灵石贷款与打工工钱精算，套利破局。".repeat(10),
      extraForbiddenTerms: ["眼骸"],
    }, binding, toolCtx);
    expect(ext.ok).toBe(true);

    const listed = await executeMechanismDistillTool({ action: "list" }, binding, toolCtx);
    expect(listed.ok).toBe(true);
    const cards = (listed.data as { cards: Array<{ id: string }> }).cards;
    expect(cards.length).toBeGreaterThan(0);

    const neg = await executeStyleConsolidateTool({
      action: "negative_override",
      feedbackText: "不要半文言古文腔",
    }, binding, toolCtx);
    expect(neg.ok).toBe(true);

    // HTTP 路由验证
    const routerCtx = { state: { bookDir: () => bookRoot } } as unknown as RouterContext;
    const app = new Hono().route("/", createMechanismCardsRouter(routerCtx));
    const getRes = await app.request("/api/books/book-1/mechanism-cards");
    expect(getRes.status).toBe(200);
    expect((await getRes.json()).cards).toHaveLength(cards.length);

    const patchRes = await app.request(`/api/books/book-1/mechanism-cards/${cards[0]!.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "confirmed" }),
    });
    expect(patchRes.status).toBe(200);

    const delRes = await app.request(`/api/books/book-1/mechanism-cards/${cards[0]!.id}`, { method: "DELETE" });
    expect(delRes.status).toBe(200);
    expect((await loadMechanismCards(bookRoot)).cards).toHaveLength(cards.length - 1);
  });

  it("auditMechanismCardResiduals 纯函数精确检验原著专名残留", () => {
    const clean = auditMechanismCardResiduals({
      id: "m-1",
      name: "跨阶代价守恒机制",
      sourceTitle: "玄鉴仙族",
      sourceChapterRange: "第1-5章",
      readerDesire: "看严谨体系下的取舍博弈",
      emotionChain: "危机 -> 权衡 -> 破局",
      triggerAndPayoff: "受阻 -> 借规则反制 -> 晋升",
      abstractSlots: [{ slot: "核心器物", roleDescription: "承载传承的信物" }],
      forbiddenSourceTerms: ["陆江仙", "鉴子"],
      tags: ["体系博弈"],
      status: "confirmed",
      validationStatus: "single_book",
    });
    expect(clean.card.status).toBe("confirmed");
    expect(clean.warnings).toEqual([]);
  });
});
