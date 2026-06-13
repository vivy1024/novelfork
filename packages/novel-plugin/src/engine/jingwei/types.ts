export type JingweiTemplateId = "blank" | "basic" | "enhanced" | "genre-recommended";

export type JingweiVisibilityRuleType = "tracked" | "global" | "nested";

export interface JingweiVisibilityRule {
  type: JingweiVisibilityRuleType;
  visibleAfterChapter?: number;
  visibleUntilChapter?: number;
  keywords?: string[];
  parentEntryIds?: string[];
}

export interface JingweiFieldDefinition {
  id: string;
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "multi-select" | "chapter" | "tags" | "relation" | "boolean";
  required: boolean;
  options?: string[];
  helpText?: string;
  participatesInSummary?: boolean;
}

export interface JingweiTemplateSection {
  key: string;
  name: string;
  description: string;
  order: number;
  enabled: boolean;
  showInSidebar: boolean;
  participatesInAi: boolean;
  defaultVisibility: JingweiVisibilityRuleType;
  fieldsJson: JingweiFieldDefinition[];
  builtinKind?: string;
  sourceTemplate?: string;
}

export interface JingweiTemplateSelection {
  templateId: JingweiTemplateId;
  genre?: string;
  selectedSectionKeys?: string[];
}

export interface AppliedJingweiTemplate {
  templateId: JingweiTemplateId;
  sourceGenre?: string;
  sections: JingweiTemplateSection[];
  availableCandidates: JingweiTemplateSection[];
}

