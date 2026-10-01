/**
 * 模型 JSON 的宽容解析：蒸馏、声线、章后结算三处共用。
 *
 * 2026-09-30 真模型基准（W0）发现：部分模型 / 中转会把中文弯引号 “” 输出成未转义的
 * ASCII `"`，中文小说的证据摘录几乎必然触发，JSON.parse 直接失败；输出上限不够时还会
 * 在中途截断。解析失败被静默吞掉，就成了「抽到 0 条」的假成功。
 *
 * 这里只做确定性的修补，不猜内容：
 * - 去掉代码围栏与 JSON 前后的说明文字；
 * - 字符串内部的 ASCII 引号（后面紧跟的不是 , : } ] 或结尾）视为正文引号，按出现次序还原成 “ ”；
 * - 字符串内部的裸换行、制表符转义；
 * - 去掉 } ] 前的多余逗号。
 * 修补后仍解析不了，或括号没有闭合（输出被截断），返回失败原因，由调用方如实报告。
 */

export type ModelJsonFailureReason = "no-json" | "truncated" | "invalid";

export type ModelJsonResult =
  | { readonly ok: true; readonly value: unknown; readonly repaired: boolean }
  | { readonly ok: false; readonly reason: ModelJsonFailureReason; readonly message: string };

export interface ParseModelJsonOptions {
  /** 顶层期望：对象、数组，或两者都行（默认）。 */
  readonly expect?: "object" | "array" | "any";
  /** 宿主告知输出因上限被截断。 */
  readonly outputTruncated?: boolean;
}

function stripFence(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)(?:```|$)/iu.exec(text);
  return fenced?.[1] ?? text;
}

function findStart(text: string, expect: "object" | "array" | "any"): number {
  const object = text.indexOf("{");
  const array = text.indexOf("[");
  if (expect === "object") return object;
  if (expect === "array") return array;
  if (object < 0) return array;
  if (array < 0) return object;
  return Math.min(object, array);
}

interface ScanResult {
  /** 修补后的 JSON 文本（从起点到顶层闭合处）。 */
  readonly text: string;
  /** 顶层括号是否闭合。 */
  readonly closed: boolean;
  readonly repaired: boolean;
}

/** 从起点逐字扫描：跟踪字符串与括号，修补字符串内的裸引号与控制字符。 */
function scanAndRepair(source: string, start: number): ScanResult {
  const out: string[] = [];
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let repaired = false;
  let quoteToggle = false;
  let index = start;

  for (; index < source.length; index += 1) {
    const char = source[index]!;
    if (inString) {
      if (escaped) {
        out.push(char);
        escaped = false;
        continue;
      }
      if (char === "\\") {
        out.push(char);
        escaped = true;
        continue;
      }
      if (char === "\"") {
        let lookahead = index + 1;
        while (lookahead < source.length && /\s/u.test(source[lookahead]!)) lookahead += 1;
        const next = source[lookahead];
        if (next === undefined || next === "," || next === ":" || next === "}" || next === "]") {
          out.push(char);
          inString = false;
          quoteToggle = false;
        } else {
          // 字符串里的正文引号：还原成中文引号，开合交替。
          out.push(quoteToggle ? "”" : "“");
          quoteToggle = !quoteToggle;
          repaired = true;
        }
        continue;
      }
      if (char === "\n") { out.push("\\n"); repaired = true; continue; }
      if (char === "\r") { repaired = true; continue; }
      if (char === "\t") { out.push("\\t"); repaired = true; continue; }
      out.push(char);
      continue;
    }

    if (char === "\"") {
      inString = true;
      quoteToggle = false;
      out.push(char);
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char === "{" ? "}" : "]");
      out.push(char);
      continue;
    }
    if (char === "}" || char === "]") {
      // 去掉闭合前的多余逗号
      let tail = out.length - 1;
      while (tail >= 0 && /\s/u.test(out[tail]!)) tail -= 1;
      if (tail >= 0 && out[tail] === ",") {
        out.splice(tail, 1);
        repaired = true;
      }
      if (stack.at(-1) === char) stack.pop();
      out.push(char);
      if (stack.length === 0) return { text: out.join(""), closed: true, repaired };
      continue;
    }
    out.push(char);
  }
  return { text: out.join(""), closed: false, repaired };
}

export function parseModelJson(raw: string, options: ParseModelJsonOptions = {}): ModelJsonResult {
  const expect = options.expect ?? "any";
  const text = stripFence(raw);
  const start = findStart(text, expect);
  if (start < 0) {
    return options.outputTruncated
      ? { ok: false, reason: "truncated", message: "模型输出在给出 JSON 之前就达到了长度上限。" }
      : { ok: false, reason: "no-json", message: "模型输出里没有 JSON。" };
  }

  // 先按原样解析：合规输出不做任何改动。
  const scanned = scanAndRepair(text, start);
  if (!scanned.closed) {
    return { ok: false, reason: "truncated", message: "模型输出被截断：JSON 没有闭合，可能达到了输出长度上限。" };
  }
  const original = text.slice(start, start + scanned.text.length);
  for (const [candidate, repaired] of [[original, false], [scanned.text, scanned.repaired]] as const) {
    try {
      return { ok: true, value: JSON.parse(candidate), repaired };
    } catch {
      // 继续尝试修补版本
    }
  }
  try {
    JSON.parse(scanned.text);
  } catch (error) {
    return { ok: false, reason: "invalid", message: `模型输出不是有效 JSON：${error instanceof Error ? error.message : String(error)}` };
  }
  return { ok: false, reason: "invalid", message: "模型输出不是有效 JSON。" };
}

/** 失败原因的作者可读说明（发生了什么之外的「怎么办」）。 */
export function modelJsonFailureAdvice(reason: ModelJsonFailureReason): string {
  switch (reason) {
    case "truncated":
      return "模型输出太长被截断了。重试一次；仍失败时换用输出上限更大的模型，或缩小处理范围。";
    case "no-json":
      return "模型没有按要求给出 JSON。重试一次；多次失败时换用更守格式的模型。";
    case "invalid":
      return "模型给出的 JSON 格式有误，修补后仍无法解析。重试一次；多次失败时换用更守格式的模型。";
  }
}
