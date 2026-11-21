/**
 * 执笔 / 返修工序的草稿写盘范围（产品侧，零 fork 改动）。
 *
 * 写章走「原生 Write 流式写入 targetChapterPath → workflow_step(submit, kind=prose, filePath)」。
 * Runtime 自带的 Write / Edit 不经过产品适配器，工序闸门在调用时拦不住它们（Runtime 没有
 * 给产品开放内置工具的执行前否决点）。产品能做到的两道约束都收在这里：
 *
 *   1. 交稿路径校验：submit 里的 filePath 必须是本运行这一章的章节文件
 *      （chapters/ 下、文件名能解析出章号且等于运行章号；不是 chapters/index.json、不在 _discarded）；
 *   2. 原生写盘审计：交稿 / 落盘前，按 Runtime 自己记录的工具调用核对本运行的叙述者
 *      在本轮工序里用原生写文件工具写过哪些路径，越出草稿范围的一律拒绝推进并说明。
 *
 * 审计是事后核对，不是事前拦截：越界写入已经发生，这里保证的是「越界写过的运行不能
 * 在作者不知情的情况下继续交稿 / 落盘」。事前拦截需要 Runtime 增加内置工具执行前钩子。
 */

import { isAbsolute, relative, resolve, sep } from "node:path";

import { parseChapterFileName } from "../writing-resource/chapter-file-name.js";
import type { WorkflowExplanation } from "./run-state-machine.js";
import type { WorkflowRunEvent } from "./run-store.js";

/** Runtime 自带、会改写文件内容的工具（与 Runtime extractToolPaths 的写类分支一致）。 */
export const NATIVE_FILE_WRITE_TOOLS: readonly string[] = ["Write", "Edit", "NotebookEdit", "StructSed"];

const CHAPTERS_DIR = "chapters";
const CHAPTER_INDEX_FILE = "index.json";
const DISCARDED_DIR = "_discarded";
/** Runtime 在工作目录下的自有元数据（计划文件等），不是书籍数据。 */
const RUNTIME_METADATA_DIR = ".narrafork";

function toPosix(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
}

export type WorkflowDraftPathCheck =
  | { readonly ok: true; readonly relativePath: string }
  | { readonly ok: false; readonly explanation: WorkflowExplanation };

/**
 * 交稿路径校验：书根相对路径（允许省略 chapters/ 前缀）必须指向本章的章节文件。
 * 只做字符串层判定；落点是否越出书根（联接 / 符号链接）由章节路径守卫再查一遍。
 */
export function checkWorkflowDraftFilePath(rawPath: string, chapterNumber: number): WorkflowDraftPathCheck {
  const normalized = toPosix(rawPath.trim());
  const relativePath = normalized.startsWith(`${CHAPTERS_DIR}/`) ? normalized : `${CHAPTERS_DIR}/${normalized}`;
  const segments = relativePath.split("/");
  const fileName = segments.at(-1) ?? "";
  const parsed = parseChapterFileName(fileName);
  const reject = (what: string): WorkflowDraftPathCheck => ({
    ok: false,
    explanation: {
      what,
      why: "执笔 / 返修只允许交本章的草稿文件；指向索引、其他章节或书内其他数据文件，会让作者审的内容与登记的文件对不上",
      action: "用 workflow_step（action=\"current\"）返回的 targetChapterPath 写入草稿，再把它作为 filePath 重交",
    },
  });
  if (!normalized || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return reject(`filePath「${rawPath}」不是合法的书内相对路径`);
  }
  if (fileName === CHAPTER_INDEX_FILE || segments.includes(DISCARDED_DIR)) {
    return reject(`filePath「${rawPath}」指向章节索引或废稿目录，不是章节草稿`);
  }
  if (!parsed || !fileName.toLowerCase().endsWith(".md")) {
    return reject(`filePath「${rawPath}」不是章节文件（应为 chapters/卷XX/XXXX_标题.md）`);
  }
  if (parsed.number !== chapterNumber) {
    return reject(`filePath「${rawPath}」是第 ${parsed.number} 章的文件，本运行写的是第 ${chapterNumber} 章`);
  }
  return { ok: true, relativePath };
}

