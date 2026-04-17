/**
 * Rhythm Analyzer — 节奏分析核心逻辑
 * 实现 3+1 公式（3 章紧张 + 1 章过渡）和张弛度计算
 */

export interface TensionMetrics {
  readonly conflictDensity: number; // 冲突密度 0-100
  readonly emotionalIntensity: number; // 情感强度 0-100
  readonly informationLoad: number; // 信息量 0-100
}

export interface ChapterTension {
  readonly chapterNumber: number;
  readonly tension: number; // 综合张弛度 0-100
  readonly type: "high" | "transition" | "climax";
  readonly metrics: TensionMetrics;
}

export interface RhythmPattern {
  readonly isValid: boolean; // 是否符合 3+1 模式
  readonly violations: ReadonlyArray<string>; // 违规描述
  readonly score: number; // 节奏评分 0-100
}

export interface RhythmWarning {
  readonly type: "consecutive-high" | "rhythm-cliff" | "missing-climax";
  readonly chapterRange: [number, number];
  readonly message: string;
  readonly severity: "low" | "medium" | "high";
}

export interface RhythmAnalysis {
  readonly chapters: ReadonlyArray<ChapterTension>;
  readonly pattern: RhythmPattern;
  readonly warnings: ReadonlyArray<RhythmWarning>;
  readonly climaxPoints: ReadonlyArray<number>; // 高潮章节号
}

/**
 * 分析章节文本的张弛度
 */
export function analyzeTension(chapterText: string): number {
  const metrics = calculateMetrics(chapterText);
  // 加权平均：冲突 40%、情感 35%、信息 25%
  return Math.round(
    metrics.conflictDensity * 0.4 +
    metrics.emotionalIntensity * 0.35 +
    metrics.informationLoad * 0.25
  );
}

/**
 * 计算章节的三维指标
 */
