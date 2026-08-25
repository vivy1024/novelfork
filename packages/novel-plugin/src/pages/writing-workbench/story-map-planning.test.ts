import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NarrativeLineSnapshot } from "../../handlers/narrative-line-types";
import { hasPlanningNodes } from "./StoryMapCanvas";

// ---------------------------------------------------------------------------
// hasPlanningNodes —— 故事地图空态纪律的纯函数判定
// ---------------------------------------------------------------------------

function snapshotOf(types: Array<string>): NarrativeLineSnapshot {
  return {
    nodes: types.map((type, index) => ({
      id: `n-${index}`,
      title: `节点 ${index}`,
      type,
    })),
  } as unknown as NarrativeLineSnapshot;
}

describe("hasPlanningNodes", () => {
  it("纯章节快照没有规划节点", () => {
    expect(hasPlanningNodes(snapshotOf(["chapter", "chapter", "event"]))).toBe(false);
  });

  it("含冲突 / 伏笔 / 角色支线等规划节点时返回 true", () => {
    expect(hasPlanningNodes(snapshotOf(["chapter", "conflict"]))).toBe(true);
    expect(hasPlanningNodes(snapshotOf(["foreshadow"]))).toBe(true);
    expect(hasPlanningNodes(snapshotOf(["character-arc"]))).toBe(true);
    expect(hasPlanningNodes(snapshotOf(["payoff"]))).toBe(true);
    expect(hasPlanningNodes(snapshotOf(["setting"]))).toBe(true);
  });

  it("空快照与非法输入诚实返回 false", () => {
    expect(hasPlanningNodes(null)).toBe(false);
    expect(hasPlanningNodes(undefined)).toBe(false);
    expect(hasPlanningNodes({ nodes: [] } as unknown as NarrativeLineSnapshot)).toBe(false);
  });
});
