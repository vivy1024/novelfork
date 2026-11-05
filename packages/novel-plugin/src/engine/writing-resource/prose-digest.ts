/**
 * 正文摘要：工具结果只回指纹与首尾摘录，不回显整章正文。
 *
 * 章节文件是正文唯一权威；工具结果会被 Runtime 原样存进会话库（工具调用、消息块），
 * 回显整章等于每写一次就在库里多一份全文副本。需要全文时按 path / 章号重新读章节文件。
 *
 * sha256 按落盘字节（UTF-8，不做归一化）计算，与 chapter.write / pipeline.write 的
 * expectedHash 并发校验同一口径；章节索引里的 contentHash 是归一化指纹，两者用途不同。
 */

import { createHash } from "node:crypto";

/** 首、尾摘录各自的最大字符数；两段合计不超过 120 字。 */
export const PROSE_EXCERPT_CHARS = 60;

export interface ProseDigest {
  readonly sha256: string;
  readonly bytes: number;
  readonly chars: number;
  /** 正文开头一小段；正文不超过 120 字时就是全文。 */
  readonly head: string;
  /** 正文结尾一小段；正文不超过 120 字时为空。 */
  readonly tail: string;
}

export function proseSha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function digestProse(text: string, excerptChars: number = PROSE_EXCERPT_CHARS): ProseDigest {
  // 按码点切，避免把代理对切成半个字符。
  const codePoints = Array.from(text);
  const short = codePoints.length <= excerptChars * 2;
  return {
    sha256: proseSha256(text),
    bytes: Buffer.byteLength(text, "utf8"),
    chars: codePoints.length,
    head: short ? text : codePoints.slice(0, excerptChars).join(""),
    tail: short ? "" : codePoints.slice(-excerptChars).join(""),
  };
}
