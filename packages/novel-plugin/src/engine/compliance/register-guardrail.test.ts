import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { closeStorageDatabase, initializeStorageDatabase, runStorageMigrations } from "@vivy1024/novelfork-core";
import { afterEach, describe, expect, it } from "vitest";

import { handleChapterAuditV2 } from "../../handlers/chapter-audit-v2.js";
import { executePipelineWrite } from "../../handlers/pipeline-write-service.js";
import { createComplianceRouter } from "../../routes/compliance.js";
import type { RouterContext } from "../../routes/context.js";
import { createStylePreset } from "../writing-layers/style-preset.js";
import { saveStylePreset } from "../writing-layers/style-preset-store.js";
import {
  checkRegisterGuardrail,
  extractConfirmedLoreExemptions,
  runBookRegisterGuardrail,
} from "./register-guardrail.js";

const roots: string[] = [];
afterEach(async () => {
  closeStorageDatabase();
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeWorkspace(): Promise<{ root: string; bookRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), "nf-register-guard-"));
  roots.push(root);
  const bookRoot = join(root, "books", "book-guard");
  await mkdir(join(bookRoot, "story"), { recursive: true });
  await mkdir(join(bookRoot, "chapters", "卷01"), { recursive: true });
  await writeFile(join(bookRoot, "book.json"), JSON.stringify({
    id: "book-guard",
    title: "试炼之书",
    platform: "qidian",
    genre: "xianxia",
    status: "active",
    targetChapters: 100,
    chapterWordCount: 500,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }), "utf8");
  return { root, bookRoot };
}

