import type { Platform } from "@actalk/inkos-core";

export interface StudioCreateBookBody {
  readonly title: string;
  readonly genre: string;
  readonly language?: string;
  readonly platform?: string;
  readonly chapterWordCount?: number;
  readonly targetChapters?: number;
}

export interface StudioBookConfigDraft {
  readonly id: string;
  readonly title: string;
  readonly platform: Platform;
  readonly genre: string;
  readonly status: "outlining";
  readonly targetChapters: number;
  readonly chapterWordCount: number;
  readonly language?: "zh" | "en";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function normalizeStudioPlatform(platform?: string): Platform {
  switch (platform) {
    case "tomato":
    case "feilu":
    case "qidian":
      return platform;
    default:
      return "other";
  }
}

export function buildStudioBookConfig(body: StudioCreateBookBody, now: string): StudioBookConfigDraft {
  return {
    id: body.title
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 30),
    title: body.title,
    platform: normalizeStudioPlatform(body.platform),
    genre: body.genre,
    status: "outlining",
    targetChapters: body.targetChapters ?? 200,
    chapterWordCount: body.chapterWordCount ?? 3000,
    ...(body.language === "en"
      ? { language: "en" as const }
      : body.language === "zh"
        ? { language: "zh" as const }
        : {}),
    createdAt: now,
    updatedAt: now,
  };
}
