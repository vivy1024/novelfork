/**
 * Preset types for NovelFork writing presets system.
 *
 * Covers genre profiles, tone presets, setting bases,
 * logic risks, preset bundles, beat templates, AI-taste
 * filter presets, and literary technique presets.
 */

// ---------------------------------------------------------------------------
// Preset categories and base types
// ---------------------------------------------------------------------------

export type PresetCategory = "genre" | "tone" | "beat" | "setting-base" | "logic-risk" | "bundle" | "anti-ai" | "literary";

export interface Preset {
  readonly id: string;
  readonly name: string;
  readonly category: PresetCategory;
  readonly description: string;
  readonly promptInjection: string;
  readonly postWriteChecks?: ReadonlyArray<PostWriteCheck>;
  readonly compatibleGenres?: ReadonlyArray<string>;
  readonly tags?: ReadonlyArray<string>;
  readonly conflictGroup?: string;
}

export interface PostWriteCheck {
  readonly checkId: string;
  readonly name: string;
  readonly description: string;
  readonly checkType: "sentence-variance" | "emotion-concretize" | "dialogue-colloquial" | "custom";
  readonly threshold: number;
  readonly suggestion: string;
}

// ---------------------------------------------------------------------------
// Preset configuration per book
// ---------------------------------------------------------------------------

export interface PresetConfig {
  readonly bookId: string;
  readonly enabledPresetIds: ReadonlyArray<string>;
  readonly customOverrides?: Record<string, Partial<Preset>>;
}

// ---------------------------------------------------------------------------
// Beat templates
// ---------------------------------------------------------------------------

export interface Beat {
  readonly index: number;
  readonly name: string;
  readonly englishName?: string;
  readonly purpose: string;
  readonly wordRatio: number;
  readonly emotionalTone: string;
  readonly networkNovelTip?: string;
}

export interface BeatTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly beats: ReadonlyArray<Beat>;
}

// ---------------------------------------------------------------------------
// Tone, setting base, logic risk, and bundle presets
// ---------------------------------------------------------------------------

export interface TonePreset extends Preset {
  readonly category: "tone";
  readonly dimensions: {
    readonly narrativeVoice: string;
    readonly dialogueStyle: string;
    readonly sceneDescription: string;
    readonly transitionMethod: string;
    readonly pacing: string;
    readonly vocabularyPreference: string;
    readonly emotionalExpression: string;
    readonly driftWarnings: ReadonlyArray<string>;
  };
  readonly sourceReferences: ReadonlyArray<{
    readonly label: string;
    readonly usableTechnique: string;
    readonly boundary: "reference-only" | "do-not-copy";
  }>;
  readonly recommendedSettingBases: ReadonlyArray<string>;
}

export interface SettingBasePreset extends Preset {
  readonly category: "setting-base";
  readonly referenceAnchors: ReadonlyArray<string>;
  readonly socialHierarchy: ReadonlyArray<string>;
  readonly powerInstitutions: ReadonlyArray<string>;
  readonly economy: ReadonlyArray<string>;
  readonly techMagicBoundary: ReadonlyArray<string>;
  readonly transportAndInformation: ReadonlyArray<string>;
  readonly dailyLifeMaterials: ReadonlyArray<string>;
  readonly borrowableElements: ReadonlyArray<string>;
  readonly forbiddenElements: ReadonlyArray<string>;
  readonly commonContradictions: ReadonlyArray<string>;
}

export type LogicRiskType =
  | "anachronism"
  | "information-flow"
  | "economy-resource"
  | "institution-response"
  | "technology-boundary"
  | "character-motivation"
  | "geography-transport"
  | "satisfaction-cost";

export interface LogicRiskRule extends Preset {
  readonly category: "logic-risk";
  readonly riskType: LogicRiskType;
  readonly appliesToSettingBases: ReadonlyArray<string>;
  readonly writerConstraint: string;
  readonly auditQuestion: string;
  readonly evidenceHints: ReadonlyArray<string>;
  readonly uncertainHandling: string;
}

export interface PresetBundle extends Preset {
  readonly category: "bundle";
  readonly genreIds: ReadonlyArray<string>;
  readonly toneId: string;
  readonly settingBaseId: string;
  readonly logicRiskIds: ReadonlyArray<string>;
  readonly difficulty: "easy" | "medium" | "hard";
  readonly prerequisites: ReadonlyArray<string>;
  readonly suitableFor: ReadonlyArray<string>;
  readonly notSuitableFor: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Genre-specific preset data
// ---------------------------------------------------------------------------

export interface GenrePresetBundle {
  readonly genreId: string;
  readonly recommendedTones: ReadonlyArray<string>;
  readonly recommendedBeats: ReadonlyArray<string>;
  readonly recommendedAntiAi: ReadonlyArray<string>;
  readonly recommendedLiterary: ReadonlyArray<string>;
}
