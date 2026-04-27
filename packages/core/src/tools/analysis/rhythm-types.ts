export interface SentenceRange {
  readonly text: string;
  readonly length: number;
  readonly start: number;
  readonly end: number;
  readonly bucket: string;
}

export interface HistogramBucket {
  readonly range: string;
  readonly count: number;
}

export interface RhythmAnalysis {
  readonly sentenceLengths: ReadonlyArray<number>;
  readonly sentenceHistogram: ReadonlyArray<HistogramBucket>;
  readonly paragraphLengths: ReadonlyArray<number>;
  readonly avgSentenceLength: number;
  readonly sentenceLengthStdDev: number;
  readonly rhythmScore: number;
  readonly issues: ReadonlyArray<RhythmIssue>;
  readonly sentenceRanges: ReadonlyArray<SentenceRange>;
  readonly referenceComparison?: {
    readonly refAvgSentenceLength: number;
    readonly refStdDev: number;
    readonly deviation: number;
  };
}

export interface RhythmIssue {
  readonly type: "uniform-length" | "no-short-burst" | "too-long-paragraphs";
  readonly message: string;
  readonly affectedRanges: ReadonlyArray<{
    readonly start: number;
    readonly end: number;
  }>;
}
