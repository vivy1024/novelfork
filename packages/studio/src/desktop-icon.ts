import { deflateSync } from "node:zlib";

/**
 * NovelFork 桌面图标（EXE 图标与 Windows 托盘/管理器窗口图标）。
 *
 * 产品没有 .ico 素材，现有的 PWA 图标（`public/icons/icon-*.png`）是蓝底上写整词 "NovelFork"，
 * 缩到 16/32px 时文字糊成一条。这里沿用它的品牌蓝（manifest `theme_color` #3b82f6），改成圆角方块
 * 加白色粗体 "N" 字标，按需在任意尺寸矢量栅格化（4×4 超采样抗锯齿），不往仓库里放二进制素材：
 * 编译脚本从这里生成 .ico，产品入口把同一套像素交给 Runtime 管理器做托盘图标。
 */

const BRAND_BLUE = [0x3b, 0x82, 0xf6] as const;
const SUPERSAMPLE = 4;

type Point = readonly [number, number];

/** "N" 的三笔（单位正方形坐标，y 向下）：左竖、右竖、左上到右下的斜笔。 */
const GLYPH_STROKES: readonly (readonly Point[])[] = [
  [
    [0.28, 0.24],
    [0.4, 0.24],
    [0.4, 0.76],
    [0.28, 0.76],
  ],
  [
    [0.6, 0.24],
    [0.72, 0.24],
    [0.72, 0.76],
    [0.6, 0.76],
  ],
  [
    [0.28, 0.24],
    [0.41, 0.24],
    [0.72, 0.76],
    [0.59, 0.76],
  ],
];

function insideConvex(polygon: readonly Point[], x: number, y: number): boolean {
  let sign = 0;
  for (let index = 0; index < polygon.length; index++) {
    const [ax, ay] = polygon[index]!;
    const [bx, by] = polygon[(index + 1) % polygon.length]!;
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (cross === 0) continue;
    const side = cross > 0 ? 1 : -1;
    if (sign === 0) sign = side;
    else if (side !== sign) return false;
  }
  return true;
}

function insideRoundedSquare(x: number, y: number, radius: number): boolean {
  if (x < 0 || x > 1 || y < 0 || y > 1) return false;
  const cx = Math.min(Math.max(x, radius), 1 - radius);
  const cy = Math.min(Math.max(y, radius), 1 - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
}

/** size×size 的 RGBA 像素（行优先、自上而下、非预乘 alpha）。 */
export function renderNovelForkIcon(size: number): Uint8Array {
  if (!Number.isInteger(size) || size <= 0 || size > 1024) {
    throw new RangeError(`Unsupported icon size: ${size}`);
  }
  const pixels = new Uint8Array(size * size * 4);
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let covered = 0;
      let white = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = (px + (sx + 0.5) / SUPERSAMPLE) / size;
          const y = (py + (sy + 0.5) / SUPERSAMPLE) / size;
          if (!insideRoundedSquare(x, y, 0.22)) continue;
          covered++;
          if (GLYPH_STROKES.some((stroke) => insideConvex(stroke, x, y))) white++;
        }
      }
      if (covered === 0) continue;
      const offset = (py * size + px) * 4;
      const glyph = white / covered;
      for (let channel = 0; channel < 3; channel++) {
        pixels[offset + channel] = Math.round(BRAND_BLUE[channel]! * (1 - glyph) + 255 * glyph);
      }
      pixels[offset + 3] = Math.round((covered / samples) * 255);
    }
  }
  return pixels;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const fields = view(chunk);
  fields.setUint32(0, data.length);
  for (let index = 0; index < 4; index++) chunk[4 + index] = type.charCodeAt(index);
  chunk.set(data, 8);
  fields.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

/** RGBA → PNG（8 位 RGBA、无隔行、每行 filter 0）。 */
export function encodeRgbaPng(size: number, rgba: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  view(ihdr).setUint32(0, size);
  view(ihdr).setUint32(4, size);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = size * 4 + 1;
  const raw = new Uint8Array(stride * size);
  for (let y = 0; y < size; y++) {
    raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * stride + 1);
  }
  return concatBytes([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", new Uint8Array(deflateSync(raw))),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

/** 经典 ICO 图像项：32 位 BGRA 自下而上的 DIB + 1 位 AND 掩码（老版本资源管理器最认这种）。 */
function encodeDibEntry(size: number, rgba: Uint8Array): Uint8Array {
  const maskStride = Math.ceil(size / 32) * 4;
  const entry = new Uint8Array(40 + size * size * 4 + maskStride * size);
  const header = view(entry);
  header.setUint32(0, 40, true);
  header.setInt32(4, size, true);
  header.setInt32(8, size * 2, true);
  header.setUint16(12, 1, true);
  header.setUint16(14, 32, true);
  const maskStart = 40 + size * size * 4;
  for (let y = 0; y < size; y++) {
    const sourceRow = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const from = (sourceRow * size + x) * 4;
      const to = 40 + (y * size + x) * 4;
      entry[to] = rgba[from + 2]!;
      entry[to + 1] = rgba[from + 1]!;
      entry[to + 2] = rgba[from]!;
      entry[to + 3] = rgba[from + 3]!;
      if (rgba[from + 3] !== 0) continue;
      const index = maskStart + y * maskStride + (x >> 3);
      entry[index] = (entry[index] ?? 0) | (0x80 >> (x & 7));
    }
  }
  return entry;
}

export const NOVELFORK_ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256] as const;

/** 多尺寸 .ico：256 用 PNG 压缩项，其余用 DIB 项。 */
export function buildNovelForkIco(sizes: readonly number[] = NOVELFORK_ICO_SIZES): Uint8Array {
  const images = sizes.map((size) => {
    const rgba = renderNovelForkIcon(size);
    return { size, data: size >= 256 ? encodeRgbaPng(size, rgba) : encodeDibEntry(size, rgba) };
  });
  const directory = new Uint8Array(6 + images.length * 16);
  const fields = view(directory);
  fields.setUint16(2, 1, true);
  fields.setUint16(4, images.length, true);
  let offset = directory.length;
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    directory[entry] = image.size >= 256 ? 0 : image.size;
    directory[entry + 1] = image.size >= 256 ? 0 : image.size;
    fields.setUint16(entry + 4, 1, true);
    fields.setUint16(entry + 6, 32, true);
    fields.setUint32(entry + 8, image.data.length, true);
    fields.setUint32(entry + 12, offset, true);
    offset += image.data.length;
  });
  return concatBytes([directory, ...images.map((image) => image.data)]);
}
