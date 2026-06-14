import { describe, it, expect } from "vitest";
import { buildLengthSpec, countChapterLength, chooseNormalizeMode, isOutsideHardRange } from "@vivy1024/novelfork-core";

/**
 * P0-1 长度治理门控契约测试。
 *
 * 锁定 pipeline-write-service.ts 中长度治理的触发条件：
 *   isOutsideHardRange(count, spec) && chooseNormalizeMode(count, spec) !== "none"
 *
 * 这不是 executePipelineWrite 的全集成测试（agent 内部 new，依赖 storage/StateManager），
 * 而是验证管线所依赖的核心判定函数在四种长度情形下的行为契约。
 * 归一化执行与 warning 生成由 core 的 length-normalizer.test.ts 覆盖。
 */
describe("length governance gate (P0-1 wiring contract)", () => {
  const spec = buildLengthSpec(2200); // soft ±300, hard ±600 → soft 1900-2500, hard 1600-2800

  function gateTriggers(count: number): boolean {
    return isOutsideHardRange(count, spec) && chooseNormalizeMode(count, spec) !== "none";
  }

  it("正常长度（区间内）不触发归一化", () => {
    expect(gateTriggers(2200)).toBe(false); // target
    expect(gateTriggers(2000)).toBe(false); // soft 内
    expect(gateTriggers(2700)).toBe(false); // 超 soft 但在 hard 内 → 不触发（避免过度改写）
  });

  it("严重超长（超 hard 上界）触发 compress", () => {
    const count = 3500;
    expect(gateTriggers(count)).toBe(true);
    expect(chooseNormalizeMode(count, spec)).toBe("compress");
  });

  it("严重不足（低于 hard 下界）触发 expand", () => {
    const count = 1000;
    expect(gateTriggers(count)).toBe(true);
    expect(chooseNormalizeMode(count, spec)).toBe("expand");
  });

  it("countChapterLength 中文按字符（去空白）", () => {
    const zh = "这是一段中文正文。\n\n包含换行和  空格。";
    const n = countChapterLength(zh, spec.countingMode);
    // 去掉所有空白后的字符数
    expect(n).toBe(zh.replace(/\s+/g, "").length);
  });

  it("isOutsideHardRange 蕴含 chooseNormalizeMode !== none（门控简化的正确性）", () => {
    // 超 hard 必然超 soft，所以 chooseNormalizeMode 永不返回 none
    for (const c of [0, 500, 1599, 2801, 5000]) {
      if (isOutsideHardRange(c, spec)) {
        expect(chooseNormalizeMode(c, spec)).not.toBe("none");
      }
    }
  });
});
