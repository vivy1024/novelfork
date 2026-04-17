/**
 * Golden Chapters Analyzer — 黄金三章检测器
 *
 * 分析前 3 章的节奏密度、冲突设置、悬念布局和留人点。
 * 基于确定性规则（零 LLM 成本）。
 */

export interface Hook {
  readonly position: number; // 字符位置
  readonly type: "conflict" | "mystery" | "worldview" | "character";
  readonly description: string;
  readonly strength: "strong" | "medium" | "weak";
}

export interface Issue {
  readonly severity: "error" | "warning";
  readonly category: string;
  readonly description: string;
  readonly suggestion: string;
}

export interface ChapterAnalysis {
  readonly chapterNumber: number;
  readonly score: number; // 0-100
  readonly density: {
    readonly conflict: number; // 冲突密度 0-100
    readonly mystery: number; // 悬念密度 0-100
    readonly info: number; // 信息量密度 0-100
  };
  readonly issues: ReadonlyArray<Issue>;
  readonly hooks: ReadonlyArray<Hook>;
}

export interface GoldenChaptersResult {
  readonly overallScore: number; // 0-100
  readonly chapters: ReadonlyArray<ChapterAnalysis>;
  readonly criticalIssues: ReadonlyArray<Issue>;
}

// --- 冲突标记词 ---
const CONFLICT_MARKERS_ZH = [
  /(?:冲突|矛盾|对抗|争执|争吵|打斗|战斗|厮杀|交锋|较量)/,
  /(?:怒|愤怒|暴怒|震怒|恼怒|气急败坏|勃然大怒)/,
  /(?:威胁|恐吓|警告|逼迫|强迫|胁迫)/,
  /(?:敌意|杀意|杀机|敌视|仇视)/,
  /(?:挑衅|嘲讽|讥讽|冷笑|嗤笑)/,
];

// --- 悬念标记词 ---
const MYSTERY_MARKERS_ZH = [
  /(?:疑惑|疑问|困惑|不解|纳闷|奇怪|诡异|蹊跷)/,
  /(?:秘密|隐藏|隐瞒|掩盖|遮掩|不为人知)/,
  /(?:真相|真实|实情|内幕|底细)/,
  /(?:为什么|怎么会|难道|莫非|竟然)/,
  /(?:预感|直觉|感觉|似乎|仿佛).*?(?:不对|不妙|不安|危险)/,
];

// --- 世界观展示标记 ---
const WORLDVIEW_MARKERS_ZH = [
  /(?:境界|修为|实力|等级|品阶|段位)/,
  /(?:功法|武技|法术|神通|秘术|绝学)/,
  /(?:宗门|门派|家族|势力|组织|联盟)/,
  /(?:灵气|真气|法力|魔力|元力|斗气)/,
  /(?:规则|法则|天道|大道|秩序)/,
];

// --- 角色塑造标记 ---
const CHARACTER_MARKERS_ZH = [
  /(?:性格|脾气|秉性|品性|气质)/,
  /(?:过往|经历|往事|回忆|曾经)/,
  /(?:目标|野心|梦想|追求|志向)/,
  /(?:弱点|软肋|缺陷|短板|致命伤)/,
  /(?:特点|特色|独特|与众不同|不同寻常)/,
];

// --- 开局毒点（第 1 章特有） ---
const OPENING_TOXIC_ZH = [
  /(?:穿越|重生|转世|觉醒|激活).*?(?:系统|金手指|外挂)/, // 开局直接交代金手指（太直白）
  /(?:三年之期已到|莫欺少年穷|三十年河东)/, // 老套开局
  /(?:废物|废柴|垃圾|窝囊废).*?(?:被|遭|受).*?(?:退婚|羞辱|嘲笑)/, // 开局受辱（需谨慎处理）
];

// --- 信息过载（第 1 章特有） ---
const INFO_OVERLOAD_ZH = [
  /(?:境界|等级).*?(?:分为|共有|包括).*?(?:一|二|三|四|五|六|七|八|九|十)/, // 开局大段设定说明
  /(?:宗门|门派|家族).*?(?:分别是|分为|有).*?(?:，|、).*?(?:，|、).*?(?:，|、)/, // 开局罗列大量势力
];

/**
 * 分析单章内容
 */
