import { describe, expect, it } from "vitest";

import {
  scarEffectiveIntensity,
  isScarHealed,
  activeScars,
  classifyOOC,
  type Scar,
  type Motivation,
} from "./character-psychology.js";

const scar = (overrides: Partial<Scar> = {}): Scar => ({
  description: "父亲惨死",
  plantedChapter: 1,
  intensity: 8,
  sensitivityTags: ["父亲", "复仇"],
  ...overrides,
});

describe("scarEffectiveIntensity 遗忘衰减", () => {
  it("刚种下时无衰减", () => {
    expect(scarEffectiveIntensity(scar(), 1)).toBe(8);
  });

  it("经过一个半衰期后强度减半", () => {
    expect(scarEffectiveIntensity(scar(), 11)).toBe(4);
  });

  it("经过两个半衰期后再减半", () => {
    expect(scarEffectiveIntensity(scar(), 21)).toBe(2);
  });

  it("未提及章数越多衰减越大", () => {
    const near = scarEffectiveIntensity(scar(), 5);
    const far = scarEffectiveIntensity(scar(), 30);
    expect(far).toBeLessThan(near);
  });
});

describe("isScarHealed", () => {
  it("强度 < 2 视为愈合", () => {
    expect(isScarHealed(scar({ intensity: 3 }), 50)).toBe(true);
  });
  it("强度 ≥ 2 未愈合", () => {
    expect(isScarHealed(scar({ intensity: 8 }), 5)).toBe(false);
  });
});

describe("activeScars 过滤愈合疤痕", () => {
  it("只返回未愈合的 scar（近章高强度存活，远章低强度愈合）", () => {
    const scars = [
      scar({ description: "新伤", intensity: 10, plantedChapter: 35 }),
      scar({ description: "旧伤已淡", intensity: 2, plantedChapter: 1 }),
    ];
    const active = activeScars(scars, 40);
    expect(active).toHaveLength(1);
    expect(active[0]?.description).toBe("新伤");
  });
});

describe("classifyOOC 三分类", () => {
  const motivations: Motivation[] = [{ description: "复仇", priority: 5 }];

  it("有活跃 scar 被触发 → breakout（合理偏离）", () => {
    const result = classifyOOC({
      scars: [scar({ sensitivityTags: ["复仇", "杀父"] })],
      motivations,
      behaviorSummary: "他看到仇人，想起了父亲的死，心中燃起复仇之火",
      currentChapter: 10,
    });
    expect(result).toBe("breakout");
  });

  it("高执念驱动 → breakout（高光时刻）", () => {
    const result = classifyOOC({
      scars: [],
      motivations: [{ description: "不惜一切代价变强", priority: 9 }],
      behaviorSummary: "他强行突破境界",
      currentChapter: 10,
    });
    expect(result).toBe("breakout");
  });

  it("无心理支撑 → normal（纯函数不判 OOC，由调用方基于行为异常度决定）", () => {
    const result = classifyOOC({
      scars: [],
      motivations: [{ description: "安稳度日", priority: 3 }],
      behaviorSummary: "他突然屠戮满门",
      currentChapter: 10,
    });
    expect(result).toBe("normal");
  });

  it("正常行为（有中等执念但未触发 scar tag）→ normal", () => {
    const result = classifyOOC({
      scars: [],
      motivations: [{ description: "修炼突破", priority: 5 }],
      behaviorSummary: "他安静地打坐修炼",
      currentChapter: 10,
    });
    expect(result).toBe("normal");
  });
});
