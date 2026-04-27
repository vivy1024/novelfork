import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  ArcBeat,
  ArcType,
  BookHealthSummary,
  ChapterAuditLog,
  CharacterArc,
  ConflictDialecticExtension,
  DailyProgress,
  DialogueAnalysis,
  GeneratedHook,
  HookGeneratorInput,
  HookStyle,
  PovCharacter,
  PovDashboard,
  PovWarning,
  ProgressConfig,
  RhythmAnalysis,
  RhythmIssue,
  ToneDriftResult,
  WritingLog,
} from "../tools/index.js";

describe("writing tools type contracts", () => {
  it("exports task 1 writing tool types", () => {
    const hook: GeneratedHook = {
      id: "hook-1",
      style: "suspense",
      text: "门外响起了不该出现的脚步声。",
      rationale: "制造下一章问题。",
      retentionEstimate: "high",
      relatedHookIds: ["H001"],
    };
    const hookInput: HookGeneratorInput = {
      chapterContent: "本章正文",
      chapterNumber: 12,
      pendingHooks: "H001",
      nextChapterIntent: "揭露来者身份",
      bookGenre: "xianxia",
    };
    const povCharacter: PovCharacter = {
      name: "林青",
      totalChapters: 3,
      lastAppearanceChapter: 8,
      gapSinceLastAppearance: 4,
      chapterNumbers: [1, 5, 8],
    };
    const povWarning: PovWarning = {
      characterName: "林青",
      gapChapters: 12,
      message: "林青已 12 章未出现",
    };
    const povDashboard: PovDashboard = {
      characters: [povCharacter],
      currentChapter: 12,
      warnings: [povWarning],
      suggestion: {
        recommendedPov: "林青",
        reason: "间隔章数最高",
      },
    };
    const writingLog: WritingLog = {
      date: "2026-04-26",
      bookId: "book-1",
      chapterNumber: 12,
      wordCount: 6200,
      completedAt: "2026-04-26T10:00:00.000Z",
    };
    const dailyProgress: DailyProgress = {
      today: { written: 6200, target: 6000, completed: true },
      thisWeek: { written: 24000, target: 42000 },
      streak: 3,
      last30Days: [{ date: "2026-04-26", wordCount: 6200 }],
      estimatedCompletionDate: "2026-05-20",
    };
    const progressConfig: ProgressConfig = {
      dailyTarget: 6000,
      weeklyTarget: 42000,
      totalChaptersTarget: 100,
      avgWordsPerChapter: 3000,
    };
    const rhythmIssue: RhythmIssue = {
      type: "uniform-length",
      message: "句长过于均匀",
      affectedRanges: [{ start: 0, end: 12 }],
    };
    const rhythm: RhythmAnalysis = {
      sentenceLengths: [10, 18, 6],
      sentenceHistogram: [{ range: "6-10", count: 2 }],
      paragraphLengths: [120, 240],
      avgSentenceLength: 11,
      sentenceLengthStdDev: 5,
      rhythmScore: 72,
      issues: [rhythmIssue],
      sentenceRanges: [{ text: "测试句。", length: 3, start: 0, end: 4, bucket: "1-5" }],
      referenceComparison: {
        refAvgSentenceLength: 14,
        refStdDev: 7,
        deviation: 0.2,
      },
    };
    const dialogue: DialogueAnalysis = {
      totalWords: 1000,
      dialogueWords: 320,
      dialogueRatio: 0.32,
      chapterType: "daily",
      referenceRange: { min: 0.3, max: 0.5 },
      isHealthy: true,
      characterDialogue: [{ name: "林青", wordCount: 180, lineCount: 6, ratio: 0.5625 }],
      issues: [],
    };
    const auditLog: ChapterAuditLog = {
      bookId: "book-1",
      chapterNumber: 12,
      auditedAt: "2026-04-26T10:10:00.000Z",
      continuityPassed: true,
      continuityIssueCount: 0,
      aiTasteScore: 12,
      hookHealthIssues: 1,
      longSpanFatigueIssues: 0,
      sensitiveWordCount: 0,
      chapterType: "daily",
      mood: "tense",
      povCharacter: "林青",
      conflictsAdvanced: ["conflict-1"],
      arcBeats: [{ characterId: "char-1", event: "首次反抗" }],
    };
    const health: BookHealthSummary = {
      totalChapters: 12,
      totalWords: 72000,
      consistencyScore: 92,
      hookRecoveryRate: 0.5,
      pendingHooks: [],
      aiTasteAvg: 14,
      aiTasteTrend: [12, 16],
      pacingDiversityScore: 68,
      emotionCurve: ["tense", "relaxed"],
      sensitiveWordTotal: 0,
      stalledConflicts: [],
      hookDebtWarnings: [],
      fatigueWarnings: [],
      povGapWarnings: [{ character: "林青", gap: 12 }],
      mainConflictDrift: { conflictId: "conflict-1", stalledChapters: 6 },
    };
    const dialectic: ConflictDialecticExtension = {
      rank: "primary",
      nature: "antagonistic",
      sides: ["凡人", "仙道不公"],
      controllingIdea: "顺为凡，逆为仙",
      transformations: [
        {
          chapter: 12,
          fromState: "escalating",
          toState: "transforming",
          trigger: "宗门审判",
          rankChange: { from: "secondary", to: "primary" },
        },
      ],
    };
    const arcBeat: ArcBeat = {
      chapter: 12,
      event: "首次反抗宗门命令",
      change: "从服从转向质疑",
      direction: "advance",
    };
    const characterArc: CharacterArc = {
      characterId: "char-1",
      arcType: "positive-growth",
      startPoint: "唯唯诺诺",
      endPoint: "心怀天下",
      currentPhase: "觉醒期",
      beats: [arcBeat],
    };
    const tone: ToneDriftResult = {
      declaredTone: "悲苦孤独",
      detectedTone: "轻快",
      driftScore: 0.7,
      driftDirection: "偏向轻快",
      isSignificant: true,
      consecutiveDriftChapters: 3,
    };

    expect(hookInput.chapterNumber).toBe(12);
    expect(povDashboard.warnings).toHaveLength(1);
    expect(writingLog.wordCount).toBe(6200);
    expect(dailyProgress.today.completed).toBe(true);
    expect(progressConfig.dailyTarget).toBe(6000);
    expect(rhythm.issues[0]?.type).toBe("uniform-length");
    expect(dialogue.isHealthy).toBe(true);
    expect(auditLog.conflictsAdvanced).toEqual(["conflict-1"]);
    expect(health.mainConflictDrift?.stalledChapters).toBe(6);
    expect(dialectic.rank).toBe("primary");
    expect(characterArc.beats[0]).toEqual(arcBeat);
    expect(tone.isSignificant).toBe(true);
    expectTypeOf(hook.style).toEqualTypeOf<HookStyle>();
    expectTypeOf(characterArc.arcType).toEqualTypeOf<ArcType>();
  });
});