export function analyzeChapter(
  chapterNumber: number,
  content: string,
  language: "zh" | "en" = "zh"
): ChapterAnalysis {
  const issues: Issue[] = [];
  const hooks: Hook[] = [];

  // 计算密度
  const conflictDensity = calculateDensity(content, CONFLICT_MARKERS_ZH);
  const mysteryDensity = calculateDensity(content, MYSTERY_MARKERS_ZH);
  const infoDensity = calculateDensity(content, WORLDVIEW_MARKERS_ZH);

  // 检测留人点
  detectHooksInChapter(content, hooks);

  // 第 1 章特殊检测
  if (chapterNumber === 1) {
    checkChapter1(content, issues);
  }

  // 第 2 章特殊检测
  if (chapterNumber === 2) {
    checkChapter2(content, conflictDensity, issues);
  }

  // 第 3 章特殊检测
  if (chapterNumber === 3) {
    checkChapter3(content, mysteryDensity, hooks, issues);
  }

  // 计算章节评分
  const score = calculateChapterScore(chapterNumber, {
    conflict: conflictDensity,
    mystery: mysteryDensity,
    info: infoDensity,
  }, issues, hooks);

  return {
    chapterNumber,
    score,
    density: {
      conflict: conflictDensity,
      mystery: mysteryDensity,
      info: infoDensity,
    },
    issues,
    hooks,
  };
}

/**
 * 分析前 3 章
 */
export function analyzeGoldenChapters(
  chapters: ReadonlyArray<{ number: number; content: string }>,
  language: "zh" | "en" = "zh"
): GoldenChaptersResult {
  const analyses = chapters
    .filter(ch => ch.number >= 1 && ch.number <= 3)
    .map(ch => analyzeChapter(ch.number, ch.content, language));

  const criticalIssues = analyses
    .flatMap(a => a.issues)
    .filter(i => i.severity === "error");

  const overallScore = calculateOverallScore(analyses);

  return {
    overallScore,
    chapters: analyses,
    criticalIssues,
  };
}

// --- 辅助函数 ---

function calculateDensity(content: string, patterns: ReadonlyArray<RegExp>): number {
  const wordCount = content.length;
  if (wordCount === 0) return 0;

  let matchCount = 0;
  for (const pattern of patterns) {
    const matches = content.match(new RegExp(pattern, "g"));
    matchCount += matches ? matches.length : 0;
  }

  // 密度 = (匹配次数 / 字数) * 10000，归一化到 0-100
  const rawDensity = (matchCount / wordCount) * 10000;
  return Math.min(100, Math.round(rawDensity * 10));
}

function detectHooksInChapter(content: string, hooks: Hook[]): void {
  // 检测冲突留人点
  for (const pattern of CONFLICT_MARKERS_ZH) {
    const match = pattern.exec(content);
    if (match && match.index < 6000) {
      hooks.push({
        position: match.index,
        type: "conflict",
        description: `冲突点：${match[0]}`,
        strength: match.index < 2000 ? "strong" : match.index < 4000 ? "medium" : "weak",
      });
    }
  }

  // 检测悬念留人点
  for (const pattern of MYSTERY_MARKERS_ZH) {
    const match = pattern.exec(content);
    if (match && match.index < 6000) {
      hooks.push({
        position: match.index,
        type: "mystery",
        description: `悬念点：${match[0]}`,
        strength: match.index < 2000 ? "strong" : match.index < 4000 ? "medium" : "weak",
      });
    }
  }

  // 检测世界观留人点
  for (const pattern of WORLDVIEW_MARKERS_ZH) {
    const match = pattern.exec(content);
    if (match && match.index < 6000) {
      hooks.push({
        position: match.index,
        type: "worldview",
        description: `世界观：${match[0]}`,
        strength: match.index < 2000 ? "strong" : match.index < 4000 ? "medium" : "weak",
      });
    }
  }

  // 检测角色塑造留人点
  for (const pattern of CHARACTER_MARKERS_ZH) {
    const match = pattern.exec(content);
    if (match && match.index < 6000) {
      hooks.push({
        position: match.index,
        type: "character",
        description: `角色塑造：${match[0]}`,
        strength: match.index < 2000 ? "strong" : match.index < 4000 ? "medium" : "weak",
      });
    }
  }
}

