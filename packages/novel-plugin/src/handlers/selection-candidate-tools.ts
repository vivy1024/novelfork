import { createHash } from "node:crypto";

import type { RuntimeToolResult } from "@vivy1024/novelfork-core/plugins";

const ACTIONS = ["continue", "polish", "rewrite", "expand", "compress"] as const;

/** 读当前章节正文；章节不存在时返回 null。 */
export type SelectionChapterReader = (chapterNumber: number) => Promise<string | null>;

/**
 * 已交回写作台的候选（进程内，按书 + requestId）。候选本身不落盘，只随工具结果进叙述者消息；
 * 这里只为挡住同一 requestId 的重复提交：内容相同按幂等返回原候选，内容不同明确拒绝。
 */
type SubmittedCandidate =
  | { readonly state: "done"; readonly fingerprint: string; readonly artifact: Record<string, unknown> }
  // 校验进行中（await 读章节正文期间）就先占住 requestId：同一 requestId 并发提交时后到者看得见，
  // 不会两次都通过检查、后一次覆盖前一次。
  | { readonly state: "pending"; readonly fingerprint: string };
const SUBMITTED_CANDIDATES = new Map<string, SubmittedCandidate>();
// 每条登记留着候选全文（幂等重放要原样返回），上限按「最坏 3 万字一条」控制在几十 MB 以内。
const SUBMITTED_CANDIDATES_LIMIT = 500;

/** 仅测试用：清空已提交候选登记。 */
export function resetSubmittedSelectionCandidatesForTest(): void {
  SUBMITTED_CANDIDATES.clear();
}

function rememberCandidate(key: string, entry: SubmittedCandidate): void {
  if (!SUBMITTED_CANDIDATES.has(key) && SUBMITTED_CANDIDATES.size >= SUBMITTED_CANDIDATES_LIMIT) {
    const oldest = SUBMITTED_CANDIDATES.keys().next().value;
    if (oldest !== undefined) SUBMITTED_CANDIDATES.delete(oldest);
  }
  SUBMITTED_CANDIDATES.set(key, entry);
}

/** 指纹只存哈希：比对内容是否相同不需要留两份原文。 */
function candidateFingerprint(parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts), "utf8").digest("hex");
}

/** 逐字出现次数（与编辑器按原文定位的口径一致：重叠出现也算）。 */
function countOccurrences(text: string, fragment: string): number {
  let count = 0;
  let index = text.indexOf(fragment);
  while (index !== -1) {
    count += 1;
    if (count > 1) return count;
    index = text.indexOf(fragment, index + 1);
  }
  return count;
}

/**
 * 只提交候选，正文写入必须由作者在编辑器里审阅并确认。from/to 可同时省略，编辑器改按 sourceText 在正文里定位；
 * 这种按原文定位的候选在这里先核对 sourceText 在章节正文里逐字唯一出现，免得交回一条作者无法采用的候选。
 * 带 from/to 的划词候选来自编辑器当前选区（可能含尚未保存的改动），由编辑器按坐标逐字核对，这里不读盘比对。
 */
export async function proposeSelectionCandidate(
  input: Readonly<Record<string, unknown>>,
  bookId: string,
  readChapterText?: SelectionChapterReader,
): Promise<RuntimeToolResult> {
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

  const key = `${bookId}\u0000${requestId}`;
  const fingerprint = candidateFingerprint([chapterNumber, hasFrom ? from : null, hasTo ? to : null, sourceText, candidateText, action]);
  const previous = SUBMITTED_CANDIDATES.get(key);
  if (previous?.state === "pending") {
    return {
      ok: false,
      error: "request-in-progress",
      summary: `requestId ${requestId} 的候选正在提交中，这次重复提交没有处理。等上一条的结果返回后再看是否需要重交。`,
    };
  }
  if (previous) {
    if (previous.fingerprint === fingerprint) {
      return {
        ok: true,
        summary: `这条候选（requestId ${requestId}）已经提交过，沿用已有候选，没有重复生成。`,
        data: { artifact: previous.artifact, duplicate: true },
      };
    }
    return {
      ok: false,
      error: "duplicate-request-id",
      summary: `requestId ${requestId} 已用于另一条候选，候选没有提交。每条候选要用一个新的 requestId；如果是想修改那条候选，换一个新编号重新提交。`,
    };
  }

  const locateBySourceText = !hasFrom && !hasTo;
  if (locateBySourceText && readChapterText) {
    rememberCandidate(key, { state: "pending", fingerprint });
    let content: string | null;
    try {
      content = await readChapterText(chapterNumber);
    } catch (error) {
      SUBMITTED_CANDIDATES.delete(key);
      throw error;
    }
    // 校验没通过就释放占位：作者改了原文后可以用同一 requestId 重交。
    if (content === null || countOccurrences(content, sourceText) !== 1) SUBMITTED_CANDIDATES.delete(key);
    if (content === null) {
      return {
        ok: false,
        error: "chapter-not-found",
        summary: `找不到第 ${chapterNumber} 章，候选没有提交。请确认章号后用 chapter_read 重读章节再提交。`,
      };
    }
    const occurrences = countOccurrences(content, sourceText);
    if (occurrences === 0) {
      return {
        ok: false,
        error: "source-text-not-found",
        summary: `sourceText 在第 ${chapterNumber} 章正文里找不到逐字相同的原文，候选没有提交。常见原因是抄写时改了字（例如繁体写成简体）、标点或空格。请用 chapter_read 重读这一章，把原文原样复制到 sourceText 后再提交。`,
      };
    }
    if (occurrences > 1) {
      return {
        ok: false,
        error: "source-text-ambiguous",
        summary: `sourceText 在第 ${chapterNumber} 章正文里出现了不止一次，编辑器没法确定改哪一处，候选没有提交。请用 chapter_read 重读这一章，把 sourceText 扩大到包含前后文、在正文里只出现一次的原文再提交。`,
      };
    }
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
  rememberCandidate(key, { state: "done", fingerprint, artifact });
  return {
    ok: true,
    summary: `第 ${chapterNumber} 章的选区改写候选已生成。请作者在正文里查看差异并决定是否采用；尚未覆盖原文。`,
    data: { artifact },
  };
}
