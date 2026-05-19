import type { StoryJingweiEntryRecord, StoryJingweiSectionRecord } from "../types.js";

export type JingweiContextLayer = "core" | "relevant" | "reference";

const CORE_CATEGORIES = new Set(["premise", "world-model", "core-memory"]);
const RELEVANT_CATEGORIES = new Set(["character", "faction", "foreshadowing", "arc", "timeline", "geography", "relationship", "chapter-summary"]);

export function resolveJingweiContextLayer(entry: StoryJingweiEntryRecord, section?: StoryJingweiSectionRecord): JingweiContextLayer {
  if (entry.priorityTier === "core") return "core";
  if (entry.priorityTier === "relevant") return "relevant";
  if (entry.priorityTier === "reference") return "reference";

  const category = String((entry.customFields.category ?? section?.builtinKind ?? section?.key ?? "")).toLowerCase();
  if (CORE_CATEGORIES.has(category) || entry.tags.includes("core") || section?.builtinKind === "core-memory" || section?.key === "core-memory") return "core";
  if (RELEVANT_CATEGORIES.has(category)) return "relevant";
  return "reference";
}

export function shouldIncludeLayer(mode: "auto" | "core" | "relevant" | "full", layer: JingweiContextLayer): boolean {
  if (mode === "full") return true;
  if (mode === "core") return layer === "core";
  if (mode === "relevant") return layer === "relevant";
  return layer === "core" || layer === "relevant";
}
