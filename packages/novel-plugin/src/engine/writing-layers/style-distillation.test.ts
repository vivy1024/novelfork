import { describe, expect, it } from "vitest";

import {
  MAX_STYLE_DISTILLATION_CHARS,
  normalizeStyleDistillationSource,
  StyleDistillationError,
} from "./style-distillation.js";

function capture(task: () => unknown): unknown {
  try {
    task();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("文风蒸馏来源正文的长度上限（T-07）", () => {
  it("超过 200 万字的正文报「参考正文过长」，不再误报成章节分割规则无效", () => {
    const error = capture(() => normalizeStyleDistillationSource({
      sourceName: "超长参考",
      text: `第一章 起\n${"字".repeat(2_000_001)}`,
    }));
    expect(error).toBeInstanceOf(StyleDistillationError);
    expect((error as StyleDistillationError).code).toBe("STYLE_DISTILLATION_TOO_LARGE");
    expect((error as Error).message).not.toContain("章节分割规则无效");
    expect((error as Error).message).toContain(String(MAX_STYLE_DISTILLATION_CHARS));
  });

  it("介于蒸馏上限与切章上限之间的正文同样在切章前按蒸馏口径拒绝", () => {
    const error = capture(() => normalizeStyleDistillationSource({
      sourceName: "偏长参考",
      text: `第一章 起\n${"字".repeat(MAX_STYLE_DISTILLATION_CHARS + 10)}`,
      // 即使分章规则本身不合法，也应先报长度，不让人去改一条没问题的规则。
      splitPattern: "^(a|aa)+$",
    }));
    expect((error as StyleDistillationError).code).toBe("STYLE_DISTILLATION_TOO_LARGE");
    expect((error as Error).message).toContain(`参考正文最多支持 ${MAX_STYLE_DISTILLATION_CHARS} 字`);
  });

  it("对照：上限内的正文正常切章；分章规则不合法时仍报规则问题", () => {
    const text = `第一章 起\n${"雨落在伞上。".repeat(50)}\n第二章 承\n${"风吹过巷口。".repeat(50)}`;
    expect(normalizeStyleDistillationSource({ sourceName: "参考", text }).chapters).toHaveLength(2);
    const error = capture(() => normalizeStyleDistillationSource({ sourceName: "参考", text, splitPattern: "^(a|aa)+$" }));
    expect((error as StyleDistillationError).code).toBe("STYLE_DISTILLATION_INVALID_INPUT");
    expect((error as Error).message).toContain("章节分割规则无效");
  });
});
