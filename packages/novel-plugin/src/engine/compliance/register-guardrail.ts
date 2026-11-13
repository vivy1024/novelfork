import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { createStoryJingweiEntryRepository } from "../jingwei/repositories/entry-repo.js";
import type { StoryJingweiEntryRecord } from "../jingwei/types.js";
import { stripParentheticalSuffix } from "../narrative-memory/entity-dictionary.js";
import { loadMechanismCards, type MechanismCard } from "../writing-layers/mechanism-cards.js";
import type { StylePreset } from "../writing-layers/style-preset.js";
import { loadStylePreset } from "../writing-layers/style-preset-store.js";

/**
 * 网文日常通用英文缩写白名单（大小写归一化后匹配）。
 * 未在此列且未在经纬已确认设定或本书 `registerGuardrail.allowedAsciiAcronyms` 中登记的
 * 连续大写科技术语缩写（如 SQUID、PLL、LEVSS、GMP、HPLC）与西式复合驼峰词将被拦截。
 */
export const DEFAULT_ALLOWED_ASCII_ACRONYMS: ReadonlySet<string> = new Set([
  "APP", "VIP", "SVIP", "PPT", "PDF", "POS", "ATM", "DNA", "RNA", "CPU", "GPU", "GPS",
  "AI", "UI", "OK", "PK", "BOSS", "NPC", "BUG", "CD", "DVD", "HP", "MP", "EXP", "LV",
  "KTV", "ICU", "CT", "MRI", "ECG", "B", "A", "S", "SS", "SSS", "SSR", "SR", "UR",
  "CEO", "CFO", "CTO", "COO", "HR", "PR", "IP", "ID", "QQ", "WIFI", "USB", "SIM",
  "LED", "LCD", "SUV", "MVP", "KO", "VS", "PC", "TV", "DJ", "MC", "CP", "BGM", "CG",
  "PS", "SOS", "UFO", "FBI", "CIA", "NBA", "CBA", "GDP", "CPI", "KPI", "PM", "AM",
  "II", "III", "IV", "VI", "VII", "VIII", "IX",
]);

export type RegisterViolationKind =
  | "ascii_acronym"
  | "western_tech_term"
  | "latex_formula"
  | "forbidden_source_term";

export interface RegisterGuardrailViolation {
  readonly kind: RegisterViolationKind;
  readonly severity: "hard" | "soft";
  readonly matched: string;
  readonly paragraphIndex: number;
  readonly paragraphExcerpt: string;
  readonly sourceTitle?: string;
  readonly explanation: {
    readonly whatHappened: string;
    readonly whyItMatters: string;
    readonly suggestedAction: string;
  };
}

export interface RegisterGuardrailReport {
  readonly enabled: boolean;
  readonly passed: boolean;
  readonly violations: readonly RegisterGuardrailViolation[];
  readonly sourceTermHits: readonly RegisterGuardrailViolation[];
  readonly asciiAndFormulaHits: readonly RegisterGuardrailViolation[];
}

export interface ConfirmedLoreExemptions {
  readonly asciiTokens: ReadonlySet<string>;
  readonly ownEntityNames: ReadonlySet<string>;
}

const ASCII_CODE_TOKEN_RE = /\b(?:[A-Z]{2,}[A-Za-z0-9]*(?:-[A-Za-z0-9]+)*|[A-Z]-\d+[A-Za-z0-9-]*|[A-Z][a-z]+(?:-[A-Z][a-z0-9]+)+|[A-Z][a-z]+[A-Z][A-Za-z0-9]*)\b/gu;
const LATEX_COMMAND_RE = /\\(?:frac|sqrt|alpha|beta|gamma|delta|omega|theta|lambda|sigma|sum|int|partial|nabla|infty|cdot|times|leq|geq|neq|approx)\b|\$\$[\s\S]{1,200}?\$\$|\$(?=[^\s$])[^$\n]{2,80}?(?<=[^\s$])\$/gu;

