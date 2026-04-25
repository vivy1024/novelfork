export type JingweiVisibilityRuleType = "tracked" | "global" | "nested";

export type JingweiFieldType = "text" | "textarea" | "number" | "select" | "multi-select" | "chapter" | "tags" | "relation" | "boolean";

export interface JingweiFieldDefinitionView {
  id: string;
  key: string;
  label: string;
  type: JingweiFieldType;
  required: boolean;
  options?: string[];
  helpText?: string;
  participatesInSummary?: boolean;
}

export interface JingweiVisibilityRuleView {
  type: JingweiVisibilityRuleType;
  visibleAfterChapter?: number;
  visibleUntilChapter?: number;
  keywords?: string[];
  parentEntryIds?: string[];
}

export interface JingweiSectionView {
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
  fieldsJson: JingweiFieldDefinitionView[];
  builtinKind: string | null;
  sourceTemplate: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  deletedAt: string | Date | null;
}

export interface JingweiEntryView {
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
  visibilityRule: JingweiVisibilityRuleView;
  participatesInAi: boolean;
  tokenBudget: number | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  deletedAt: string | Date | null;
}
