/**
 * Preset registry — central lookup for all built-in and custom presets.
 */

import type { BeatTemplate, LogicRiskRule, Preset, PresetBundle, PresetCategory, SettingBasePreset } from "./types.js";

const presetStore = new Map<string, Preset>();
const beatStore = new Map<string, BeatTemplate>();

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerPreset(preset: Preset): void {
  presetStore.set(preset.id, preset);
}

export function registerBeatTemplate(template: BeatTemplate): void {
  beatStore.set(template.id, template);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function getPreset(id: string): Preset | undefined {
  return presetStore.get(id);
}

export function listPresets(category?: PresetCategory): ReadonlyArray<Preset> {
  const all = Array.from(presetStore.values());
  if (!category) return all;
  return all.filter((p) => p.category === category);
}

export function getPresetsByGenre(genreId: string): ReadonlyArray<Preset> {
  return Array.from(presetStore.values()).filter(
    (p) => !p.compatibleGenres || p.compatibleGenres.includes(genreId),
  );
}

export function getBeatTemplate(id: string): BeatTemplate | undefined {
  return beatStore.get(id);
}

export function listBeatTemplates(): ReadonlyArray<BeatTemplate> {
  return Array.from(beatStore.values());
}

export function listSettingBases(): ReadonlyArray<SettingBasePreset> {
  return listPresets("setting-base") as ReadonlyArray<SettingBasePreset>;
}

export function listLogicRisks(): ReadonlyArray<LogicRiskRule> {
  return listPresets("logic-risk") as ReadonlyArray<LogicRiskRule>;
}

export function listBundles(): ReadonlyArray<PresetBundle> {
  return listPresets("bundle") as ReadonlyArray<PresetBundle>;
}

export function getBundle(id: string): PresetBundle | undefined {
  const preset = getPreset(id);
  return preset?.category === "bundle" ? (preset as PresetBundle) : undefined;
}

// ---------------------------------------------------------------------------
// Bulk registration helper
// ---------------------------------------------------------------------------

export function registerAll(presets: ReadonlyArray<Preset>, beats?: ReadonlyArray<BeatTemplate>): void {
  for (const p of presets) registerPreset(p);
  if (beats) {
    for (const b of beats) registerBeatTemplate(b);
  }
}

// ---------------------------------------------------------------------------
// Reset (for testing)
// ---------------------------------------------------------------------------

export function _resetForTesting(): void {
  presetStore.clear();
  beatStore.clear();
}

export type {
  Beat,
  BeatTemplate,
  GenrePresetBundle,
  LogicRiskRule,
  LogicRiskType,
  PostWriteCheck,
  Preset,
  PresetBundle,
  PresetCategory,
  PresetConfig,
  SettingBasePreset,
  TonePreset,
} from "./types.js";