export type WorkflowNativeWriteVerdict =
  /** 本章草稿文件：放行。 */
  | { readonly kind: "draft"; readonly relativePath: string }
  /** 书根下 Runtime 自有元数据（计划文件等）：放行。 */
  | { readonly kind: "runtime-metadata"; readonly relativePath: string }
  /** 越出草稿范围：书内其他文件，或书根之外。 */
  | { readonly kind: "violation"; readonly relativePath: string | null; readonly path: string };

function relativeInside(root: string, target: string): string | null {
  const rel = relative(resolve(root), resolve(target));
  if (rel === "") return "";
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

/**
 * 原生写文件的落点判定。`bookRoots` 传书根的各种写法（原样与 realpath），任一命中即视为书内。
 * 相对路径按写入时的工作目录解析；工作目录未知时按第一个书根解析。
 */
export function classifyWorkflowNativeWrite(
  bookRoots: readonly string[],
  chapterNumber: number,
  filePath: string,
  cwd?: string | null,
): WorkflowNativeWriteVerdict {
  const roots = bookRoots.filter((root) => typeof root === "string" && root.trim());
  const absolute = isAbsolute(filePath) ? filePath : resolve(cwd?.trim() || roots[0] || ".", filePath);
  for (const root of roots) {
    const rel = relativeInside(root, absolute);
    if (rel === null) continue;
    if (rel === RUNTIME_METADATA_DIR || rel.startsWith(`${RUNTIME_METADATA_DIR}/`)) {
      return { kind: "runtime-metadata", relativePath: rel };
    }
    if (rel.startsWith(`${CHAPTERS_DIR}/`) && checkWorkflowDraftFilePath(rel, chapterNumber).ok) {
      return { kind: "draft", relativePath: rel };
    }
    return { kind: "violation", relativePath: rel, path: absolute };
  }
  return { kind: "violation", relativePath: null, path: absolute };
}

/**
 * 一轮工序的起点：最近一次让写章工序（重新）开始的事件。
 * 作者批准上游 / 打回 / 重试 / 跳过、审校自动打回都会开启新的一轮；作者在越界告警后
 * 选择重试，也就从这里起重新核对，不会被上一轮的越界永久卡住。
 * 并行分支上别的工序的事件可能让起点偏晚（少查，不会误拦）。
 */
const ROUND_START_EVENTS = new Set([
  "run_started",
  "step_approved",
  "step_rejected",
  "step_retried",
  "step_skipped",
  "step_auto_returned",
]);

export function workflowDraftRoundStart(runCreatedAt: number, events: readonly WorkflowRunEvent[]): number {
  let start = runCreatedAt;
  for (const event of events) {
    if (ROUND_START_EVENTS.has(event.type) && event.at > start) start = event.at;
  }
  return start;
}

export interface WorkflowNativeWriteViolation {
  readonly toolName: string;
  /** 书根相对路径；书根之外时为绝对路径。 */
  readonly display: string;
}

const MAX_LISTED_VIOLATIONS = 5;

/** 越界写盘的三段式说明（交稿与落盘共用）。 */
export function explainOutOfScopeNativeWrites(
  chapterNumber: number,
  violations: readonly WorkflowNativeWriteViolation[],
  phase: "submit" | "commit",
): WorkflowExplanation | null {
  if (violations.length === 0) return null;
  const unique = [...new Map(violations.map((item) => [`${item.toolName}:${item.display}`, item])).values()];
  const listed = unique.slice(0, MAX_LISTED_VIOLATIONS).map((item) => `${item.toolName} ${item.display}`).join("、");
  const more = unique.length > MAX_LISTED_VIOLATIONS ? ` 等 ${unique.length} 处` : "";
  return {
    what: `${phase === "submit" ? "交稿" : "落盘"}被拦下：本轮工序里原生写文件工具写到了第 ${chapterNumber} 章草稿之外（${listed}${more}）`,
    why: "执笔 / 返修只允许写本章草稿文件；索引、记忆、经纬等书内数据只能由小说工具经作者确认写入，越界写入会让作者审的内容与书里的数据对不上",
    action: "不要继续交稿或落盘：用 workflow_step（action=\"blocker\"）把越界写入的文件清单报给作者，由作者核对、恢复后选择重试",
  };
}
