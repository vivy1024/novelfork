/**
 * Platform writing profiles.
 *
 * Bridges the book-level `platform` field (product model) to the compliance
 * platform enum, and carries soft writing-side suggestions (chapter length,
 * hook density, and self-review notes) that the writing chain can surface
 * without presenting them as platform rules or hard gates.
 */

import type { SupportedPlatform } from "../compliance/types.js";

/** Product-level platform values in book.json. */
export type BookPlatform = "tomato" | "feilu" | "qidian" | "other" | string;

export interface PlatformProfile {
  readonly platform: SupportedPlatform;
  readonly label: string;
  /** Recommended chapter length window (Chinese characters). */
  readonly chapterWords: { readonly min: number; readonly ideal: number; readonly max: number };
  /** Recommended hooks planted/paid per chapter (soft guidance). */
  readonly hooksPerChapter: { readonly min: number; readonly ideal: number };
  /** Short, actionable writing notes (no theory). */
  readonly notes: readonly string[];
}

const PROFILES: Record<SupportedPlatform, PlatformProfile> = {
  fanqie: {
    platform: "fanqie",
    label: "番茄小说",
    chapterWords: { min: 1500, ideal: 2200, max: 3500 },
    hooksPerChapter: { min: 1, ideal: 2 },
    notes: [
      "快节奏：每章至少一个明确推进与一个新钩子。",
      "章尾留断点，避免平收。",
    ],
  },
  qidian: {
    platform: "qidian",
    label: "起点中文网",
    chapterWords: { min: 2000, ideal: 3000, max: 4500 },
    hooksPerChapter: { min: 1, ideal: 1 },
    notes: [
      "重信息增量与设定自洽，慢热可接受但每章要有增量。",
      "AI 味线索仅供人工复核，不代表平台审核结论。",
    ],
  },
  jjwxc: {
    platform: "jjwxc",
    label: "晋江文学城",
    chapterWords: { min: 2000, ideal: 3000, max: 6000 },
    hooksPerChapter: { min: 0, ideal: 1 },
    notes: [
      "重人物内心与关系推进，情绪线要连贯。",
      "敏感尺度从严，涉及情节需自审。",
    ],
  },
  qimao: {
    platform: "qimao",
    label: "七猫小说",
    chapterWords: { min: 1500, ideal: 2200, max: 3500 },
    hooksPerChapter: { min: 1, ideal: 2 },
    notes: ["与番茄相近的快节奏口径；章尾钩子必备。"],
  },
  generic: {
    platform: "generic",
    label: "通用",
    chapterWords: { min: 1500, ideal: 3000, max: 6000 },
    hooksPerChapter: { min: 0, ideal: 1 },
    notes: ["未指定平台：按书籍自身字数目标执行，仅做基础检查。"],
  },
};

const BOOK_PLATFORM_MAP: Record<string, SupportedPlatform> = {
  tomato: "fanqie",
  fanqie: "fanqie",
  番茄: "fanqie",
  qidian: "qidian",
  起点: "qidian",
  jjwxc: "jjwxc",
  晋江: "jjwxc",
  qimao: "qimao",
  七猫: "qimao",
  feilu: "generic",
  飞卢: "generic",
  other: "generic",
  generic: "generic",
};

export const SUPPORTED_PUBLISH_PLATFORMS: readonly SupportedPlatform[] = [
  "qidian",
  "jjwxc",
  "fanqie",
  "qimao",
  "generic",
];

export function isSupportedPlatform(value: unknown): value is SupportedPlatform {
  return typeof value === "string" && (SUPPORTED_PUBLISH_PLATFORMS as readonly string[]).includes(value);
}

/** Map a book-level platform (or explicit publishPlatform) to the compliance platform. */
export function resolvePublishPlatform(book: {
  readonly platform?: unknown;
  readonly publishPlatform?: unknown;
}): SupportedPlatform {
  if (isSupportedPlatform(book.publishPlatform)) return book.publishPlatform;
  const raw = typeof book.platform === "string" ? book.platform.trim().toLowerCase() : "";
  return BOOK_PLATFORM_MAP[raw] ?? (isSupportedPlatform(raw) ? raw : "generic");
}

export function getPlatformProfile(platform: SupportedPlatform): PlatformProfile {
  return PROFILES[platform] ?? PROFILES.generic;
}

export function resolvePlatformProfile(book: {
  readonly platform?: unknown;
  readonly publishPlatform?: unknown;
}): PlatformProfile {
  return getPlatformProfile(resolvePublishPlatform(book));
}

export interface PlatformTargetCheck {
  readonly platform: SupportedPlatform;
  readonly label: string;
  readonly configuredTarget: number;
  readonly recommended: PlatformProfile["chapterWords"];
  readonly status: "ok" | "below-min" | "above-max";
  readonly message?: string;
}

/**
 * Check the book's configured chapter word target against the platform window.
 * This is a soft signal (warning), never a hard gate.
 */
export function checkPlatformChapterTarget(input: {
  readonly profile: PlatformProfile;
  readonly chapterWordCount: number;
}): PlatformTargetCheck {
  const { profile, chapterWordCount } = input;
  const base = {
    platform: profile.platform,
    label: profile.label,
    configuredTarget: chapterWordCount,
    recommended: profile.chapterWords,
  };
  if (chapterWordCount < profile.chapterWords.min) {
    return {
      ...base,
      status: "below-min",
      message: `本书章目标 ${chapterWordCount} 字低于${profile.label}建议下限 ${profile.chapterWords.min} 字。`,
    };
  }
  if (chapterWordCount > profile.chapterWords.max) {
    return {
      ...base,
      status: "above-max",
      message: `本书章目标 ${chapterWordCount} 字高于${profile.label}建议上限 ${profile.chapterWords.max} 字。`,
    };
  }
  return { ...base, status: "ok" };
}
