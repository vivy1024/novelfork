/**
 * Lightweight local token estimate for budgeting and display only.
 * Provider usage remains the authoritative token accounting source.
 */
function isCjkCodePoint(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) || // CJK 统一表意文字
    (code >= 0x3400 && code <= 0x4dbf) || // CJK 扩展 A
    (code >= 0x3000 && code <= 0x303f) || // CJK 标点
    (code >= 0xff00 && code <= 0xffef) || // 全角及半角形式
    (code >= 0x3040 && code <= 0x30ff) || // 平假名/片假名
    (code >= 0xac00 && code <= 0xd7af) // 韩文音节
  );
}

export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (isCjkCodePoint(code)) cjk += 1;
    else other += 1;
  }
  return cjk + Math.ceil(other / 4);
}
