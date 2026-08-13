import { describe, expect, it } from "vitest";

import { debtOf, matchHookEvidence, type ParsedForeshadowing } from "./ForeshadowingBoard";
import { FORESHADOWING_DEBT_THRESHOLD } from "../../engine/jingwei/foreshadowing-debt";
import type { EntityFact } from "./narrative-fact-edits";

function entry(patch: Partial<ParsedForeshadowing> = {}): ParsedForeshadowing {
  return {
    id: "fs-1",
    name: "断剑之谜",
    description: "",
    status: "已埋设",
    plantedChapter: 10,
    targetChapter: 0,
    ...patch,
  };
}

describe("ForeshadowingBoard 债务判定", () => {
  it("传入真实章号后悬念为正数并能触发超期", () => {
    const debt = debtOf(entry({ plantedChapter: 10 }), 10 + FORESHADOWING_DEBT_THRESHOLD + 1);
    expect(debt.suspenseChapters).toBe(FORESHADOWING_DEBT_THRESHOLD + 1);
    expect(debt.level).toBe("overdue");
  });

  it("回归：不再因为默认 currentChapter=1 把 plantedChapter>1 算成负数", () => {
    // 修复前：currentChapter 恒为 1，plantedChapter=10 → 悬念 -9，永不超期。
    const stale = debtOf(entry({ plantedChapter: 10 }), 1);
    expect(stale.suspenseChapters).toBe(0);
    expect(stale.suspenseChapters).not.toBeLessThan(0);

    const real = debtOf(entry({ plantedChapter: 10 }), 90);
    expect(real.level).toBe("overdue");
  });

  it("拿不到章号时表现为未知，不是 0 章也不是超期", () => {
    const debt = debtOf(entry(), undefined);
    expect(debt.level).toBe("unknown");
    expect(debt.suspenseChapters).toBeNull();
    expect(debt.explanation).toContain("读不到本书当前章号");
  });

  it("阈值边界：正好等于阈值只提示临近，多一章才超期", () => {
    const at = debtOf(entry({ plantedChapter: 1 }), 1 + FORESHADOWING_DEBT_THRESHOLD);
    expect(at.level).toBe("due-soon");
    const over = debtOf(entry({ plantedChapter: 1 }), 2 + FORESHADOWING_DEBT_THRESHOLD);
    expect(over.level).toBe("overdue");
  });

  it("已回收/已废弃列的伏笔不计债", () => {
    for (const status of ["已回收", "已废弃"] as const) {
      expect(debtOf(entry({ status, plantedChapter: 1 }), 500).level).toBe("settled");
    }
  });

  it("部分揭示仍在计债（只是推进过，不等于回收）", () => {
    const debt = debtOf(entry({ status: "部分揭示", plantedChapter: 1 }), 500);
    expect(debt.level).toBe("overdue");
  });
});

describe("matchHookEvidence", () => {
  const facts: EntityFact[] = [
    { id: "f1", subject: "主角", predicate: "埋设", object: "断剑之谜的残片", category: "hook", sourceChapter: 10 },
    { id: "f2", subject: "配角", predicate: "提及", object: "别的钩子", category: "hook", sourceChapter: 12 },
    { id: "f3", subject: "主角", predicate: "关系", object: "断剑之谜", category: "relationship", sourceChapter: 11 },
  ];

  it("只取 hook 类别，且按伏笔名匹配到证据", () => {
    const matched = matchHookEvidence(entry({ name: "断剑之谜" }), facts);
    expect(matched.map((fact) => fact.id)).toEqual(["f1"]);
  });

  it("未命名伏笔不做模糊匹配，避免挂错证据", () => {
    expect(matchHookEvidence(entry({ name: "未命名伏笔" }), facts)).toHaveLength(0);
    expect(matchHookEvidence(entry({ name: "   " }), facts)).toHaveLength(0);
  });

  it("没有对应证据时返回空数组而非报错", () => {
    expect(matchHookEvidence(entry({ name: "完全不相干的伏笔" }), facts)).toHaveLength(0);
  });
});
