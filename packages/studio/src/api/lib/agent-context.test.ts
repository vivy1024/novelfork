import { describe, expect, it } from "vitest";

import { buildAgentContext } from "./agent-context";

const baseBook = { title: "灵潮纪元", genre: "玄幻", chapterCount: 5, targetChapters: 100 } as never;

describe("agent context with narrative line and jingwei", () => {
  it("injects narrative line nodes and warnings into context", () => {
    const context = buildAgentContext({
      bookId: "book-1",
      book: baseBook,
      narrativeLine: {
        nodes: [
          { id: "n1", label: "主角觉醒", type: "event" },
          { id: "n2", label: "宗门追杀", type: "conflict" },
        ],
        warnings: [{ message: "第三章与第五章时间线矛盾", severity: "high" }],
        openForeshadowing: [{ id: "f1", description: "神秘老者留下的玉简尚未解读" }],
      },
    });

    expect(context).toContain("叙事线状态");
    expect(context).toContain("[event] 主角觉醒");
    expect(context).toContain("[conflict] 宗门追杀");
    expect(context).toContain("未回收伏笔：1 个");
    expect(context).toContain("神秘老者留下的玉简");
    expect(context).toContain("时间线矛盾");
  });

  it("injects jingwei core settings into context", () => {
    const context = buildAgentContext({
      bookId: "book-1",
      book: baseBook,
      jingwei: {
        sections: [
          {
            name: "世界观",
            entries: [
              { key: "灵气体系", value: "灵潮周期性涨落，影响修炼速度" },
              { key: "势力格局", value: "三大宗门鼎立，散修联盟崛起" },
            ],
          },
          {
            name: "主角",
            entries: [
              { key: "姓名", value: "林远" },
              { key: "境界", value: "筑基后期" },
            ],
          },
        ],
      },
    });

    expect(context).toContain("经纬核心设定");
    expect(context).toContain("世界观");
    expect(context).toContain("灵气体系：灵潮周期性涨落");
    expect(context).toContain("主角");
    expect(context).toContain("姓名：林远");
  });

  it("includes both narrative line and jingwei when both provided", () => {
    const context = buildAgentContext({
      bookId: "book-1",
      book: baseBook,
      narrativeLine: { nodes: [{ id: "n1", label: "开篇", type: "start" }] },
      jingwei: { sections: [{ name: "设定", entries: [{ key: "时代", value: "远古" }] }] },
    });

    expect(context).toContain("叙事线状态");
    expect(context).toContain("经纬核心设定");
  });

  it("returns base context when narrative/jingwei not provided", () => {
    const context = buildAgentContext({ bookId: "book-1", book: baseBook });

    expect(context).toContain("灵潮纪元");
    expect(context).not.toContain("叙事线状态");
    expect(context).not.toContain("经纬核心设定");
  });
});
