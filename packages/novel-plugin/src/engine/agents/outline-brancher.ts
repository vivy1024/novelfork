// ---------------------------------------------------------------------------
// Outline Brancher — 大纲分支 prompt 构建 / 结果解析
// ---------------------------------------------------------------------------

// ---- Types ----------------------------------------------------------------

export interface OutlineNode {
  id: string;
  title: string;
  summary: string;
}

export interface HookState {
  id: string;
  description: string;
  status: "planted" | "growing" | "resolved";
}

export interface ChapterSummary {
  chapterNumber: number;
  summary: string;
}

export interface OutlineBranch {
  branchId: string;
  title: string;
  description: string;
  chapters: OutlineBranchChapter[];
  risk: "low" | "medium" | "high";
  hookImpact: string[];
}

export interface OutlineBranchChapter {
  chapterNumber: number;
  title: string;
  summary: string;
}

// ---- Prompt builder -------------------------------------------------------

export function buildBranchPrompt(
  outline: OutlineNode[],
  hooks: HookState[],
  state: string,
  summaries: ChapterSummary[],
): string {
  const outlineBlock = outline
    .map((n) => `- [${n.id}] ${n.title}：${n.summary}`)
    .join("\n");

  const hooksBlock = hooks
    .map((h) => `- [${h.id}] (${h.status}) ${h.description}`)
    .join("\n");

  const summaryBlock = summaries
    .map((s) => `- 第 ${s.chapterNumber} 章：${s.summary}`)
    .join("\n");

  return [
    "# 大纲分支生成任务",
    "你是一位中文网文大纲策划助手。请基于当前大纲和剧情状态，生成 2-4 条可能的剧情分支走向。",
    `## 当前大纲\n${outlineBlock}`,
    `## 伏笔状态\n${hooksBlock}`,
    `## 当前剧情状态\n${state}`,
    `## 已完成章节摘要\n${summaryBlock}`,
    "## 输出格式",
    "请用以下 JSON 数组格式输出，每个分支包含：",
    "```json",
    "[",
    "  {",
    '    "branchId": "branch-1",',
    '    "title": "分支标题",',
    '    "description": "分支描述（50-100字）",',
    '    "chapters": [',
    '      { "chapterNumber": 11, "title": "章节标题", "summary": "章节摘要" }',
    "    ],",
    '    "risk": "low|medium|high",',
    '    "hookImpact": ["hook-id-1", "hook-id-2"]',
    "  }",
    "]",
    "```",
    "## 要求",
    "- 生成 2-4 条差异明显的分支",
    "- 每条分支规划 3-5 章",
    "- 标注风险等级：low（安全延续）、medium（有转折）、high（大反转）",
    "- 说明每条分支对现有伏笔的影响",
  ].join("\n\n");
}

// ---- Result parser --------------------------------------------------------

export function parseBranchResult(response: string): OutlineBranch[] {
  // 提取 JSON 块
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]) as OutlineBranch[];
    return parsed.map((branch, i) => ({
      branchId: branch.branchId || `branch-${i + 1}`,
      title: branch.title || `分支 ${i + 1}`,
      description: branch.description || "",
      chapters: Array.isArray(branch.chapters)
        ? branch.chapters.map((ch) => ({
            chapterNumber: ch.chapterNumber ?? 0,
            title: ch.title || "",
            summary: ch.summary || "",
          }))
        : [],
      risk: (["low", "medium", "high"] as const).includes(branch.risk as "low" | "medium" | "high")
        ? branch.risk
        : "medium",
      hookImpact: Array.isArray(branch.hookImpact) ? branch.hookImpact : [],
    }));
  } catch {
    return [];
  }
}
