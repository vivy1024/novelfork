import type { StyleProfile } from "../../models/style-profile.js";
import type { HistogramBucket, RhythmAnalysis, RhythmIssue, SentenceRange } from "./rhythm-types.js";

const SENTENCE_PATTERN = /[^。！？!?\n]+[。！？!?]?/g;
const UNIFORM_STDDEV_THRESHOLD = 3;
const LONG_PARAGRAPH_THRESHOLD = 500;

export function analyzeRhythm(text: string, referenceProfile?: StyleProfile): RhythmAnalysis {
  const normalized = text.replace(/\r\n/g, "\n");
  const sentenceRanges = extractSentenceRanges(normalized);
  const sentenceLengths = sentenceRanges.map((sentence) => sentence.length);
  const paragraphLengths = normalized
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => paragraph.length);

  if (sentenceLengths.length === 0 && paragraphLengths.length === 0) {
    return {
      sentenceLengths: [],
      sentenceHistogram: [],
      paragraphLengths: [],
      avgSentenceLength: 0,
      sentenceLengthStdDev: 0,
      rhythmScore: 0,
      issues: [],
      sentenceRanges: [],
    };
  }

  const avgSentenceLength = average(sentenceLengths);
  const sentenceLengthStdDev = stdDev(sentenceLengths, avgSentenceLength);
  const sentenceHistogram = buildHistogram(sentenceLengths);
  const issues = buildRhythmIssues({
    sentenceRanges,
    sentenceLengthStdDev,
    paragraphLengths,
  });
  const rhythmScore = scoreRhythm(sentenceLengths, sentenceLengthStdDev, issues);

  return {
    sentenceLengths,
    sentenceHistogram,
    paragraphLengths,
    avgSentenceLength: round1(avgSentenceLength),
    sentenceLengthStdDev: round1(sentenceLengthStdDev),
    rhythmScore,
    issues,
    sentenceRanges,
    ...(referenceProfile
      ? {
          referenceComparison: {
            refAvgSentenceLength: referenceProfile.avgSentenceLength,
            refStdDev: referenceProfile.sentenceLengthStdDev,
            deviation: round3(calculateDeviation(avgSentenceLength, referenceProfile.avgSentenceLength)),
          },
        }
      : {}),
  };
}

function extractSentenceRanges(text: string): SentenceRange[] {
  const ranges: SentenceRange[] = [];
  for (const match of text.matchAll(SENTENCE_PATTERN)) {
    const raw = match[0] ?? "";
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const rawStart = match.index ?? 0;
    const leadingWhitespace = raw.length - raw.trimStart().length;
    const start = rawStart + leadingWhitespace;
    const end = start + trimmed.length;
    const length = countContentChars(trimmed);
    ranges.push({
      text: trimmed,
      length,
      start,
      end,
      bucket: bucketForLength(length),
    });
  }
  return ranges;
}

function buildHistogram(lengths: ReadonlyArray<number>): HistogramBucket[] {
  const counts = new Map<string, number>();
  for (const length of lengths) {
    const bucket = bucketForLength(length);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([range, count]) => ({ range, count }))
    .sort((left, right) => parseBucketStart(left.range) - parseBucketStart(right.range));
}

function buildRhythmIssues(params: {
  readonly sentenceRanges: ReadonlyArray<SentenceRange>;
  readonly sentenceLengthStdDev: number;
  readonly paragraphLengths: ReadonlyArray<number>;
}): RhythmIssue[] {
  const issues: RhythmIssue[] = [];
  if (params.sentenceRanges.length >= 3 && params.sentenceLengthStdDev < UNIFORM_STDDEV_THRESHOLD) {
    issues.push({
      type: "uniform-length",
      message: "句长过于均匀，可能削弱段落节奏并带来 AI 味。",
      affectedRanges: params.sentenceRanges.map((sentence) => ({ start: sentence.start, end: sentence.end })),
    });
  }
  if (params.sentenceRanges.length >= 4 && !params.sentenceRanges.some((sentence) => sentence.length <= 4)) {
    issues.push({
      type: "no-short-burst",
      message: "缺少短句爆点，建议在关键处加入短促收束。",
      affectedRanges: [],
    });
  }
  const longParagraphRanges = params.paragraphLengths
    .map((length, index) => ({ length, index }))
    .filter((paragraph) => paragraph.length > LONG_PARAGRAPH_THRESHOLD)
    .map((paragraph) => ({ start: paragraph.index, end: paragraph.index }));
  if (longParagraphRanges.length > 0) {
    issues.push({
      type: "too-long-paragraphs",
      message: "存在过长段落，可能影响移动端阅读节奏。",
      affectedRanges: longParagraphRanges,
    });
  }
  return issues;
}

function scoreRhythm(
  lengths: ReadonlyArray<number>,
  sentenceLengthStdDev: number,
  issues: ReadonlyArray<RhythmIssue>,
): number {
  if (lengths.length === 0) return 0;
  const alternation = calculateAlternation(lengths);
  const varianceScore = Math.min(45, sentenceLengthStdDev * 6);
  const alternationScore = Math.round(alternation * 35);
  const shortBurstScore = lengths.some((length) => length <= 4) ? 20 : 8;
  const penalty = issues.length * 8;
  return clamp(Math.round(varianceScore + alternationScore + shortBurstScore - penalty), 0, 100);
}

function calculateAlternation(lengths: ReadonlyArray<number>): number {
  if (lengths.length < 2) return 0;
  let turns = 0;
  for (let index = 1; index < lengths.length; index += 1) {
    if (Math.abs((lengths[index] ?? 0) - (lengths[index - 1] ?? 0)) >= 5) {
      turns += 1;
    }
  }
  return turns / (lengths.length - 1);
}

function calculateDeviation(current: number, reference: number): number {
  if (reference <= 0) return current > 0 ? 1 : 0;
  return Math.abs(current - reference) / reference;
}

function bucketForLength(length: number): string {
  const start = Math.floor(Math.max(1, length) / 5) * 5 + 1;
  const normalizedStart = length <= 5 ? 1 : start;
  return `${normalizedStart}-${normalizedStart + 4}`;
}

function parseBucketStart(range: string): number {
  return Number.parseInt(range.split("-")[0] ?? "0", 10);
}

function countContentChars(sentence: string): number {
  return sentence.replace(/[\s。！？!?，,；;：:"“”'‘’、]/g, "").length;
}

function average(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: ReadonlyArray<number>, avg: number): number {
  if (values.length <= 1) return 0;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
