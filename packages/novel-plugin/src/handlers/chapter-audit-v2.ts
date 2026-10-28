/**
 * Chapter Audit v2 — 合并 ContinuityAuditor + Reviser + Canon Check + POV Check
 *
 * 硬约束检查：
 * - H2: Canon violation（新内容推翻已确立事实）
 * - H7: POV violation（角色知道视角外信息）
 *
 * 软约束检查：
 * - S1: 字数范围
 * - S2: AI 味评分
 * - S3: 伏笔超期
 * - S4: 角色弧线
 * - S5: 节奏模式
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import type { StoryJingweiEntryRecord, StoryJingweiSectionRecord } from "../engine/jingwei/types.js";
import { classifyCanonScope, isEntityCanonRelevant } from "../engine/narrative-memory/canon-scope.js";
import { createStoryJingweiEntryRepository } from "../engine/jingwei/repositories/entry-repo.js";
import { createStoryJingweiSectionRepository } from "../engine/jingwei/repositories/section-repo.js";
import { detectIntraChapterDupParagraphs } from "../engine/agents/post-write-validator.js";
import { detectPressureLedgerIssues, type PressureLedgerItem } from "../engine/agents/pressure-ledger-gate.js";

export interface AuditV2Input {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly content: string;
  readonly sceneSpec?: {
    readonly scenes?: ReadonlyArray<{
      readonly characters?: readonly string[];
      readonly location?: string;
      readonly conflict?: string;
      readonly outcome?: string;
    }>;
    readonly constraints?: readonly string[];
    readonly wordTarget?: number;
  };
  readonly pressureLedger?: {
    readonly items?: ReadonlyArray<PressureLedgerItem>;
  };
  readonly canonEntries?: ReadonlyArray<{
    readonly title: string;
    readonly contentMd: string;
    readonly category?: string;
  }>;
  readonly povCharacter?: string;
  readonly wordTarget?: number;
  readonly checks?: readonly string[];
}

export interface AuditV2Violation {
  readonly ruleId: string;
  readonly severity: "hard" | "soft";
  readonly location?: string;
  readonly description: string;
  readonly suggestion?: string;
}

export interface AuditV2Result {
  readonly ok: true;
  readonly passed: boolean;
  readonly hardViolations: AuditV2Violation[];
  readonly softViolations: AuditV2Violation[];
  readonly summary: string;
  readonly wordCount: number;
  readonly revisedContent?: string;
}

function countWords(text: string): number {
  return text.replace(/\s+/g, "").length;
}

function normalizeForSearch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

/**
 * 只认明确的禁止式开头。裸「不」开头的句子大多是叙述（「不久之后」「不少弟子」），
 * 截掉「不」后的残片会在正文里随处命中，是 H2 误报的主要来源，因此不再接受。
 */
const FORBIDDING_PREFIX = /^(严禁|禁止|不得|不准|不能|不可以|不允许|不可|绝不能|绝不可)/u;

/**
 * H2：canon 禁止式规则 × 正文的字面命中。
 *
 * 这是关键词级的粗筛，只能提示「可能违反」：命中一律是 soft（交人工复核），不作为拒存依据。
 * 已知误报来源（2026-10 评估）：
 * - 角色在对白里转述/讨论规则、反派故意破戒的情节，都会字面命中；前 40 字的否定/引用词窗口只能挡掉一部分；
 * - 被禁止的动作是常用词（「离开」「出手」）时，正文任何同词都会命中。
 * 已知漏报：规则写成「凡……者皆不得……」、或违反用同义改写（「踏剑而行」），字面匹配抓不到。
 */
