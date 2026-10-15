import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { DiagnosticExplanation } from "./diagnostic-explanation.js";

/**
 * T-13②：book.json 的可读性判定。
 *
 * - missing：文件不存在，是合法的新书状态（由调用方按 book-not-found / 新书语义处理），不算读不出；
 * - busy：文件存在但读取失败（被同步盘、杀软占用，或无权限等），稍后重试可能就好；
 * - corrupt：读出来了但不是 JSON 对象，需要作者修复或从备份恢复。
 *
 * busy 与 corrupt 都必须按「配置读不出」阻断写作，不得说成「书不存在」，也不得静默退化为默认配置。
 * 运行时只依赖 node 内置模块（diagnostic-explanation 仅类型引用），供写前预检与写章管线共用。
 */
export type BookConfigReadability =
  | { readonly status: "ok" }
  | { readonly status: "missing" }
  | { readonly status: "busy"; readonly errorCode: string; readonly detail: string }
  | { readonly status: "corrupt"; readonly detail: string };

export type UnreadableBookConfig = Extract<BookConfigReadability, { status: "busy" | "corrupt" }>;

export async function checkBookConfigReadability(bookRoot: string): Promise<BookConfigReadability> {
  let raw: string;
  try {
    raw = await readFile(join(bookRoot, "book.json"), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") return { status: "missing" };
    return {
      status: "busy",
      errorCode: code ?? "UNKNOWN",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { status: "corrupt", detail: error instanceof Error ? error.message : String(error) };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { status: "corrupt", detail: "顶层不是 JSON 对象" };
  }
  return { status: "ok" };
}

export function isUnreadableBookConfig(result: BookConfigReadability): result is UnreadableBookConfig {
  return result.status === "busy" || result.status === "corrupt";
}

/** 兼容入口：book.json 存在却读不出或解析不了时返回 true；文件缺失（新书）返回 false。 */
export async function isBookJsonUnreadable(bookRoot: string): Promise<boolean> {
  return isUnreadableBookConfig(await checkBookConfigReadability(bookRoot));
}

/** 「占用/权限」与「内容损坏」两种措辞分开：前者稍后重试或解除占用，后者修复或从备份恢复。 */
export function explainUnreadableBookConfig(result: UnreadableBookConfig): DiagnosticExplanation {
  if (result.status === "busy") {
    return {
      whatHappened: `本书的 book.json 存在，但这次读取失败（${result.errorCode}），可能正被同步盘、杀毒软件或其他程序占用，或当前账户没有读取权限。`,
      whyItMatters: "写作依赖书籍配置里的字数目标、平台与门禁开关；读不到配置时继续写，会绕过这些门禁。文件内容本身不一定有问题。",
      suggestedAction: "稍后重试；若一直失败，关掉正在同步或扫描这本书目录的程序，确认该文件没有被占用、当前账户有读取权限后再写。",
    };
  }
  return {
    whatHappened: `本书的 book.json 内容已损坏，不是合法的配置（${result.detail}）。`,
    whyItMatters: "写作依赖书籍配置里的字数目标、平台与门禁开关；配置损坏时继续写，会绕过这些门禁。",
    suggestedAction: "从备份恢复 book.json，或修复其中的 JSON 语法错误后再写；修复前不要继续写章。",
  };
}
