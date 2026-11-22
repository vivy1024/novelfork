import { Buffer } from "node:buffer";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { buildNovelForkIco, encodeRgbaPng, NOVELFORK_ICO_SIZES, renderNovelForkIcon } from "./desktop-icon";

function pixel(rgba: Uint8Array, size: number, x: number, y: number): number[] {
  const offset = (y * size + x) * 4;
  return Array.from(rgba.subarray(offset, offset + 4));
}

describe("NovelFork desktop icon", () => {
  it("draws a white N on the brand blue with transparent rounded corners", () => {
    const size = 64;
    const rgba = renderNovelForkIcon(size);
    expect(rgba).toHaveLength(size * size * 4);
    expect(pixel(rgba, size, 0, 0)[3]).toBe(0);
    expect(pixel(rgba, size, 32, 4)).toEqual([0x3b, 0x82, 0xf6, 255]);
    // 左竖笔中段
    expect(pixel(rgba, size, 21, 32)).toEqual([255, 255, 255, 255]);
    expect(renderNovelForkIcon(32)).toHaveLength(32 * 32 * 4);
    expect(() => renderNovelForkIcon(0)).toThrow(RangeError);
  });

  it("encodes a valid PNG", () => {
    const rgba = renderNovelForkIcon(16);
    const png = Buffer.from(encodeRgbaPng(16, rgba));
    expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(16);
    const idatLength = png.readUInt32BE(33);
    expect(png.toString("ascii", 37, 41)).toBe("IDAT");
    const raw = inflateSync(png.subarray(41, 41 + idatLength));
    expect(raw).toHaveLength((16 * 4 + 1) * 16);
    expect(Array.from(raw.subarray(1, 1 + 16 * 4))).toEqual(Array.from(rgba.subarray(0, 16 * 4)));
  });

  it("builds a multi-size ICO whose directory points at every image", () => {
    const ico = Buffer.from(buildNovelForkIco());
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(NOVELFORK_ICO_SIZES.length);
    NOVELFORK_ICO_SIZES.forEach((size, index) => {
      const entry = 6 + index * 16;
      expect(ico[entry]).toBe(size >= 256 ? 0 : size);
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      expect(offset + length).toBeLessThanOrEqual(ico.length);
      if (size >= 256) {
        expect(ico.readUInt32BE(offset)).toBe(0x89504e47);
      } else {
        expect(ico.readUInt32LE(offset)).toBe(40);
        expect(ico.readInt32LE(offset + 8)).toBe(size * 2);
        expect(length).toBe(40 + size * size * 4 + Math.ceil(size / 32) * 4 * size);
      }
    });
  });
});
