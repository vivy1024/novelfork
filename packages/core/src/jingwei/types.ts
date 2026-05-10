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

export interface StoryJingweiEntryRecord {
  id: string;
  bookId: string;
  sectionId: string;
  title: string;
  contentMd: string;
  tags: string[];
  aliases: string[];
  customFields: Record<string, unknown>;
  relatedChapterNumbers: number[];
  relatedEntryIds: string[];
  visibilityRule: JingweiVisibilityRule;
  participatesInAi: boolean;
  tokenBudget: number | null;
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

// --- Legacy Bible types (moved from bible/types.ts) ---

export type BibleMode = "static" | "dynamic";

export type BibleVisibilitySource = "global" | "tracked" | "nested";

export type VisibilityRule =
  | { type: "global"; visibleAfterChapter?: number; visibleUntilChapter?: number }
  | { type: "tracked"; visibleAfterChapter?: number; visibleUntilChapter?: number }
  | { type: "nested"; parentIds: string[]; visibleAfterChapter?: number; visibleUntilChapter?: number };

export type BibleContextItemType = "character" | "event" | "setting" | "chapter-summary" | "conflict" | "world-model" | "premise" | "character-arc";

export interface BibleContextItem {
  id: string;
  type: BibleContextItemType;
  category?: string;
  name: string;
  content: string;
  priority: number;
  source: BibleVisibilitySource;
  estimatedTokens: number;
}

export interface BuildBibleContextInput {
  bookId: string;
  currentChapter?: number;
  sceneText?: string;
  tokenBudget?: number;
}

export interface BuildBibleContextResult {
  items: BibleContextItem[];
  totalTokens: number;
  droppedIds: string[];
  mode: BibleMode;
}

export interface BookRecord {
  id: string;
  name: string;
  bibleMode: BibleMode;
  currentChapter: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBookInput extends BookRecord {}

export interface UpdateBookInput {
  name?: string;
  bibleMode?: BibleMode;
  currentChapter?: number;
  updatedAt?: Date;
}

export interface BibleCharacterRecord {
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

export type CreateBibleCharacterInput = Omit<BibleCharacterRecord, "deletedAt">;
export type UpdateBibleCharacterInput = Partial<Omit<CreateBibleCharacterInput, "id" | "bookId" | "createdAt">>;

export interface BibleEventRecord {
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

export type CreateBibleEventInput = Omit<BibleEventRecord, "deletedAt">;
export type UpdateBibleEventInput = Partial<Omit<CreateBibleEventInput, "id" | "bookId" | "createdAt">>;

export interface BibleSettingRecord {
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

export type CreateBibleSettingInput = Omit<BibleSettingRecord, "deletedAt">;
export type UpdateBibleSettingInput = Partial<Omit<CreateBibleSettingInput, "id" | "bookId" | "createdAt">>;

export interface BibleChapterSummaryRecord {
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

export type CreateBibleChapterSummaryInput = Omit<BibleChapterSummaryRecord, "deletedAt">;
export type UpdateBibleChapterSummaryInput = Partial<Omit<CreateBibleChapterSummaryInput, "id" | "bookId" | "chapterNumber" | "createdAt">>;

export interface BibleConflictRecord {
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

export type CreateBibleConflictInput = Omit<BibleConflictRecord, "deletedAt">;
export type UpdateBibleConflictInput = Partial<Omit<CreateBibleConflictInput, "id" | "bookId" | "createdAt">>;

export interface BibleWorldModelRecord {
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

export type CreateBibleWorldModelInput = BibleWorldModelRecord;
export type UpdateBibleWorldModelInput = Partial<Omit<CreateBibleWorldModelInput, "id" | "bookId">>;

export interface BiblePremiseRecord {
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

export type CreateBiblePremiseInput = BiblePremiseRecord;
export type UpdateBiblePremiseInput = Partial<Omit<CreateBiblePremiseInput, "id" | "bookId" | "createdAt">>;

export interface BibleCharacterArcRecord {
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

export type CreateBibleCharacterArcInput = Omit<BibleCharacterArcRecord, "deletedAt">;
export type UpdateBibleCharacterArcInput = Partial<Omit<CreateBibleCharacterArcInput, "id" | "bookId" | "characterId" | "createdAt">>;

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
