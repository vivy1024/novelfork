/**
 * 审稿 issue 双动作：定位原文 + auto_fixable 门控修订提案。
 *
 * 现有 AuditIssue 只有 severity/category/description/suggestion，没有独立
 * anchor 字段。定位回退链：
 *   1. description/suggestion 里的「」""『』引文
 *   2. 描述里能在正文命中的最长片段（≥ 8 字）
 *   3. 找不到则不可定位、也不可自动修
 */
export interface AuditIssueLite {
  readonly issueId?: string;
  readonly severity?: string;
  readonly category?: string;
  readonly description?: string;
  readonly suggestion?: string;
}

export interface LocateQuoteResult {
  readonly quote: string | null;
  readonly strategy: "anchor" | "quote" | "none";
}

const QUOTE_PATTERNS = [
  /「([^」]{4,80})」/u,
  /『([^』]{4,80})』/u,
  /“([^”]{4,80})”/u,
  /"([^"]{4,80})"/u,
];

const STRUCTURAL_CATEGORIES = [
  "时间线",
  "设定冲突",
  "ooc",
  "战力",
  "伏笔",
  "信息越界",
  "知识库",
  "正传事件",
  "世界规则",
  "大纲偏离",
  "timeline",
  "lore",
  "hook",
  "canon",
];

export function extractQuotedHint(text: string | undefined): string | null {
  const source = (text ?? "").trim();
  if (!source) return null;
  for (const pattern of QUOTE_PATTERNS) {
    const match = source.match(pattern);
    const quote = match?.[1]?.trim();
    if (quote && quote.length >= 4) return quote;
  }
  return null;
}

function longestContainedSnippet(haystack: string, needle: string, min = 4): string | null {
  const content = haystack.replace(/\s+/g, "");
  const compact = needle.replace(/\s+/g, "");
  if (compact.length < min) return null;
  if (haystack.includes(needle.trim()) && needle.trim().length >= min) return needle.trim();
  for (let length = Math.min(compact.length, 40); length >= min; length -= 1) {
    for (let start = 0; start <= compact.length - length; start += 1) {
      const slice = compact.slice(start, start + length);
      if (content.includes(slice) || haystack.includes(slice)) return slice;
    }
  }
  return null;
}

export function locateAuditIssueQuote(content: string, issue: AuditIssueLite): LocateQuoteResult {
  const hint = extractQuotedHint(issue.description) ?? extractQuotedHint(issue.suggestion);
  if (hint && (content.includes(hint) || content.replace(/\s+/g, "").includes(hint.replace(/\s+/g, "")))) {
    return { quote: hint, strategy: "anchor" };
  }
  const fallback = longestContainedSnippet(content, `${issue.description ?? ""} ${issue.suggestion ?? ""}`);
  if (fallback) return { quote: fallback, strategy: "quote" };
  return { quote: null, strategy: "none" };
}

export function isAutoFixableIssue(issue: AuditIssueLite, locate: LocateQuoteResult): boolean {
  if (locate.strategy === "none" || !locate.quote) return false;
  const severity = (issue.severity ?? "").toLowerCase();
  if (severity === "info") return false;
  const category = (issue.category ?? "").toLowerCase();
  if (STRUCTURAL_CATEGORIES.some((item) => category.includes(item))) return false;
  return true;
}

export function buildAuditFixProposalMessage(input: {
  readonly chapterNumber?: number;
  readonly issue: AuditIssueLite;
  readonly quote: string;
}): string {
  const chapter = input.chapterNumber ? `第 ${input.chapterNumber} 章` : "本章";
  return [
    `请为${chapter}生成定点修订提案，先不要直接覆盖正文。`,
    `问题：[${input.issue.severity ?? "warning"}] ${input.issue.category ?? "审稿"} — ${input.issue.description ?? ""}`,
    input.issue.suggestion ? `建议：${input.issue.suggestion}` : "",
    "",
    "定位原文：",
    input.quote,
    "",
    "请用 pipeline.revise / reviser spot-fix，只改问题句及其前后各一句，改完把提案给我确认。",
  ].filter((line) => line !== undefined).join("\n");
}

export const LOCATE_IN_EDITOR_EVENT = "novelfork:locate-in-editor";

export function dispatchLocateInEditor(quote: string): void {
  window.dispatchEvent(new CustomEvent(LOCATE_IN_EDITOR_EVENT, { detail: { quote } }));
}
