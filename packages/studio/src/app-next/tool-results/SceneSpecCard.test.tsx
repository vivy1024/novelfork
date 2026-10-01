import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SceneSpecCard } from "./SceneSpecCard";

afterEach(() => cleanup());

describe("写作蓝图卡", () => {
  it("显示场景留白的类别、缺口与真实答案", () => {
    render(SceneSpecCard({
      toolName: "scene.spec",
      result: {
        renderer: "scene.spec",
        data: {
          sceneSpec: {
            chapter: 13,
            scenes: [
              {
                characters: ["薛行之", "沈遥"],
                location: "擂台边",
                conflict: "守擂失利",
                mood: "压抑→释然",
                outcome: "让位后起风",
                hooks_used: [],
                hooks_planted: [],
                gaps: [
                  { kind: "motivation", gap: "沈遥为什么第一次替他包扎", answer: "她看见他把断剑收进袖里藏住了" },
                  { kind: "pacing", gap: "失利后没有立刻喘一口气", answer: "让拍卖会的请柬先落进来" },
                ],
              },
            ],
          },
        },
      },
    }));

    const gaps = screen.getByTestId("scene-spec-gaps-0");
    expect(gaps.textContent).toContain("动机");
    expect(gaps.textContent).toContain("沈遥为什么第一次替他包扎");
    expect(gaps.textContent).toContain("她看见他把断剑收进袖里藏住了");
    expect(gaps.textContent).toContain("节奏");
    expect(gaps.textContent).toContain("让拍卖会的请柬先落进来");
  });

  it("没有留白的场景照旧渲染，不留空位", () => {
    render(SceneSpecCard({
      toolName: "scene.spec",
      result: {
        renderer: "scene.spec",
        data: { sceneSpec: { chapter: 1, scenes: [{ characters: ["甲"], location: "屋", conflict: "x", mood: "", outcome: "y" }] } },
      },
    }));
    expect(screen.queryByTestId("scene-spec-gaps-0")).toBeNull();
  });
});