function checkCanonViolations(content: string, canonEntries: AuditV2Input["canonEntries"]): AuditV2Violation[] {
  if (!canonEntries || canonEntries.length === 0) return [];
  const violations: AuditV2Violation[] = [];
  const normalizedContent = normalizeForSearch(content);

  for (const entry of canonEntries) {
    const facts = entry.contentMd.split(/[。！？\n]/).filter((s) => FORBIDDING_PREFIX.test(s.trim()));
    for (const fact of facts) {
      const trimmed = fact.trim();
      if (trimmed.length < 4) continue;

      // 只取禁止对象本身：截到第一个分句标点为止，「禁止御剑飞行，违者废去修为」只比对「御剑飞行」。
      const forbidden = trimmed.replace(FORBIDDING_PREFIX, "").split(/[，,、；;：:（(]/u)[0]!.trim().slice(0, 20);
      if (forbidden.length < 2) continue;

      const normalizedForbidden = normalizeForSearch(forbidden);
      // 使用统一的 normalizedContent（已去空格）进行搜索
      const idx = normalizedContent.indexOf(normalizedForbidden);
      if (idx === -1) continue;

      // 上下文窗口检查：关键词前 40 字符内是否有否定/引用词
      const windowStart = Math.max(0, idx - 40);
      const window = normalizedContent.slice(windowStart, idx);
      const negationInWindow = /禁止|不能|不可|不允许|不得|回忆|想起|提到|说过|规则|规定|法则|曾经/.test(window);

      violations.push(negationInWindow
        ? {
            ruleId: "H2",
            severity: "soft",
            location: `Canon「${entry.title}」→ 疑似`,
            description: `疑似违反 Canon 规则：「${trimmed}」（上下文含否定/引用词，可能是角色讨论规则而非实际违反）`,
            suggestion: `请人工确认正文是否真的违反了「${entry.title}」中的规则。`,
          }
        : {
            // 字面命中也只是「可能」：规则太粗，不能据此判定违反，统一交人工复核。
            ruleId: "H2",
            severity: "soft",
            location: `Canon「${entry.title}」`,
            description: `可能违反 Canon 规则：「${trimmed}」（正文出现「${forbidden}」）`,
            suggestion: `请检查正文是否与「${entry.title}」中的规则冲突；若是角色有意破戒或在讨论规则，可忽略。`,
          });
    }
  }

  return violations;
}

function checkPovViolations(content: string, sceneSpec: AuditV2Input["sceneSpec"], povCharacter?: string): AuditV2Violation[] {
  if (!povCharacter && !sceneSpec?.scenes?.length) return [];
  const violations: AuditV2Violation[] = [];

  // 检测常见 POV 违反模式
  const povIndicators = [
    { pattern: /他(?:心想|暗想|心中|内心).*?(?:她|他们|对方)(?:不知道|没想到|没料到)/g, desc: "叙述者透露了非 POV 角色的内心想法" },
    { pattern: /(?:与此同时|另一边|在.*?那里).*?(?:心想|暗想|决定|打算)/g, desc: "切换到非 POV 角色视角" },
  ];

  for (const { pattern, desc } of povIndicators) {
    const matches = content.match(pattern);
    if (matches && matches.length > 0) {
      violations.push({
        ruleId: "H7",
        severity: "hard",
        location: matches[0]?.slice(0, 50),
        description: desc,
        suggestion: "请确保只从当前 POV 角色的视角描写内心活动。",
      });
    }
  }

  return violations;
}

function checkSoftConstraints(content: string, input: AuditV2Input): AuditV2Violation[] {
  const violations: AuditV2Violation[] = [];

  // S6: 章内同段落复制粘贴（正文同一段在重复出现，黄金三章里尤其致命——第 1 章曾出现第 57/62 行同段回贴）
  for (const dup of detectIntraChapterDupParagraphs(content)) {
    violations.push({
      ruleId: "S6",
      severity: "soft",
      description: dup.description,
      suggestion: dup.suggestion,
    });
  }

  // S7: 压力账本闸。虚假结清/状态倒退硬拦，遗忘只警告。
  for (const issue of detectPressureLedgerIssues({
    chapterNumber: input.chapterNumber,
    content,
    items: input.pressureLedger?.items,
  })) {
    violations.push({
      ruleId: "S7",
      severity: issue.severity === "error" ? "hard" : "soft",
      description: issue.description,
      suggestion: issue.suggestion,
    });
  }

  const wordCount = countWords(content);
  const target = input.wordTarget ?? input.sceneSpec?.wordTarget ?? 3000;

  // S1: 字数范围 ±20%
  if (wordCount < target * 0.8) {
    violations.push({
      ruleId: "S1",
      severity: "soft",
      description: `章节字数 ${wordCount} 低于目标 ${target} 的 80%（${Math.round(target * 0.8)}）。`,
      suggestion: "考虑扩展场景描写或增加对话。",
    });
  } else if (wordCount > target * 1.2) {
    violations.push({
      ruleId: "S1",
      severity: "soft",
      description: `章节字数 ${wordCount} 超过目标 ${target} 的 120%（${Math.round(target * 1.2)}）。`,
      suggestion: "考虑精简冗余描写或拆分场景。",
    });
  }

  // S2: AI 味检测（简单启发式）
  const aiPatterns = [
    { pattern: /不禁|竟然|居然|没想到/g, threshold: 5, desc: "过度使用惊讶词" },
    { pattern: /仿佛|宛如|犹如|好似/g, threshold: 4, desc: "比喻词堆叠" },
    { pattern: /深邃|璀璨|绚烂|磅礴/g, threshold: 3, desc: "华丽形容词过多" },
  ];
  for (const { pattern, threshold, desc } of aiPatterns) {
    const matches = content.match(pattern);
    if (matches && matches.length > threshold) {
      violations.push({
        ruleId: "S2",
        severity: "soft",
        description: `AI 味检测：${desc}（出现 ${matches.length} 次，阈值 ${threshold}）。`,
        suggestion: "减少模式化用词，增加口语化和个性化表达。",
      });
    }
  }

  // S5: 检查 scene spec 约束是否被满足
  if (input.sceneSpec?.scenes) {
    for (const scene of input.sceneSpec.scenes) {
      if (scene.characters) {
        for (const char of scene.characters) {
          if (!content.includes(char)) {
            violations.push({
              ruleId: "S5",
              severity: "soft",
              description: `Scene Spec 要求角色「${char}」出场，但正文中未找到。`,
              suggestion: `确认「${char}」是否在本章出现，或更新 Scene Spec。`,
            });
          }
        }
      }
    }
  }

  return violations;
}

export function handleChapterAuditV2(input: AuditV2Input): AuditV2Result {
  const { content, canonEntries, sceneSpec, povCharacter, checks } = input;
  const wordCount = countWords(content);

  const enabledChecks = checks && checks.length > 0 ? new Set(checks) : null;
  const runCanon = !enabledChecks || enabledChecks.has("canon") || enabledChecks.has("continuity");
  const runPov = !enabledChecks || enabledChecks.has("pov") || enabledChecks.has("continuity");

  const ledgerEnabled = !enabledChecks || enabledChecks.has("ledger") || enabledChecks.has("continuity");
  const ledgerViolations = ledgerEnabled
    ? checkSoftConstraints(content, input).filter((v) => v.ruleId === "S7")
    : [];

  // H2 一律 soft（见 checkCanonViolations 的误报说明），放进 softViolations。
  const canonViolations = runCanon ? checkCanonViolations(content, canonEntries) : [];
  const hardViolations = [
    ...canonViolations.filter((v) => v.severity === "hard"),
    ...(runPov ? checkPovViolations(content, sceneSpec, povCharacter) : []),
    ...ledgerViolations.filter((v) => v.severity === "hard"),
  ];

  const softViolations = [...canonViolations.filter((v) => v.severity === "soft"), ...checkSoftConstraints(content, input).filter((v) => {
    if (v.ruleId === "S7") return ledgerEnabled && v.severity === "soft";
    if (!enabledChecks) return true;
    if (v.ruleId === "S1") return enabledChecks.has("rhythm") || enabledChecks.has("continuity");
    if (v.ruleId === "S2") return enabledChecks.has("ai_taste");
    if (v.ruleId === "S5") return enabledChecks.has("character") || enabledChecks.has("continuity");
    if (v.ruleId === "S6") return enabledChecks.has("repetition") || enabledChecks.has("continuity");
    return true;
  })];

  const passed = hardViolations.length === 0;
  const totalIssues = hardViolations.length + softViolations.length;

  const summary = passed
    ? totalIssues === 0
      ? `审计通过（${wordCount}字），无违反。`
      : `审计通过（${wordCount}字），${softViolations.length} 个软约束建议。`
    : `审计未通过（${wordCount}字）：${hardViolations.length} 个硬约束违反，${softViolations.length} 个软约束建议。`;

  return {
    ok: true,
    passed,
    hardViolations,
    softViolations,
    summary,
    wordCount,
  };
}

// ─── 写后设定一致性：本章相关 canon/规则条目 ────────────────────────────────────

export type AuditCanonEntry = NonNullable<AuditV2Input["canonEntries"]>[number];

/**
 * 纯函数：从全书条目中选出本章该过 H2 的 canon/规则条目。
 *
 * 分类口径与召回同源（engine/narrative-memory/canon-scope.ts，hard / state 通道也用它），
 * 只看经纬分类表态，不靠正则猜：
 * - 全书硬规则（故事基线 / 世界模型 / 能力体系 / 写作规则）：每章都要守，直接入选；
 * - 实体型 canon（角色 / 势力 / 地点 / 道具……）：本章正文、sceneSpec 角色里出现其标题或别名才入选。
 * 写进审计的条目因此与写前召回注入给模型的设定是同一批。
 */
export function selectChapterCanonEntries(input: {
  readonly entries: readonly StoryJingweiEntryRecord[];
  readonly sections: readonly StoryJingweiSectionRecord[];
  readonly content: string;
  readonly sceneCharacters?: readonly string[];
}): AuditCanonEntry[] {
  const sectionById = new Map(input.sections.map((section) => [section.id, section]));
  const sceneCharacters = input.sceneCharacters ?? [];
  const selected: AuditCanonEntry[] = [];
  for (const entry of input.entries) {
    // listEnabledForAi 只返回参与 AI 的分区；分区不在表里即视为不参与。
    const section = sectionById.get(entry.sectionId);
    if (!section) continue;
    if (!entry.participatesInAi || entry.status !== "confirmed" || entry.deletedAt) continue;
    if (entry.lifecycle && entry.lifecycle !== "active") continue;
    const scope = classifyCanonScope(entry, section);
    if (scope === "not-canon") continue;
    const relevant = scope === "book-rule" || isEntityCanonRelevant(entry, sceneCharacters, input.content);
    if (!relevant) continue;
    selected.push({ title: entry.title, contentMd: entry.contentMd, category: entry.category });
  }
  return selected;
}

/** 从经纬取本章相关 canon/规则条目；读取失败返回空（H2 只是提醒，不因取数失败阻断保存）。 */
export async function loadChapterCanonEntries(
  storage: StorageDatabase,
  bookId: string,
  content: string,
  sceneCharacters: readonly string[] = [],
): Promise<AuditCanonEntry[]> {
  const [sections, entries] = await Promise.all([
    createStoryJingweiSectionRepository(storage).listEnabledForAi(bookId),
    createStoryJingweiEntryRepository(storage).listByBook(bookId),
  ]);
  return selectChapterCanonEntries({ entries, sections, content, sceneCharacters });
}
