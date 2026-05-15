export interface PovCharacter {
  readonly name: string;
  readonly totalChapters: number;
  readonly lastAppearanceChapter: number;
  readonly gapSinceLastAppearance: number;
  readonly chapterNumbers: ReadonlyArray<number>;
}

export interface PovDashboard {
  readonly characters: ReadonlyArray<PovCharacter>;
  readonly currentChapter: number;
  readonly warnings: ReadonlyArray<PovWarning>;
  readonly suggestion?: PovSuggestion;
}

export interface PovWarning {
  readonly characterName: string;
  readonly gapChapters: number;
  readonly message: string;
}

export interface PovSuggestion {
  readonly recommendedPov: string;
  readonly reason: string;
}
