import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChronicleEditorialTimeline, cleanEventNarrative } from "./ChronicleEditorialTimeline";

afterEach(() => cleanup());

describe("cleanEventNarrative 智能去重与可读化清洗", () => {
  it("去除连续重复谓词、重复主语与机器尾部孤立章号后缀", () => {
    expect(
      cleanEventNarrative({
        subject: "薛行之",
        predicate: "决定",
        object: "决定用修真炉压制灵潮异常 · 1",
      }),
    ).toEqual({
      subject: "薛行之",
      narrativeText: "决定用修真炉压制灵潮异常",
    });

    expect(
      cleanEventNarrative({
        subject: "薛行之",
        predicate: "薛行之接手",
        object: "西京异常档案",
      }),
    ).toEqual({
      subject: "薛行之",
      narrativeText: "接手 西京异常档案",
    });
  });
});

describe("ChronicleEditorialTimeline 书卷编年史时间线", () => {
  const sampleEvents = [
    {
      id: "ev-1",
      chapterNumber: 1,
      subject: "薛行之",
      subjectEntryId: "c1",
      predicate: "决定",
      object: "决定用修真炉压制西京分院灵潮异动 · 1",
      eventType: "character_state_changed",
      evidenceText: "薛行之合上卷宗，指节轻叩桌面：今夜就封炉。",
    },
    {
      id: "ev-2",
      chapterNumber: 1,
      subject: "薛行之",
      predicate: "联手",
      object: "方工秘密排查地脉裂隙",
      eventType: "relationship_changed",
    },
    {
      id: "ev-3",
      chapterNumber: 2,
      subject: "古铜镜",
      predicate: "浮现",
      object: "背面第三道星宿暗纹",
      eventType: "hook_planted",
      riskLevel: "high",
      evidenceText: "铜镜背面忽有微芒流转，第三道暗纹悄然浮起。",
    },
  ];

  const sampleEntries = [
    {
      id: "s1",
      category: "chapter-summaries",
      title: "第 1 章 封炉夜",
      summaryMd: "西京分院夜值突变，薛行之与方工首次联手。",
      fields: { chapterNumber: 1, storyTime: "景佑三年秋 · 戌时" },
    },
  ];

  it("完整展示清洗后的自然叙述句（不硬截断成省略号），支持点击卡片展开原文证据与查看原章", () => {
    const onOpenChapter = vi.fn();
    const onOpenEntry = vi.fn();
    render(
      <ChronicleEditorialTimeline
        events={sampleEvents}
        entries={sampleEntries}
        writtenChapters={[
          { number: 1, title: "第 1 章 封炉夜" },
          { number: 2, title: "第 2 章 镜纹" },
        ]}
        onOpenChapter={onOpenChapter}
        onOpenEntry={onOpenEntry}
      />,
    );

    // 章节锚点、标题与故事时间清晰展示
    expect(screen.getByTestId("chronicle-chapter-1").textContent).toContain("第 1 章");
    expect(screen.getByTestId("chronicle-chapter-1").textContent).toContain("封炉夜");
    expect(screen.getByTestId("chronicle-chapter-1").textContent).toContain("景佑三年秋 · 戌时");

    // 机器重复词 "决定 决定用... · 1" 已被清洗为干净完整的叙述句
    const card1 = screen.getByTestId("chronicle-event-ev-1");
    expect(card1.textContent).toContain("决定用修真炉压制西京分院灵潮异动");
    expect(card1.textContent).not.toContain("决定 决定");
    expect(card1.textContent).not.toContain("· 1");

    // 点击卡片展开原文证据引用块
    expect(screen.queryByTestId("chronicle-evidence-ev-1")).toBeNull();
    fireEvent.click(card1.firstElementChild!);
    expect(screen.getByTestId("chronicle-evidence-ev-1").textContent).toContain("今夜就封炉");

    // 点击人物胶囊打开人物卡
    fireEvent.click(screen.getByRole("button", { name: "薛行之" }));
    expect(onOpenEntry).toHaveBeenCalledWith("c1", "薛行之");

    // 点击右上角查看原章小图标按钮
    fireEvent.click(screen.getByTestId("chronicle-open-chapter-1"));
    expect(onOpenChapter).toHaveBeenCalledWith(1);
  });

  it("支持事件类型筛选、高频人物筛选、关键词搜索与全部章节折叠展开", () => {
    render(<ChronicleEditorialTimeline events={sampleEvents} />);

    // 切到「伏笔线索」只看第 2 章古铜镜事件
    fireEvent.click(screen.getByTestId("chronicle-filter-hook"));
    expect(screen.getByTestId("chronicle-event-ev-3")).toBeTruthy();
    expect(screen.queryByTestId("chronicle-event-ev-1")).toBeNull();

    // 切回全部，点高频人物「薛行之」
    fireEvent.click(screen.getByTestId("chronicle-filter-all"));
    fireEvent.click(screen.getByTestId("chronicle-char-薛行之"));
    expect(screen.getByTestId("chronicle-event-ev-1")).toBeTruthy();
    expect(screen.queryByTestId("chronicle-event-ev-3")).toBeNull();
    fireEvent.click(screen.getByTestId("chronicle-char-薛行之"));

    // 关键词搜索
    fireEvent.change(screen.getByLabelText("搜索发展历程"), { target: { value: "地脉裂隙" } });
    expect(screen.getByTestId("chronicle-event-ev-2")).toBeTruthy();
    expect(screen.queryByTestId("chronicle-event-ev-1")).toBeNull();
    fireEvent.click(screen.getByLabelText("清空发展历程搜索"));

    // 一键收起全部章节 / 展开全部章节
    fireEvent.click(screen.getByTestId("chronicle-toggle-all"));
    expect(screen.queryByTestId("chronicle-event-ev-1")).toBeNull();
    expect(screen.getAllByText(/已收起本章/).length).toBe(2);
    fireEvent.click(screen.getByTestId("chronicle-toggle-all"));
    expect(screen.getByTestId("chronicle-event-ev-1")).toBeTruthy();
  });

  it("没有任何事件与章摘要时渲染温润简洁空态", () => {
    render(<ChronicleEditorialTimeline events={[]} />);
    expect(screen.getByTestId("chronicle-empty").textContent).toContain("尚无编年纪事");
  });
});
