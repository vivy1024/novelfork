import { describe, expect, it } from "vitest";
import { buildMentionIndex, findMentionsInText } from "./EntityMentionExtension";

describe("findMentionsInText", () => {
  const index = buildMentionIndex([
    { name: "陈默", aliases: ["默哥"], entityType: "character" },
    { name: "陈砚秋", entityType: "character" },
    { name: "青云山", entityType: "location" },
    { name: "林", aliases: [] },
  ]);

  it("最长匹配优先，近名不互相截断", () => {
    const hits = findMentionsInText("陈砚秋看着陈默走上青云山。", index);
    expect(hits.map((hit) => [hit.entity.name, hit.start, hit.end])).toEqual([
      ["陈砚秋", 0, 3],
      ["陈默", 5, 7],
      ["青云山", 9, 12],
    ]);
  });

  it("别名归到规范名；单字称呼不高亮", () => {
    const hits = findMentionsInText("默哥说，林子里有人。", index);
    expect(hits.map((hit) => hit.entity.name)).toEqual(["陈默"]);
  });

  it("没有名单或没有提及时返回空", () => {
    expect(findMentionsInText("风从窗外吹进来。", index)).toEqual([]);
    expect(findMentionsInText("陈默", buildMentionIndex([]))).toEqual([]);
  });
});
