import type { DissectionStagingKind } from "../engine/jingwei/dissection-staging.js";
import type { DissectKnowledgePack } from "./dissect-knowledge.js";

export type DissectTarget = "characters" | "world" | "hooks" | "summaries" | "style" | "all";

export type DissectPurpose = "continue" | "fanfic" | "adapt" | "drama";

export interface DissectPurposeProfile {
  readonly purpose: DissectPurpose;
  readonly label: string;
  readonly description: string;
  readonly defaultTargets: readonly DissectTarget[];
  readonly stageKinds: readonly DissectionStagingKind[];
  readonly promptHint: string;
}

const PURPOSE_ALIASES: Record<string, DissectPurpose> = {
  continue: "continue",
  sequel: "continue",
  写后续: "continue",
  续写: "continue",
  fanfic: "fanfic",
  同人: "fanfic",
  adapt: "adapt",
  adaptation: "adapt",
  改编: "adapt",
  drama: "drama",
  script: "drama",
  漫剧: "drama",
  ai漫剧: "drama",
  "ai漫剧剧本": "drama",
  剧本: "drama",
};

export const DISSECT_PURPOSE_PROFILES: Record<DissectPurpose, DissectPurposeProfile> = {
  continue: {
    purpose: "continue",
    label: "写后续",
    description: "抽取续写所需的人物、设定、未回收伏笔和近章摘要。",
    defaultTargets: ["all"],
    stageKinds: [
      "characters",
      "locations",
      "factions",
      "power-system",
      "rules",
      "props",
      "world-model",
      "relationships",
      "foreshadowing",
      "chapter-summaries",
    ],
    promptHint: "目的是写后续：补齐能接着写的人物、世界设定、未回收伏笔和近章摘要。人物位置、伏笔状态等动态事实不要写进经纬，留给叙事记忆结算。",
  },
  fanfic: {
    purpose: "fanfic",
    label: "同人",
    description: "抽取原作人物、世界规则和关系，方便另开同人；不把原作近章进度当成新书记忆。",
    defaultTargets: ["characters", "world"],
    stageKinds: [
      "characters",
      "locations",
      "factions",
      "power-system",
      "rules",
      "props",
      "world-model",
      "relationships",
    ],
    promptHint: "目的是写同人：只要原作人物、世界规则和关系。不要把原作近章进度、未回收伏笔写成新书必须接着写的东西。",
  },
  adapt: {
    purpose: "adapt",
    label: "改编",
    description: "抽取人物、世界、情节骨架和关键伏笔，方便改编成其他体裁。",
    defaultTargets: ["characters", "world", "hooks", "summaries"],
    stageKinds: [
      "characters",
      "locations",
      "factions",
      "world-model",
      "relationships",
      "foreshadowing",
      "chapter-summaries",
    ],
    promptHint: "目的是改编：抓住人物、世界骨架、关键情节和必须交代的伏笔。动态状态仍走叙事记忆，不写进经纬草稿。",
  },
  drama: {
    purpose: "drama",
    label: "AI漫剧剧本",
    description: "抽取出场人物、场景地点和可分场的情节节拍，方便改成漫剧剧本。",
    defaultTargets: ["characters", "world", "summaries", "style"],
    stageKinds: ["characters", "locations", "relationships", "chapter-summaries"],
    promptHint: "目的是改成 AI 漫剧剧本：优先出场人物、场景地点和可分场的情节节拍。修炼体系、长线伏笔可以少抽。",
  },
};

export function resolveDissectPurpose(raw?: string): DissectPurpose | "invalid" {
  const key = raw?.trim().toLowerCase();
  if (!key) return "continue";
  return PURPOSE_ALIASES[key] ?? PURPOSE_ALIASES[raw?.trim() ?? ""] ?? "invalid";
}

export function dissectPurposeProfile(purpose: DissectPurpose): DissectPurposeProfile {
  return DISSECT_PURPOSE_PROFILES[purpose];
}

export function resolveDissectTargets(
  purpose: DissectPurpose,
  requested?: readonly DissectTarget[],
): Set<DissectTarget | "all"> {
  const profile = DISSECT_PURPOSE_PROFILES[purpose];
  if (!requested?.length || requested.includes("all")) {
    return new Set(profile.defaultTargets);
  }
  return new Set(requested);
}

export function shouldStageKind(purpose: DissectPurpose, kind: DissectionStagingKind): boolean {
  return DISSECT_PURPOSE_PROFILES[purpose].stageKinds.includes(kind);
}

export function filterKnowledgeForPurpose(
  pack: DissectKnowledgePack,
  purpose: DissectPurpose,
): DissectKnowledgePack {
  const kinds = new Set(DISSECT_PURPOSE_PROFILES[purpose].stageKinds);
  const keepCharacters = kinds.has("characters");
  const keepWorld = ["locations", "factions", "power-system", "rules", "props", "world-model"].some((kind) => kinds.has(kind as DissectionStagingKind));
  const keepHooks = kinds.has("foreshadowing");
  const keepSummaries = kinds.has("chapter-summaries");
  const keepRelations = kinds.has("relationships");
  const worldElements = keepWorld
    ? pack.worldElements.filter((element) => {
      if (element.category === "location") return kinds.has("locations");
      if (element.category === "faction") return kinds.has("factions");
      if (element.category === "power-system") return kinds.has("power-system");
      if (element.category === "rules") return kinds.has("rules");
      if (element.category === "props") return kinds.has("props");
      return kinds.has("world-model");
    })
    : [];
  const characterCards = keepCharacters ? pack.characterCards : [];
  const openHooks = keepHooks ? pack.openHooks : [];
  const detailedSummaries = keepSummaries ? pack.detailedSummaries : [];
  return {
    ...pack,
    characters: characterCards.map((card) => card.name),
    locations: worldElements.filter((element) => element.category === "location").map((element) => element.name),
    hooks: openHooks.map((hook) => hook.description),
    chapterSummaries: detailedSummaries.slice(-8).map((item) => ({ number: item.number, summary: item.summary })),
    characterCards,
    worldElements,
    detailedSummaries,
    openHooks,
    relationshipGraph: keepRelations ? pack.relationshipGraph : [],
    notes: [
      ...pack.notes,
      `拆书目的：${DISSECT_PURPOSE_PROFILES[purpose].label}。实体进经纬草稿，动态记忆仍走章后结算。`,
    ],
  };
}
