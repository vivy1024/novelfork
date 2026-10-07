/**
 * ID 重映射的恶意键用例：JSON 列里的 "__proto__" 等键必须落成自有属性，
 * 导入后的列内容不变形，也不污染任何对象的原型。
 */
import { describe, expect, it } from "vitest";

import { IdRemapper } from "./remap.js";

function makeRemapper(): IdRemapper {
  return new IdRemapper("book-old-1234567", "book-new-7654321");
}

describe("IdRemapper JSON 键的原型安全", () => {
  it("__proto__ 键落成自有可枚举属性，不改写结果对象的原型", () => {
    const remapper = makeRemapper();
    const source = JSON.parse('{"__proto__":{"polluted":"残留"},"nested":{"__proto__":"仍保留"},"normal":"ok"}') as Record<string, unknown>;

    const out = remapper.remapJsonValue(source) as Record<string, unknown>;
    const nested = out.nested as Record<string, unknown>;

    expect(Object.hasOwn(out, "__proto__")).toBe(true);
    expect(out["__proto__"]).toEqual({ polluted: "残留" });
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.hasOwn(nested, "__proto__")).toBe(true);
    expect(nested["__proto__"]).toBe("仍保留");
    // 序列化不能丢键（旧实现里 __proto__ 会被静默吃掉）。
    expect(JSON.stringify(out)).toBe(JSON.stringify(source));
    // 没有污染任何其他对象。
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("constructor / prototype 等键也按自有属性保留", () => {
    const remapper = makeRemapper();
    const source = JSON.parse('{"constructor":{"x":1},"prototype":[1,2]}') as Record<string, unknown>;

    const out = remapper.remapJsonValue(source) as Record<string, unknown>;

    expect(Object.hasOwn(out, "constructor")).toBe(true);
    expect(out.constructor).toEqual({ x: 1 });
    expect(out.prototype).toEqual([1, 2]);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });

  it("JSON 文本整体改写后，__proto__ 键随其他引用改写一起原样存活", () => {
    const remapper = makeRemapper();
    const raw = '{"__proto__":{"polluted":"残留"},"章节":"book-old-1234567"}';

    const out = remapper.remapJsonText(raw);

    expect(out).toContain("book-new-7654321");
    const reparsed = JSON.parse(out) as Record<string, unknown>;
    expect(Object.hasOwn(reparsed, "__proto__")).toBe(true);
    expect(reparsed["__proto__"]).toEqual({ polluted: "残留" });
    expect(reparsed["章节"]).toBe("book-new-7654321");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("没有可改写内容时保留 JSON 原文排版", () => {
    const remapper = makeRemapper();
    const raw = '{\n  "__proto__": { "x": 1 },\n  "keep": "照原样"\n}';
    expect(remapper.remapJsonText(raw)).toBe(raw);
  });
});