describe("改造目标 5：语域纯洁度与原著专名防泄漏门禁（Register & Source-Term Linter）", () => {
  it("精准拦截 SQUID / PLL / LEVSS / GMP / HPLC / 西式驼峰与 LaTeX 公式，同时放行日常词与经纬已确认自有代号 B-17", () => {
    const confirmedEntries = [
      {
        title: "B-17号矿坑",
        aliases: ["青池镇"], // 作者经纬自己确立的同名地点，不应被参考书误杀
        contentMd: "矿工佩戴代号 NSL-9 的铜牌下井作业。",
        status: "confirmed",
      },
      {
        title: "草稿条目",
        contentMd: "未确认条目里的 SQUID 不得自动豁免。",
        status: "needs-review",
      },
    ];
    const exemptions = extractConfirmedLoreExemptions(confirmedEntries);
    expect(exemptions.asciiTokens.has("B-17")).toBe(true);
    expect(exemptions.asciiTokens.has("NSL-9")).toBe(true);
    expect(exemptions.asciiTokens.has("SQUID")).toBe(false);
    expect(exemptions.ownEntityNames.has("青池镇")).toBe(true);

    const preset = createStylePreset();
    preset.registerGuardrail = { allowedAsciiAcronyms: ["DAO"] };
    preset.sources = [
      {
        id: "mq",
        title: "没钱修什么仙",
        forbiddenSourceTerms: ["眼骸", "法骸", "福姬", "昆墟"],
        rules: [],
        samples: [],
      },
      {
        id: "xj",
        title: "玄鉴仙族",
        forbiddenSourceTerms: ["陆江仙", "青池宗", "青池镇"],
        rules: [],
        samples: [],
      },
    ];

    const content = [
      "林渊打开手机 APP 充了个 VIP，去医院拍完 CT 和 B超 后回到 B-17号矿坑，亮出 NSL-9 铜牌与 DAO 徽记，途经青池镇。",
      "长老突然掏出一台 SQUID 探头与 PLL 锁相环，配合 LEVSS 协议、GMP 标准车间和 HPLC 色谱仪，启动 Bio-Core 与 OpenQi 灵根。",
      "石碑上竟刻着 $\\frac{\\alpha}{2} + x_1$ 的算式。",
      "半空中浮现出福姬的虚影，张口便提眼骸与昆墟的旧事，远处陆江仙正望向青池宗山门。",
    ].join("\n");

    const report = checkRegisterGuardrail({
      content,
      stylePreset: preset,
      confirmedEntries,
    });

    expect(report.passed).toBe(false);

    // 第 1 段的 APP / VIP / CT / B超 / B-17 / NSL-9 / DAO / 青池镇 全部合法豁免，0 误杀！
    const matchedTokens = report.violations.map((v) => v.matched);
    for (const safeWord of ["APP", "VIP", "CT", "B", "B-17", "NSL-9", "DAO", "青池镇"]) {
      expect(matchedTokens).not.toContain(safeWord);
    }

    // 第 2 段的未授权缩写与西式科技术语全部被抓出
    expect(matchedTokens).toEqual(expect.arrayContaining([
      "SQUID", "PLL", "LEVSS", "GMP", "HPLC", "Bio-Core", "OpenQi",
    ]));

    // 第 3 段的 LaTeX 公式被硬门抓出
    expect(report.asciiAndFormulaHits.some((v) => v.kind === "latex_formula" && v.paragraphIndex === 3)).toBe(true);

    // 第 4 段的原著专名全部精准报出段落号与参考书名
    const sourceHits = Object.fromEntries(report.sourceTermHits.map((h) => [h.matched, h]));
    expect(sourceHits["福姬"]?.sourceTitle).toContain("没钱修什么仙");
    expect(sourceHits["福姬"]?.paragraphIndex).toBe(4);
    expect(sourceHits["眼骸"]?.sourceTitle).toContain("没钱修什么仙");
    expect(sourceHits["昆墟"]?.sourceTitle).toContain("没钱修什么仙");
    expect(sourceHits["陆江仙"]?.sourceTitle).toContain("玄鉴仙族");
    expect(sourceHits["青池宗"]?.sourceTitle).toContain("玄鉴仙族");
  });

  it("接入 handleChapterAuditV2、compliance 路由与 pipeline.write：命中原著专名泄漏直接硬门打回", async () => {
    const { root, bookRoot } = await makeWorkspace();
    const storage = initializeStorageDatabase({ databasePath: join(root, "isolated.db") });
    runStorageMigrations(storage);
    const preset = createStylePreset();
    preset.sources = [{
      id: "mq",
      title: "没钱修什么仙",
      forbiddenSourceTerms: ["眼骸", "法骸", "福姬", "昆墟"],
      rules: [],
      samples: [],
    }];
    await saveStylePreset(bookRoot, preset, null);

    await writeFile(join(bookRoot, "story", "mechanism_cards.json"), JSON.stringify({
      schemaVersion: 1,
      cards: [{
        id: "mc-1",
        name: "配伍死局",
        sourceTitle: "玄鉴仙族",
        sourceChapterRange: "第1-3章",
        readerDesire: "逻辑推演",
        emotionChain: "危机 -> 破局",
        triggerAndPayoff: "死局 -> 逆推",
        abstractSlots: [{ slot: "古镜", roleDescription: "传承器物" }],
        forbiddenSourceTerms: ["陆江仙", "青池宗"],
        tags: [],
        status: "confirmed",
        validationStatus: "single_book",
      }],
    }), "utf8");

    // 1. chapter-audit-v2 审计拦截
    const audit = handleChapterAuditV2({
      bookId: "book-guard",
      chapterNumber: 1,
      content: "林渊催动体内灵力，却听见陆江仙在SQUID阵列旁低语。".padEnd(500, "风吹过山岗。"),
      wordTarget: 500,
      registerGuardrail: {
        stylePreset: preset,
        extraForbiddenTerms: ["陆江仙"],
      },
    });
    expect(audit.passed).toBe(false);
    expect(audit.hardViolations.some((v) => v.ruleId === "H8" && v.description.includes("陆江仙"))).toBe(true);
    expect(audit.softViolations.some((v) => v.ruleId === "S9" && v.description.includes("SQUID"))).toBe(true);

    // 2. compliance 路由 register-check 验证
    const routerCtx = {
      state: {
        bookDir: () => bookRoot,
        loadBookConfig: async () => ({ title: "试炼之书" }),
        loadChapterIndex: async () => [],
      },
    } as unknown as RouterContext;
    const app = new Hono().route("/", createComplianceRouter(routerCtx));
    const checkRes = await app.request("/api/books/book-guard/compliance/register-check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "他摸了摸眼骸，望向青池宗方向。" }),
    });
    expect(checkRes.status).toBe(200);
    const checkJson = await checkRes.json();
    expect(checkJson.report.passed).toBe(false);
    expect(checkJson.report.sourceTermHits.map((h: { matched: string }) => h.matched)).toEqual(
      expect.arrayContaining(["眼骸", "青池宗"]),
    );

    // 3. pipeline.write 硬门拦截：出现原著专名「眼骸 / 陆江仙」时以 source-term-leak 打回，不保存污染章节
    const leakyProse = `林渊盘膝坐在石室中，眼骸忽然闪过一道红光，耳畔仿佛响起陆江仙的叹息。${"夜色渐深，山风呼啸着掠过松林，吹动檐角铜铃。".repeat(20)}`;
    const writeRes = await executePipelineWrite({
      bookId: "book-guard",
      content: leakyProse,
      skipContextGate: true,
      sceneSpec: {
        chapter: 1,
        title: "石室异变",
        wordTarget: 500,
        beatBudget: [{ summary: "石室调息察觉异样", density: "dense", words: 500 }],
        scenes: [{
          characters: ["林渊"],
          location: "石室",
          conflict: "调息遇阻",
          mood: "凝重",
          outcome: "稳住气血",
          hooks_used: [],
          hooks_planted: [],
        }],
        constraints: [],
      },
    }, {
      root,
      bookRoot,
    });
    expect(writeRes.ok).toBe(false);
    if (!writeRes.ok) {
      expect(writeRes.code).toBe("source-term-leak");
      expect(writeRes.error).toContain("眼骸");
      expect(writeRes.error).toContain("没钱修什么仙");
      expect(writeRes.error).toContain("陆江仙");
      expect(writeRes.error).toContain("玄鉴仙族");
    }

    // 4. runBookRegisterGuardrail 干净文本通过
    const cleanReport = await runBookRegisterGuardrail({
      bookRoot,
      bookId: "book-guard",
      content: "林渊盘膝坐在石室中，掌心铜镜微热，气血沿着周天缓缓归拢。",
    });
    expect(cleanReport.passed).toBe(true);
    expect(cleanReport.violations).toEqual([]);
  });
});
