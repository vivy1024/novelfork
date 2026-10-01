import type { RuntimeToolResult } from "@vivy1024/novelfork-core/plugins";

const ACTIONS = ["continue", "polish", "rewrite", "expand", "compress"] as const;

/** 只提交候选，正文写入必须由作者在编辑器里审阅并确认。from/to 可同时省略，编辑器改按 sourceText 在正文里定位。 */
export function proposeSelectionCandidate(input: Readonly<Record<string, unknown>>, bookId: string): RuntimeToolResult {
  const requestId = input.requestId;
  const chapterNumber = input.chapterNumber;
  const from = input.from;
  const to = input.to;
  const sourceText = input.sourceText;
  const candidateText = input.candidateText;
  const action = input.action;
  const hasFrom = from !== undefined && from !== null;
  const hasTo = to !== undefined && to !== null;
  const rangeValid = !hasFrom && !hasTo
    ? true
    : hasFrom && hasTo &&
      typeof from === "number" && Number.isSafeInteger(from) && from > 0 &&
      typeof to === "number" && Number.isSafeInteger(to) && to > from;
  const valid =
    typeof requestId === "string" && requestId.length > 0 && requestId.length <= 128 &&
    typeof chapterNumber === "number" && Number.isSafeInteger(chapterNumber) && chapterNumber > 0 &&
    rangeValid &&
    typeof sourceText === "string" && sourceText.trim().length > 0 && sourceText.length <= 10_000 &&
    typeof candidateText === "string" && candidateText.trim().length > 0 && candidateText.length <= 20_000 &&
    typeof action === "string" && ACTIONS.some((value) => value === action);
  if (!valid) {
    return {
      ok: false,
      error: "invalid-selection-candidate",
      summary: "选区候选缺少有效的请求编号、章号、原文、候选文本或操作类型，或 from/to 只给了一半。from/to 要么同时给出写作台原值，要么都省略改按原文定位；候选没有写入章节。",
    };
  }

  const artifact = {
    kind: "selection-candidate",
    id: requestId,
    requestId,
    bookId,
    chapterNumber,
    ...(rangeValid && hasFrom ? { from, to } : {}),
    sourceText,
    candidateText,
    action,
  };
  return {
    ok: true,
    summary: `第 ${chapterNumber} 章的选区改写候选已生成。请作者在正文里查看差异并决定是否采用；尚未覆盖原文。`,
    data: { artifact },
  };
}
