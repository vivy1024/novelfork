export type DialogueChapterType = "battle" | "daily" | "transition" | "mystery" | string;

export interface DialogueAnalysis {
  readonly totalWords: number;
  readonly dialogueWords: number;
  readonly dialogueRatio: number;
  readonly chapterType?: DialogueChapterType;
  readonly referenceRange: {
    readonly min: number;
    readonly max: number;
  };
  readonly isHealthy: boolean;
  readonly characterDialogue: ReadonlyArray<{
    readonly name: string;
    readonly wordCount: number;
    readonly lineCount: number;
    readonly ratio: number;
  }>;
  readonly issues: ReadonlyArray<string>;
}
