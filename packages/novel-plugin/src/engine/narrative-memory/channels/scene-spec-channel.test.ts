import { describe, expect, it } from "vitest";

import type { SceneSpec } from "../../../handlers/scene-spec-handler.js";
import { createSceneSpecChannel } from "./scene-spec-channel.js";

const sceneSpec: SceneSpec = {
  chapter: 12,
  title: "小瓶风波",
  wordTarget: 3200,
  scenes: [
    {
      characters: ["韩立"],
      location: "七玄门药园",
      conflict: "隐藏小瓶能力",
      mood: "紧张→克制",
      outcome: "暂时守住秘密",
      hooks_used: ["墨大夫试探"],
      hooks_planted: ["小瓶异动"],
    },
  ],
  constraints: ["不得暴露小瓶真实能力"],
};

describe("scene-spec channel", () => {
  it("returns stable scene-spec cards with constraints in hard channel", async () => {
    const channel = createSceneSpecChannel();

    const result = await channel.run({ bookId: "book-1", sceneSpec });

    expect(result.cards.map((card) => card.id)).toEqual([
      "scene-spec:book-1:12:constraints",
      "scene-spec:book-1:12:plan",
    ]);
    expect(result.cards[0]?.channel).toBe("hard");
    expect(result.cards[0]?.priority).toBe(100);
    expect(result.cards[1]?.sourceType).toBe("scene-spec");
    expect(result.cards.every((card) => card.reason.length > 0)).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("skips when no SceneSpec is provided", async () => {
    const channel = createSceneSpecChannel();

    const result = await channel.run({ bookId: "book-1" });

    expect(result.status).toBe("skipped");
    expect(result.cards).toEqual([]);
    expect(result.warnings?.[0]).toContain("SceneSpec");
  });
});
