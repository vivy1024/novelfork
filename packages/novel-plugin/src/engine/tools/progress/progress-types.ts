export interface WritingLog {
  readonly date: string;
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly wordCount: number;
  readonly completedAt: string;
}

export interface DailyProgress {
  readonly today: {
    readonly written: number;
    readonly target: number;
    readonly completed: boolean;
  };
  readonly thisWeek: {
    readonly written: number;
    readonly target: number;
  };
  readonly streak: number;
  readonly last30Days: ReadonlyArray<{
    readonly date: string;
    readonly wordCount: number;
  }>;
  readonly estimatedCompletionDate?: string;
}

export interface ProgressConfig {
  readonly dailyTarget: number;
  readonly weeklyTarget?: number;
  readonly totalChaptersTarget?: number;
  readonly avgWordsPerChapter?: number;
}