function checkChapter1(content: string, issues: Issue[]): void {
  // 检测开局毒点
  for (const pattern of OPENING_TOXIC_ZH) {
    if (pattern.test(content)) {
      issues.push({
        severity: "error",
        category: "开局毒点",
        description: "第 1 章出现老套开局模式，容易让读者产生审美疲劳",
        suggestion: "避免使用过于常见的开局套路，尝试更新颖的切入点",
      });
      break;
    }
  }

  // 检测信息过载
  for (const pattern of INFO_OVERLOAD_ZH) {
    if (pattern.test(content)) {
      issues.push({
        severity: "warning",
        category: "信息过载",
        description: "第 1 章出现大段设定说明，可能导致读者疲劳",
        suggestion: "将世界观设定融入剧情，避免集中倾倒",
      });
      break;
    }
  }

  // 检测开局冲突
  const earlyConflict = content.slice(0, 2000);
  const hasEarlyConflict = CONFLICT_MARKERS_ZH.some(p => p.test(earlyConflict));
  if (!hasEarlyConflict) {
    issues.push({
      severity: "warning",
      category: "开局节奏",
      description: "前 2000 字缺乏明显冲突，可能无法快速抓住读者",
      suggestion: "在开篇尽早引入冲突或悬念，建立阅读期待",
    });
  }
}

function checkChapter2(content: string, conflictDensity: number, issues: Issue[]): void {
  // 第 2 章应该推进主线
  if (conflictDensity < 20) {
    issues.push({
      severity: "warning",
      category: "主线推进",
      description: "第 2 章冲突密度过低，主线推进不足",
      suggestion: "第 2 章应该延续第 1 章的冲突，推动主线发展",
    });
  }

  // 检测角色塑造
  const hasCharacterDev = CHARACTER_MARKERS_ZH.some(p => p.test(content));
  if (!hasCharacterDev) {
    issues.push({
      severity: "warning",
      category: "角色塑造",
      description: "第 2 章缺乏角色塑造内容",
      suggestion: "通过行动和对话展示主角性格特点",
    });
  }
}

function checkChapter3(
  content: string,
  mysteryDensity: number,
  hooks: ReadonlyArray<Hook>,
  issues: Issue[]
): void {
  // 第 3 章应该设置悬念
  if (mysteryDensity < 15) {
    issues.push({
      severity: "error",
      category: "悬念设置",
      description: "第 3 章悬念密度不足，缺乏留人点",
      suggestion: "第 3 章是黄金三章的最后一章，必须设置强悬念留住读者",
    });
  }

  // 检测 6000 字内的留人点
  const earlyHooks = hooks.filter(h => h.position < 6000 && h.strength !== "weak");
  if (earlyHooks.length < 2) {
    issues.push({
      severity: "error",
      category: "留人点不足",
      description: "第 3 章前 6000 字内缺乏足够的留人点",
      suggestion: "在章节前半部分设置至少 2 个强留人点（冲突/悬念/世界观）",
    });
  }
}

function calculateChapterScore(
  chapterNumber: number,
  density: { conflict: number; mystery: number; info: number },
  issues: ReadonlyArray<Issue>,
  hooks: ReadonlyArray<Hook>
): number {
  let score = 60; // 基础分

  // 密度加分
  if (chapterNumber === 1) {
    score += Math.min(20, density.conflict * 0.2); // 第 1 章重视冲突
    score += Math.min(10, density.info * 0.1); // 适度世界观
  } else if (chapterNumber === 2) {
    score += Math.min(20, density.conflict * 0.2); // 第 2 章重视冲突
    score += Math.min(10, density.mystery * 0.1); // 开始埋悬念
  } else if (chapterNumber === 3) {
    score += Math.min(15, density.conflict * 0.15);
    score += Math.min(15, density.mystery * 0.15); // 第 3 章重视悬念
  }

  // 留人点加分
  const strongHooks = hooks.filter(h => h.strength === "strong").length;
  const mediumHooks = hooks.filter(h => h.strength === "medium").length;
  score += strongHooks * 5 + mediumHooks * 2;

  // 问题扣分
  const errorCount = issues.filter(i => i.severity === "error").length;
  const warningCount = issues.filter(i => i.severity === "warning").length;
  score -= errorCount * 15 + warningCount * 5;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function calculateOverallScore(analyses: ReadonlyArray<ChapterAnalysis>): number {
  if (analyses.length === 0) return 0;

  // 加权平均：第 1 章 40%，第 2 章 30%，第 3 章 30%
  const weights = [0.4, 0.3, 0.3];
  let totalScore = 0;
  let totalWeight = 0;

  for (let i = 0; i < analyses.length; i++) {
    const analysis = analyses[i];
    const weight = weights[analysis.chapterNumber - 1] || 0;
    totalScore += analysis.score * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? Math.round(totalScore / totalWeight) : 0;
}
