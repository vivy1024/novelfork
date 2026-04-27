export type HookStyle =
  | "suspense"
  | "reversal"
  | "emotional"
  | "info-gap"
  | "action"
  | "mystery"
  | "cliffhanger";

export type RetentionEstimate = "high" | "medium" | "low";

export interface GeneratedHook {
  readonly id: string;
  readonly style: HookStyle;
  readonly text: string;
  readonly rationale: string;
  readonly retentionEstimate: RetentionEstimate;
  readonly relatedHookIds?: ReadonlyArray<string>;
}

export interface HookGeneratorInput {
  readonly chapterContent: string;
  readonly chapterNumber: number;
  readonly pendingHooks: string;
  readonly nextChapterIntent?: string;
  readonly bookGenre?: string;
}
