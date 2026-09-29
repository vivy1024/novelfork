/**
 * 字节小工具：档案模块内部统一用 Uint8Array。
 * （本包的 @types/node 与 TypeScript 5.9 的类型化数组泛型不兼容，Buffer 不能直接当 Uint8Array 用。）
 */
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

export function asBytes(data: { readonly buffer: ArrayBufferLike; readonly byteOffset: number; readonly byteLength: number }): Uint8Array {
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

export function utf8Bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

export function utf8Text(data: Uint8Array): string {
  return decoder.decode(data);
}

export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

export function base64ToBytes(value: string): Uint8Array {
  return asBytes(Buffer.from(value, "base64"));
}

export function bytesToBase64(data: Uint8Array): string {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64");
}
