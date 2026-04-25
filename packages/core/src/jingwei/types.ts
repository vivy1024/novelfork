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
