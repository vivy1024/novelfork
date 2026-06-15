/**
 * createJingweiEntriesFromGuide — 建书时按题材模板直接生成 SQLite 经纬条目
 *
 * 设计文档: .kiro/specs/jingwei-data-layer-unify/design.md 单元 3
 *
 * 替代旧流程"写 md → 导入 SQLite"的倒置数据流。
 * 根据 GenreTemplate.complexity 决定创建哪些条目（轻量少建、重度全建）。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { createStoryJingweiEntryRepository } from "./repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "./repositories/section-repo.js";
import type { GenreTemplate } from "./genre-templates.js";
import { randomUUID } from "node:crypto";

export interface GuidedSetupAnswers {
  readonly genre?: { mode: string; value: string };
  readonly premise?: { mode: string; value: string };
  readonly protagonist?: { mode: string; value: string };
  readonly goldenFinger?: { mode: string; value: string };
  readonly worldModel?: { mode: string; value: string };
  readonly powerSystem?: { mode: string; value: string };
  readonly tone?: { mode: string; value: string };
  readonly platform?: { mode: string; value: string };
  readonly [key: string]: { mode: string; value: string } | undefined;
}

function answerValue(answer: { mode: string; value: string } | undefined): string | null {
  if (!answer || answer.mode === "random" || !answer.value.trim()) return null;
  return answer.value.trim();
}

function makeId(): string {
  return randomUUID().slice(0, 12);
}

function now(): Date {
  return new Date();
}

/**
 * 确保指定 category 的 section 存在，返回 sectionId。
 * sections 按 category 名作为 key（简化版，每个 category 一个 section）。
 */
async function ensureSection(
  sectionRepo: ReturnType<typeof createStoryJingweiSectionRepository>,
  bookId: string,
  category: string,
  categoryName: string,
): Promise<string> {
  const existing = await sectionRepo.listByBook(bookId);
  const found = existing.find((s) => s.key === category || s.builtinKind === category);
  if (found) return found.id;

  const id = `section-${category}-${makeId()}`;
  await sectionRepo.create({
    id,
    bookId,
    key: category,
    name: categoryName,
    builtinKind: category,
    order: existing.length,
    enabledForAi: true,
    createdAt: now(),
    updatedAt: now(),
  });
  return id;
}

export async function createJingweiEntriesFromGuide(
  bookId: string,
  answers: GuidedSetupAnswers,
  template: GenreTemplate,
  storage: StorageDatabase,
): Promise<{ created: number }> {
  const entryRepo = createStoryJingweiEntryRepository(storage);
  const sectionRepo = createStoryJingweiSectionRepository(storage);
  let created = 0;

  const createEntry = async (category: string, categoryName: string, title: string, contentMd: string, customFields: Record<string, unknown> = {}) => {
    const sectionId = await ensureSection(sectionRepo, bookId, category, categoryName);
    const ts = now();
    await entryRepo.create({
      id: `entry-${category}-${makeId()}`,
      bookId,
      sectionId,
      title,
      contentMd,
      tags: [],
      aliases: [],
      customFields: { ...customFields, subcategory: customFields.subcategory },
      relatedChapterNumbers: [],
      relatedEntryIds: [],
      visibilityRule: { type: "global" },
      participatesInAi: true,
      tokenBudget: null,
      priorityTier: "core",
      importance: 80,
      summaryL0: contentMd.slice(0, 60),
      createdAt: ts,
      updatedAt: ts,
    } as any);
    created++;
  };

  // === 总是创建（所有档位） ===

  // 故事前提（premise）
  const premise = answerValue(answers.premise);
  if (premise) {
    await createEntry("premise", "故事基线", "核心前提", premise);
  }

  // 主角（characters）
  const protagonist = answerValue(answers.protagonist);
  const goldenFinger = answerValue(answers.goldenFinger);
  if (protagonist) {
    await createEntry("characters", "角色", "主角", protagonist, {
      roleType: "主角",
      goldenFinger: goldenFinger ?? "",
    });
  }

  // 基调/文风（rules）
  const tone = answerValue(answers.tone);
  if (tone) {
    await createEntry("rules", "写作规则", "文风基调", `基调：${tone}`);
  }

  // === medium + heavy 才创建 ===

  if (template.complexity !== "light") {
    // 世界模型
    const world = answerValue(answers.worldModel);
    if (world) {
      await createEntry("world-model", "世界模型", "世界观", world);
    }

    // 金手指/系统规则（props）
    if (goldenFinger && !protagonist) {
      // 如果主角没填但金手指填了，单独建 props 条目
      await createEntry("props", "道具资源", "金手指/系统", goldenFinger);
    }
  }

  // === heavy 才创建 ===

  if (template.complexity === "heavy") {
    // 力量体系
    const powerSystem = answerValue(answers.powerSystem);
    if (powerSystem) {
      await createEntry("power-system", "能力体系", "力量体系", powerSystem);
    }

    // 第一卷大纲骨架（outline）
    const premiseText = premise ?? "待规划";
    await createEntry("outline", "卷纲/大纲", "第一卷", [
      `## 核心冲突\n${premiseText}`,
      `## 章节规划\n- 第1章：开篇\n- 第2章：日常\n- 第3章：变故\n- 第4-5章：应对\n- 第6-8章：发展\n- 第9-10章：第一卷高潮`,
      protagonist ? `## 主角弧线\n起点：${protagonist}\n终点：待规划` : "",
    ].filter(Boolean).join("\n\n"));
  }

  return { created };
}