function calculateMetrics(text: string): TensionMetrics {
  const words = text.length;
  if (words === 0) {
    return { conflictDensity: 0, emotionalIntensity: 0, informationLoad: 0 };
  }

  // 冲突密度：检测冲突关键词
  const conflictKeywords = [
    "打", "杀", "战", "斗", "争", "怒", "吼", "骂", "恨", "仇",
    "攻击", "防御", "反击", "逃", "追", "危险", "威胁", "对抗",
    "矛盾", "冲突", "对立", "敌", "血", "伤", "痛", "死"
  ];
  const conflictCount = conflictKeywords.reduce(
    (sum, kw) => sum + (text.match(new RegExp(kw, "g"))?.length || 0),
    0
  );
  const conflictDensity = Math.min(100, Math.round((conflictCount / words) * 10000));

  // 情感强度：检测情感关键词
  const emotionKeywords = [
    "！", "？", "…", "激动", "兴奋", "紧张", "恐惧", "愤怒", "悲伤",
    "喜悦", "震惊", "惊讶", "焦虑", "绝望", "希望", "爱", "恨",
    "心跳", "颤抖", "冷汗", "脸色", "眼神", "声音", "呼吸"
  ];
  const emotionCount = emotionKeywords.reduce(
    (sum, kw) => sum + (text.match(new RegExp(kw, "g"))?.length || 0),
    0
  );
  const emotionalIntensity = Math.min(100, Math.round((emotionCount / words) * 8000));

  // 信息量：对话、描写、新概念密度
  const dialogCount = (text.match(/["「『]/g)?.length || 0);
  const descCount = (text.match(/[，。、；：]/g)?.length || 0);
  const infoScore = Math.min(100, Math.round(((dialogCount + descCount) / words) * 5000));

  return {
    conflictDensity,
    emotionalIntensity,
    informationLoad: infoScore
  };
}

/**
 * 检测 3+1 节奏模式
 */
export function detectPattern(chapters: ReadonlyArray<ChapterTension>): RhythmPattern {
  if (chapters.length < 4) {
    return {
      isValid: false,
      violations: ["章节数不足 4 章，无法检测 3+1 模式"],
      score: 0
    };
  }

  const violations: string[] = [];
  let validPatterns = 0;
  let totalPatterns = 0;

  // 每 4 章检测一次
  for (let i = 0; i <= chapters.length - 4; i += 4) {
    const group = chapters.slice(i, i + 4);
    const tensions = group.map(c => c.tension);

    // 前 3 章应该是高张力（>60），第 4 章应该是过渡（<60）
    const highCount = tensions.slice(0, 3).filter(t => t > 60).length;
    const isTransition = tensions[3] < 60;

    totalPatterns++;
    if (highCount >= 2 && isTransition) {
      validPatterns++;
    } else {
      violations.push(
        `第 ${i + 1}-${i + 4} 章：前 3 章高张力不足（${highCount}/3），` +
        `第 4 章${isTransition ? "符合" : "不符合"}过渡要求`
      );
    }
  }

  const score = totalPatterns > 0 ? Math.round((validPatterns / totalPatterns) * 100) : 0;

  return {
    isValid: validPatterns === totalPatterns,
    violations,
    score
  };
}

/**
 * 检测节奏异常
 */
export function detectWarnings(chapters: ReadonlyArray<ChapterTension>): ReadonlyArray<RhythmWarning> {
  const warnings: RhythmWarning[] = [];

  // 检测连续高压（连续 5 章以上张力 >70）
  let highStreak = 0;
  let streakStart = 0;

  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].tension > 70) {
      if (highStreak === 0) streakStart = i;
      highStreak++;
    } else {
      if (highStreak >= 5) {
        warnings.push({
          type: "consecutive-high",
          chapterRange: [chapters[streakStart].chapterNumber, chapters[i - 1].chapterNumber],
          message: `连续 ${highStreak} 章高压，读者可能疲劳`,
          severity: highStreak >= 8 ? "high" : "medium"
        });
      }
      highStreak = 0;
    }
  }

  // 处理结尾的连续高压
  if (highStreak >= 5) {
    warnings.push({
      type: "consecutive-high",
      chapterRange: [chapters[streakStart].chapterNumber, chapters[chapters.length - 1].chapterNumber],
      message: `连续 ${highStreak} 章高压，读者可能疲劳`,
      severity: highStreak >= 8 ? "high" : "medium"
    });
  }

  // 检测节奏断崖（相邻章节张力差 >40）
  for (let i = 0; i < chapters.length - 1; i++) {
    const diff = Math.abs(chapters[i].tension - chapters[i + 1].tension);
    if (diff > 40) {
      warnings.push({
        type: "rhythm-cliff",
        chapterRange: [chapters[i].chapterNumber, chapters[i + 1].chapterNumber],
        message: `张力骤变 ${diff} 分，过渡不自然`,
        severity: diff >= 60 ? "high" : "medium"
      });
    }
  }

  // 检测缺失高潮（每 10 章应有至少 1 个 >80 的高潮）
  for (let i = 0; i < chapters.length; i += 10) {
    const group = chapters.slice(i, Math.min(i + 10, chapters.length));
    const hasClimax = group.some(c => c.tension > 80);
    if (!hasClimax && group.length >= 10) {
      warnings.push({
        type: "missing-climax",
        chapterRange: [chapters[i].chapterNumber, chapters[Math.min(i + 9, chapters.length - 1)].chapterNumber],
        message: `第 ${i + 1}-${i + 10} 章缺少高潮点`,
        severity: "medium"
      });
    }
  }

  return warnings;
}

/**
 * 标记高潮点（10 章小高潮、100-150 章大高潮）
 */
export function detectClimaxPoints(chapters: ReadonlyArray<ChapterTension>): ReadonlyArray<number> {
  const climaxPoints: number[] = [];

  for (const chapter of chapters) {
    const num = chapter.chapterNumber;

    // 10 的倍数章节，且张力 >75
    if (num % 10 === 0 && chapter.tension > 75) {
      climaxPoints.push(num);
    }
    // 100-150 章大高潮区间，张力 >85（排除已经被 10 倍数规则捕获的）
    else if (num >= 100 && num <= 150 && chapter.tension > 85) {
      climaxPoints.push(num);
    }
  }

  return climaxPoints;
}

/**
 * 完整节奏分析
 */
export function analyzeRhythm(
  chapters: ReadonlyArray<{ number: number; content: string }>
): RhythmAnalysis {
  const chapterTensions: ChapterTension[] = chapters.map(ch => {
    const metrics = calculateMetrics(ch.content);
    const tension = analyzeTension(ch.content);

    let type: "high" | "transition" | "climax" = "transition";
    if (tension > 80) type = "climax";
    else if (tension > 60) type = "high";

    return {
      chapterNumber: ch.number,
      tension,
      type,
      metrics
    };
  });

  const pattern = detectPattern(chapterTensions);
  const warnings = detectWarnings(chapterTensions);
  const climaxPoints = detectClimaxPoints(chapterTensions);

  return {
    chapters: chapterTensions,
    pattern,
    warnings,
    climaxPoints
  };
}