export interface StoryJingweiSectionRecord {
  id: string;
  bookId: string;
  key: string;
  name: string;
  description: string;
  icon: string | null;
  order: number;
  enabled: boolean;
  showInSidebar: boolean;
  participatesInAi: boolean;
  defaultVisibility: JingweiVisibilityRuleType;
  fieldsJson: JingweiFieldDefinition[];
  builtinKind: string | null;
  sourceTemplate: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export type CreateStoryJingweiSectionInput = Omit<StoryJingweiSectionRecord, "deletedAt">;
export type UpdateStoryJingweiSectionInput = Partial<Omit<CreateStoryJingweiSectionInput, "id" | "bookId" | "createdAt">>;

export type JingweiPriorityTier = "core" | "relevant" | "reference" | "auto";

export type JingweiLayer = "canon" | "dynamic" | "reference";

export interface StoryJingweiEntryRecord {
  id: string;
  bookId: string;
  sectionId: string;
  title: string;
  contentMd: string;
  summaryMd?: string | null;
  tags: string[];
  aliases: string[];
  customFields: Record<string, unknown>;
  relatedChapterNumbers: number[];
  relatedEntryIds: string[];
  visibilityRule: JingweiVisibilityRule;
  participatesInAi: boolean;
  tokenBudget: number | null;
  priorityTier?: JingweiPriorityTier;
  layer?: JingweiLayer;
  /** 重要度评分 0-100，用于分级注入排序与逐条降级（默认 40） */
  importance?: number;
  /** 一句话摘要（L0），上下文预算紧张时的最简降级内容 */
  summaryL0?: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export type CreateStoryJingweiEntryInput = Omit<StoryJingweiEntryRecord, "deletedAt">;
export type UpdateStoryJingweiEntryInput = Partial<Omit<CreateStoryJingweiEntryInput, "id" | "bookId" | "createdAt">>;

export type JingweiContextSource = "global" | "tracked" | "nested";

export interface BuildJingweiContextInput {
  bookId: string;
  currentChapter?: number;
  sceneText?: string;
  tokenBudget?: number;
  mode?: "auto" | "core" | "relevant" | "full";
}

export interface JingweiContextItem {
  id: string;
  entryId: string;
  sectionId: string;
  sectionKey: string;
  sectionName: string;
  title: string;
  text: string;
  source: JingweiContextSource;
  priority: number;
  estimatedTokens: number;
}

export interface JingweiContextResult {
  items: JingweiContextItem[];
  totalTokens: number;
  droppedEntryIds: string[];
  sectionStats: Array<{ sectionId: string; sectionName: string; count: number }>;
}

export type JingweiReadCategory =
  | "premise"
  | "world-model"
  | "characters"
  | "relationships"
  | "factions"
  | "locations"
  | "power-system"
  | "timeline"
  | "chapter-summaries"
  | "foreshadowing"
  | "conflicts"
  | "props"
  | "rules"
  | "reference"
  | "unclassified";

/**
 * 经纬读取详细度（分级注入）：
 * - brief: L0 一句话
 * - summary: L1 核心摘要
 * - normal: L1 摘要 + 部分正文
 * - full: L2 完整正文
 */
export type JingweiDetailLevel = "brief" | "summary" | "normal" | "full";

export interface JingweiReadableItem {
  id: string;
  entryId: string;
  sectionId: string;
  sectionKey: string;
  sectionName: string;
  category: JingweiReadCategory;
  title: string;
  summaryMd: string;
  contentMd: string;
  source: JingweiContextSource;
  priority: number;
  estimatedTokens: number;
  updatedAtMs: number;
  tags: string[];
  aliases: string[];
  visibilityRule: JingweiVisibilityRule;
  priorityTier: JingweiPriorityTier;
  score?: number;
  matchReason?: string;
}

export interface JingweiBriefIndexCategory {
  category: JingweiReadCategory;
  title: string;
  count: number;
  estimatedTokens: number;
  coreCount: number;
  relevantCount: number;
  referenceCount: number;
  updatedAt: string | null;
  recommendedWhen: string;
}

export interface JingweiBriefIndex {
  categories: JingweiBriefIndexCategory[];
}

export interface JingweiReadBriefResult {
  ok: true;
  bookId: string;
  coreBrief: JingweiReadableItem[];
  index: JingweiBriefIndex;
  recommendedReads: Array<{ category: JingweiReadCategory; reason: string }>;
  estimatedTokens: number;
  droppedEntryIds: string[];
  omittedSummary?: string;
}

export interface JingweiReadCategoryResult {
  ok: true;
  bookId: string;
  category: JingweiReadCategory;
  items: JingweiReadableItem[];
  page: number;
  limit: number;
  totalAvailable: number;
  returnedCount: number;
  hasMore: boolean;
  nextPage?: number;
  estimatedTokens: number;
  droppedEntryIds: string[];
}

export interface JingweiSearchResult {
  ok: true;
  bookId: string;
  query: string;
  items: JingweiReadableItem[];
  totalAvailable: number;
  returnedCount: number;
  estimatedTokens: number;
  droppedEntryIds: string[];
}

// --- Legacy Bible types (renamed to Jingwei*) ---

export type JingweiMode = "static" | "dynamic";

export type JingweiVisibilitySource = "global" | "tracked" | "nested";

export type VisibilityRule =
  | { type: "global"; visibleAfterChapter?: number; visibleUntilChapter?: number }
  | { type: "tracked"; visibleAfterChapter?: number; visibleUntilChapter?: number }
  | { type: "nested"; parentIds: string[]; visibleAfterChapter?: number; visibleUntilChapter?: number };

export type JingweiContextItemType = "character" | "event" | "setting" | "chapter-summary" | "conflict" | "world-model" | "premise" | "character-arc";

export interface JingweiLegacyContextItem {
  id: string;
  type: JingweiContextItemType;
  category?: string;
  name: string;
  content: string;
  priority: number;
  source: JingweiVisibilitySource;
  estimatedTokens: number;
}

export interface BuildJingweiLegacyContextInput {
  bookId: string;
  currentChapter?: number;
  sceneText?: string;
  tokenBudget?: number;
}

export interface BuildJingweiLegacyContextResult {
  items: JingweiLegacyContextItem[];
  totalTokens: number;
  droppedIds: string[];
  mode: JingweiMode;
}

export interface BookRecord {
  id: string;
  name: string;
  jingweiMode: JingweiMode;
  currentChapter: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBookInput extends BookRecord {}

export interface UpdateBookInput {
  name?: string;
  jingweiMode?: JingweiMode;
  currentChapter?: number;
  updatedAt?: Date;
}

export interface JingweiCharacterRecord {
  id: string;
  bookId: string;
  name: string;
  aliasesJson: string;
  roleType: string;
  summary: string;
  traitsJson: string;
  visibilityRuleJson: string;
  firstChapter: number | null;
  lastChapter: number | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export type CreateJingweiCharacterInput = Omit<JingweiCharacterRecord, "deletedAt">;
export type UpdateJingweiCharacterInput = Partial<Omit<CreateJingweiCharacterInput, "id" | "bookId" | "createdAt">>;

export interface JingweiEventRecord {
  id: string;
  bookId: string;
  name: string;
  eventType: string;
  chapterStart: number | null;
  chapterEnd: number | null;
  summary: string;
  relatedCharacterIdsJson: string;
  visibilityRuleJson: string;
  foreshadowState: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export type CreateJingweiEventInput = Omit<JingweiEventRecord, "deletedAt">;
export type UpdateJingweiEventInput = Partial<Omit<CreateJingweiEventInput, "id" | "bookId" | "createdAt">>;

export interface JingweiSettingRecord {
  id: string;
  bookId: string;
  category: string;
  name: string;
  content: string;
  visibilityRuleJson: string;
  nestedRefsJson: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export type CreateJingweiSettingInput = Omit<JingweiSettingRecord, "deletedAt">;
export type UpdateJingweiSettingInput = Partial<Omit<CreateJingweiSettingInput, "id" | "bookId" | "createdAt">>;

export interface JingweiChapterSummaryRecord {
  id: string;
  bookId: string;
  chapterNumber: number;
  title: string;
  summary: string;
  wordCount: number;
  keyEventsJson: string;
  appearingCharacterIdsJson: string;
  pov: string;
  metadataJson: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export type CreateJingweiChapterSummaryInput = Omit<JingweiChapterSummaryRecord, "deletedAt">;
export type UpdateJingweiChapterSummaryInput = Partial<Omit<CreateJingweiChapterSummaryInput, "id" | "bookId" | "chapterNumber" | "createdAt">>;

export interface JingweiConflictRecord {
  id: string;
  bookId: string;
  name: string;
  type: string;
  scope: string;
  priority: number;
  protagonistSideJson: string;
  antagonistSideJson: string;
  stakes: string;
  rootCauseJson: string;
  evolutionPathJson: string;
  resolutionState: string;
  resolutionChapter: number | null;
  relatedConflictIdsJson: string;
  visibilityRuleJson: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export type CreateJingweiConflictInput = Omit<JingweiConflictRecord, "deletedAt">;
export type UpdateJingweiConflictInput = Partial<Omit<CreateJingweiConflictInput, "id" | "bookId" | "createdAt">>;

export interface JingweiWorldModelRecord {
  id: string;
  bookId: string;
  economyJson: string;
  societyJson: string;
  geographyJson: string;
  powerSystemJson: string;
  cultureJson: string;
  timelineJson: string;
  updatedAt: Date;
}

export type CreateJingweiWorldModelInput = JingweiWorldModelRecord;
export type UpdateJingweiWorldModelInput = Partial<Omit<CreateJingweiWorldModelInput, "id" | "bookId">>;

export interface JingweiPremiseRecord {
  id: string;
  bookId: string;
  logline: string;
  themeJson: string;
  tone: string;
  targetReaders: string;
  uniqueHook: string;
  genreTagsJson: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateJingweiPremiseInput = JingweiPremiseRecord;
export type UpdateJingweiPremiseInput = Partial<Omit<CreateJingweiPremiseInput, "id" | "bookId" | "createdAt">>;

export interface JingweiCharacterArcRecord {
  id: string;
  bookId: string;
  characterId: string;
  arcType: string;
  startingState: string;
  endingState: string;
  keyTurningPointsJson: string;
  currentPosition: string;
  visibilityRuleJson: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateJingweiCharacterArcInput = Omit<JingweiCharacterArcRecord, "deletedAt">;
export type UpdateJingweiCharacterArcInput = Partial<Omit<CreateJingweiCharacterArcInput, "id" | "bookId" | "characterId" | "createdAt">>;

export type QuestionnaireTier = 1 | 2 | 3;
export type QuestionnaireTargetObject = "premise" | "conflict" | "world-model" | "character-arc" | "character" | "setting";
export type QuestionnaireQuestionType = "single" | "multi" | "text" | "ranged-number" | "ai-suggest";
export type QuestionnaireTransform = "identity" | "join-comma" | "parse-int" | "ai-rewrite";

export interface QuestionnaireQuestionMapping {
  fieldPath: string;
  transform?: QuestionnaireTransform;
}

export interface QuestionnaireQuestionDependsOn {
  questionId: string;
  equals: string | number | boolean;
}

export interface QuestionnaireQuestion {
  id: string;
  prompt: string;
  type: QuestionnaireQuestionType;
  options?: string[];
  min?: number;
  max?: number;
  mapping: QuestionnaireQuestionMapping;
  dependsOn?: QuestionnaireQuestionDependsOn;
  hint?: string;
  defaultSkippable: boolean;
}

export interface BuiltinQuestionnaireTemplate {
  id: string;
  version: string;
  genreTags: string[];
  tier: QuestionnaireTier;
  targetObject: QuestionnaireTargetObject;
  questions: QuestionnaireQuestion[];
}

export interface QuestionnaireTemplateRecord {
  id: string;
  version: string;
  genreTagsJson: string;
  tier: QuestionnaireTier;
  targetObject: QuestionnaireTargetObject;
  questionsJson: string;
  isBuiltin: boolean;
  createdAt: Date;
}

export type CreateQuestionnaireTemplateInput = QuestionnaireTemplateRecord;

export interface QuestionnaireResponseRecord {
  id: string;
  bookId: string;
  templateId: string;
  targetObjectType: QuestionnaireTargetObject;
  targetObjectId: string | null;
  answersJson: string;
  status: "draft" | "submitted" | "skipped";
  answeredVia: "author" | "ai-assisted";
  createdAt: Date;
  updatedAt: Date;
}

export type CreateQuestionnaireResponseInput = QuestionnaireResponseRecord;
export type UpdateQuestionnaireResponseInput = Partial<Omit<CreateQuestionnaireResponseInput, "id" | "bookId" | "templateId" | "createdAt">>;

export interface CoreShiftRecord {
  id: string;
  bookId: string;
  targetType: "premise" | "character-arc" | "conflict" | "world-model" | "outline";
  targetId: string;
  fromSnapshotJson: string;
  toSnapshotJson: string;
  triggeredBy: "author" | "data-signal" | "continuity-audit";
  chapterAt: number;
  affectedChaptersJson: string;
  impactAnalysisJson: string;
  status: "proposed" | "accepted" | "rejected" | "applied";
  createdAt: Date;
  appliedAt: Date | null;
}

export type CreateCoreShiftInput = CoreShiftRecord;
export type UpdateCoreShiftInput = Partial<Omit<CreateCoreShiftInput, "id" | "bookId" | "targetType" | "targetId" | "createdAt">>;

// --- Deprecated aliases (backward compatibility) ---

/** @deprecated Use JingweiMode instead */
export type BibleMode = JingweiMode;
/** @deprecated Use JingweiVisibilitySource instead */
export type BibleVisibilitySource = JingweiVisibilitySource;
/** @deprecated Use JingweiContextItemType instead */
export type BibleContextItemType = JingweiContextItemType;
/** @deprecated Use JingweiLegacyContextItem instead */
export type BibleContextItem = JingweiLegacyContextItem;
/** @deprecated Use BuildJingweiLegacyContextInput instead */
export type BuildBibleContextInput = BuildJingweiLegacyContextInput;
/** @deprecated Use BuildJingweiLegacyContextResult instead */
export type BuildBibleContextResult = BuildJingweiLegacyContextResult;
/** @deprecated Use JingweiCharacterRecord instead */
export type BibleCharacterRecord = JingweiCharacterRecord;
/** @deprecated Use CreateJingweiCharacterInput instead */
export type CreateBibleCharacterInput = CreateJingweiCharacterInput;
/** @deprecated Use UpdateJingweiCharacterInput instead */
export type UpdateBibleCharacterInput = UpdateJingweiCharacterInput;
/** @deprecated Use JingweiEventRecord instead */
export type BibleEventRecord = JingweiEventRecord;
/** @deprecated Use CreateJingweiEventInput instead */
export type CreateBibleEventInput = CreateJingweiEventInput;
/** @deprecated Use UpdateJingweiEventInput instead */
export type UpdateBibleEventInput = UpdateJingweiEventInput;
/** @deprecated Use JingweiSettingRecord instead */
export type BibleSettingRecord = JingweiSettingRecord;
/** @deprecated Use CreateJingweiSettingInput instead */
export type CreateBibleSettingInput = CreateJingweiSettingInput;
/** @deprecated Use UpdateJingweiSettingInput instead */
export type UpdateBibleSettingInput = UpdateJingweiSettingInput;
/** @deprecated Use JingweiChapterSummaryRecord instead */
export type BibleChapterSummaryRecord = JingweiChapterSummaryRecord;
/** @deprecated Use CreateJingweiChapterSummaryInput instead */
export type CreateBibleChapterSummaryInput = CreateJingweiChapterSummaryInput;
/** @deprecated Use UpdateJingweiChapterSummaryInput instead */
export type UpdateBibleChapterSummaryInput = UpdateJingweiChapterSummaryInput;
/** @deprecated Use JingweiConflictRecord instead */
export type BibleConflictRecord = JingweiConflictRecord;
/** @deprecated Use CreateJingweiConflictInput instead */
export type CreateBibleConflictInput = CreateJingweiConflictInput;
/** @deprecated Use UpdateJingweiConflictInput instead */
export type UpdateBibleConflictInput = UpdateJingweiConflictInput;
/** @deprecated Use JingweiWorldModelRecord instead */
export type BibleWorldModelRecord = JingweiWorldModelRecord;
/** @deprecated Use CreateJingweiWorldModelInput instead */
export type CreateBibleWorldModelInput = CreateJingweiWorldModelInput;
/** @deprecated Use UpdateJingweiWorldModelInput instead */
export type UpdateBibleWorldModelInput = UpdateJingweiWorldModelInput;
/** @deprecated Use JingweiPremiseRecord instead */
export type BiblePremiseRecord = JingweiPremiseRecord;
/** @deprecated Use CreateJingweiPremiseInput instead */
export type CreateBiblePremiseInput = CreateJingweiPremiseInput;
/** @deprecated Use UpdateJingweiPremiseInput instead */
export type UpdateBiblePremiseInput = UpdateJingweiPremiseInput;
/** @deprecated Use JingweiCharacterArcRecord instead */
export type BibleCharacterArcRecord = JingweiCharacterArcRecord;
/** @deprecated Use CreateJingweiCharacterArcInput instead */
export type CreateBibleCharacterArcInput = CreateJingweiCharacterArcInput;
/** @deprecated Use UpdateJingweiCharacterArcInput instead */
export type UpdateBibleCharacterArcInput = UpdateJingweiCharacterArcInput;