export interface ConfirmedEntryLike {
  readonly title: string;
  readonly aliases?: readonly string[];
  readonly contentMd?: string;
  readonly status?: string;
  readonly deletedAt?: Date | string | null;
  readonly lifecycle?: string;
}

/**
 * 从本书经纬已确认条目中提取豁免词：
 * 1. 标题、别名与设定正文中明确出现的英文代号/缩写（如 `B-17`、`T-800`）自动加入 ASCII 白名单；
 * 2. 已确认条目的标题与别名加入本书自有专名集合，防止与参考书撞名时误杀。
 */
export function extractConfirmedLoreExemptions(entries: readonly ConfirmedEntryLike[]): ConfirmedLoreExemptions {
  const asciiTokens = new Set<string>();
  const ownEntityNames = new Set<string>();

  for (const entry of entries) {
    if (entry.status !== undefined && entry.status !== "confirmed") continue;
    if (entry.deletedAt) continue;
    if (entry.lifecycle && entry.lifecycle !== "active") continue;

    const baseTitle = stripParentheticalSuffix(entry.title).trim() || entry.title.trim();
    if (baseTitle.length >= 2) ownEntityNames.add(baseTitle);
    if (entry.title.trim().length >= 2) ownEntityNames.add(entry.title.trim());

    for (const alias of entry.aliases ?? []) {
      const cleaned = alias.trim();
      if (cleaned.length >= 2) ownEntityNames.add(cleaned);
    }

    const combined = [entry.title, ...(entry.aliases ?? []), entry.contentMd ?? ""].join(" ");
    for (const match of combined.matchAll(ASCII_CODE_TOKEN_RE)) {
      asciiTokens.add(match[0]!.toUpperCase());
    }
  }

  return { asciiTokens, ownEntityNames };
}

export interface ForbiddenTermSourceEntry {
  readonly term: string;
  readonly sourceTitles: readonly string[];
}

export function collectBookForbiddenSourceTerms(input: {
  readonly stylePreset?: StylePreset | null;
  readonly mechanismCards?: readonly MechanismCard[];
  readonly ownEntityNames?: ReadonlySet<string>;
}): ForbiddenTermSourceEntry[] {
  const own = input.ownEntityNames ?? new Set<string>();
  const map = new Map<string, Set<string>>();

  const addTerm = (rawTerm: string, sourceTitle: string) => {
    const term = rawTerm.trim();
    if (term.length < 2 || own.has(term)) return;
    let set = map.get(term);
    if (!set) {
      set = new Set();
      map.set(term, set);
    }
    set.add(sourceTitle);
  };

  for (const source of input.stylePreset?.sources ?? []) {
    for (const term of source.forbiddenSourceTerms ?? []) {
      addTerm(term, source.title);
    }
  }
  for (const extra of input.stylePreset?.registerGuardrail?.extraForbiddenTerms ?? []) {
    addTerm(extra, "本书文风额外禁用词");
  }
  for (const card of input.mechanismCards ?? []) {
    for (const term of card.forbiddenSourceTerms ?? []) {
      addTerm(term, card.sourceTitle);
    }
  }

  return [...map.entries()]
    .map(([term, titles]) => ({ term, sourceTitles: [...titles] }))
    .sort((a, b) => b.term.length - a.term.length || a.term.localeCompare(b.term));
}

function excerptAround(paragraph: string, needle: string): string {
  const clean = paragraph.trim();
  const idx = clean.indexOf(needle);
  if (idx < 0 || clean.length <= 72) return clean.slice(0, 72);
  const start = Math.max(0, idx - 24);
  const end = Math.min(clean.length, idx + needle.length + 28);
  return `${start > 0 ? "…" : ""}${clean.slice(start, end)}${end < clean.length ? "…" : ""}`;
}

function stripMarkdownHeadings(line: string): boolean {
  return /^#{1,6}\s/u.test(line.trim());
}

export interface CheckRegisterGuardrailInput {
  readonly content: string;
  readonly stylePreset?: StylePreset | null;
  readonly mechanismCards?: readonly MechanismCard[];
  readonly confirmedEntries?: readonly ConfirmedEntryLike[];
  readonly allowedAsciiAcronyms?: readonly string[];
  readonly extraForbiddenTerms?: readonly string[];
}

export function checkRegisterGuardrail(input: CheckRegisterGuardrailInput): RegisterGuardrailReport {
  const guardrailConfig = input.stylePreset?.registerGuardrail;
  if (guardrailConfig?.enabled === false) {
    return {
      enabled: false,
      passed: true,
      violations: [],
      sourceTermHits: [],
      asciiAndFormulaHits: [],
    };
  }

  const exemptions = extractConfirmedLoreExemptions(input.confirmedEntries ?? []);
  const allowedAcronyms = new Set<string>([
    ...DEFAULT_ALLOWED_ASCII_ACRONYMS,
    ...exemptions.asciiTokens,
    ...(guardrailConfig?.allowedAsciiAcronyms ?? []).map((item) => item.trim().toUpperCase()).filter(Boolean),
    ...(input.allowedAsciiAcronyms ?? []).map((item) => item.trim().toUpperCase()).filter(Boolean),
  ]);

  const effectivePreset: StylePreset | null | undefined = input.extraForbiddenTerms?.length
    ? ({
      ...(input.stylePreset ?? {
        schemaVersion: 1,
        name: "临时",
        generalRules: [],
        sources: [],
        bookVoice: { tone: "", narrativeVoice: "", principles: [] },
        customConstraints: [],
        fingerprint: null,
      }),
      registerGuardrail: {
        ...guardrailConfig,
        extraForbiddenTerms: [
          ...(guardrailConfig?.extraForbiddenTerms ?? []),
          ...input.extraForbiddenTerms,
        ],
      },
    })
    : input.stylePreset;

  const forbiddenTerms = collectBookForbiddenSourceTerms({
    stylePreset: effectivePreset,
    mechanismCards: input.mechanismCards,
    ownEntityNames: exemptions.ownEntityNames,
  });

  const paragraphs = input.content.split(/\r?\n/u);
  const asciiAndFormulaHits: RegisterGuardrailViolation[] = [];
  const sourceTermHits: RegisterGuardrailViolation[] = [];
  const seenAscii = new Set<string>();
  const seenTerms = new Set<string>();

  paragraphs.forEach((rawPara, index) => {
    const paragraph = rawPara.trim();
    if (!paragraph || stripMarkdownHeadings(paragraph)) return;
    const paragraphNumber = index + 1;

    // 检查器 A1：LaTeX 公式痕迹
    for (const formulaMatch of paragraph.matchAll(LATEX_COMMAND_RE)) {
      const matched = formulaMatch[0]!.trim();
      // 排除诸如 "$100 ... $200" 中间夹中文逗号句号的价格误判
      if (matched.startsWith("$") && !matched.startsWith("$$") && /[，。！？；：]/u.test(matched)) continue;
      const dedupKey = `latex::${matched}`;
      if (seenAscii.has(dedupKey)) continue;
      seenAscii.add(dedupKey);
      asciiAndFormulaHits.push({
        kind: "latex_formula",
        severity: "hard",
        matched,
        paragraphIndex: paragraphNumber,
        paragraphExcerpt: excerptAround(paragraph, matched),
        explanation: {
          whatHappened: `第 ${paragraphNumber} 段出现 LaTeX 数学公式痕迹「${matched}」。`,
          whyItMatters: "小说正文中直接裸露排版公式或科学符号会瞬间击穿叙事语域，暴露生硬的论文/AI 腔。",
          suggestedAction: "用小说世界观内的口语算账或定性描述改写公式，删去 $ 与反斜杠数学命令。",
        },
      });
    }

    // 检查器 A2：未授权 ASCII 专业缩写与西式复合科技术语
    for (const tokenMatch of paragraph.matchAll(ASCII_CODE_TOKEN_RE)) {
      const token = tokenMatch[0]!;
      const upper = token.toUpperCase();
      // 豁免紧跟「超」的 B超 等中文固定词
      const afterChar = paragraph[tokenMatch.index! + token.length] ?? "";
      if (upper === "B" && afterChar === "超") continue;
      if (allowedAcronyms.has(upper)) continue;
      // 若外层带连字符的前缀/整体已在白名单（如 B-17 已登记），直接放行
      const basePart = upper.split("-")[0]!;
      if (allowedAcronyms.has(basePart) && /^[A-Z]-\d+$/u.test(upper)) continue;

      if (seenAscii.has(upper)) continue;
      seenAscii.add(upper);

      const isCamelOrHyphenTech = /[a-z]/u.test(token);
      asciiAndFormulaHits.push({
        kind: isCamelOrHyphenTech ? "western_tech_term" : "ascii_acronym",
        severity: "soft",
        matched: token,
        paragraphIndex: paragraphNumber,
        paragraphExcerpt: excerptAround(paragraph, token),
        explanation: {
          whatHappened: `第 ${paragraphNumber} 段出现未登记的西式缩写/科技术语「${token}」（摘录：「${excerptAround(paragraph, token)}」）。`,
          whyItMatters: "未经世界观设定的现代专业缩写（如实验室仪器、工程协议代号）会导致修仙/奇幻/本土网文严重出戏。",
          suggestedAction: `将「${token}」改写为小说内生中文器物或制度名称；若确系本书专有代号，请写入经纬已确认设定或加入 allowedAsciiAcronyms。`,
        },
      });
    }

    // 检查器 B：参考书原著专名防抄袭守卫
    for (const entry of forbiddenTerms) {
      if (!paragraph.includes(entry.term)) continue;
      if (seenTerms.has(entry.term)) continue;
      // 若已被更长的已报专名包含在同一段，避免子串重复刷屏
      if ([...seenTerms].some((longer) => longer.includes(entry.term) && paragraph.includes(longer))) continue;
      seenTerms.add(entry.term);
      const fromBooks = entry.sourceTitles.map((t) => `《${t}》`).join("、");
      sourceTermHits.push({
        kind: "forbidden_source_term",
        severity: "hard",
        matched: entry.term,
        paragraphIndex: paragraphNumber,
        paragraphExcerpt: excerptAround(paragraph, entry.term),
        sourceTitle: entry.sourceTitles.join("、"),
        explanation: {
          whatHappened: `第 ${paragraphNumber} 段命中参考书 ${fromBooks} 的原著专名「${entry.term}」（摘录：「${excerptAround(paragraph, entry.term)}」）。`,
          whyItMatters: "文风蒸馏与机制拆解只允许迁移句式节奏与冲突结构，直接泄漏参考书人名、地名、功法或专有器物名构成抄袭污染。",
          suggestedAction: `立即将「${entry.term}」替换为本书经纬设定中的原创内生词；若本书角色确需同名，请先在经纬确认该设定条目。`,
        },
      });
    }
  });

  const violations = [...sourceTermHits, ...asciiAndFormulaHits];
  const hasHard = violations.some((v) => v.severity === "hard");
  return {
    enabled: true,
    passed: !hasHard,
    violations,
    sourceTermHits,
    asciiAndFormulaHits,
  };
}

export async function runBookRegisterGuardrail(input: {
  readonly bookRoot: string;
  readonly bookId: string;
  readonly content: string;
  readonly storage?: StorageDatabase | null;
}): Promise<RegisterGuardrailReport> {
  const [loadedPreset, loadedMechanisms, entries] = await Promise.all([
    loadStylePreset(input.bookRoot).catch(() => null),
    loadMechanismCards(input.bookRoot).catch(() => ({ cards: [] as readonly MechanismCard[], revision: null })),
    input.storage
      ? createStoryJingweiEntryRepository(input.storage).listByBook(input.bookId).catch(() => [] as readonly StoryJingweiEntryRecord[])
      : Promise.resolve([] as readonly StoryJingweiEntryRecord[]),
  ]);
  return checkRegisterGuardrail({
    content: input.content,
    stylePreset: loadedPreset?.preset ?? null,
    mechanismCards: loadedMechanisms.cards,
    confirmedEntries: entries,
  });
}
