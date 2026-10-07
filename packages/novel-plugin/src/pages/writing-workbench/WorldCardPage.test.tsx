import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchJsonMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-api", () => ({
  fetchJson: fetchJsonMock,
  ApiRequestError: class ApiRequestError extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  },
}));
vi.mock("@tiptap/react", () => ({
  useEditor: (options?: { content?: string }) => {
    let content = options?.content ?? "";
    return {
      storage: { markdown: { getMarkdown: () => content } },
      getText: () => content,
      commands: { setContent: (next: string) => { content = next; } },
      setEditable: vi.fn(),
    };
  },
  EditorContent: () => null,
}));

import { WorldCardPage, isWorldCardCategory } from "./WorldCardPage";

const entry = {
  id: "loc-1",
  title: "青云宗",
  contentMd: "山门在北境",
  category: "locations",
  status: "confirmed",
  fields: { name: "青云宗" },
  visibility: "tracked" as const,
};

afterEach(() => {
  cleanup();
  fetchJsonMock.mockReset();
});

function stubApis() {
  fetchJsonMock.mockImplementation(async (url: string) => {
    if (url.includes("/revisions")) return { revisions: [] };
    if (url.includes("/jingwei/search")) return { results: [] };
    if (url.includes("/jingwei/entries")) return { entries: [] };
    return { groups: [], events: [], facts: [] };
  });
}

describe("WorldCardPage 档案式阅读 / 编辑切换", () => {
  it("已确认条目默认阅读态：标题是文本不是输入框，经纬面板只读", () => {
    stubApis();
    render(<WorldCardPage entry={entry} bookId="book-1" onSave={vi.fn(async () => undefined)} />);

    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
    expect(screen.getByRole("button", { name: "编辑" })).toBeTruthy();
    expect(screen.getByTestId("world-card-title-reading").textContent).toBe("青云宗");
    expect(screen.queryByPlaceholderText("地点名")).toBeNull();
    expect(screen.getByTestId("jingwei-canon-reading")).toBeTruthy();
    expect(screen.queryByLabelText("分类")).toBeNull();
  });

  it("draft（未确认）条目打开即编辑态", () => {
    stubApis();
    render(<WorldCardPage entry={{ ...entry, status: "draft" }} bookId="book-1" onSave={vi.fn(async () => undefined)} />);

    expect(screen.getByLabelText("分类")).toBeTruthy();
    expect(screen.getByPlaceholderText("地点名")).toBeTruthy();
    expect(screen.queryByTestId("world-card-title-reading")).toBeNull();
  });

  it("取消编辑：有改动需确认放弃且回写原文", () => {
    stubApis();
    const onSave = vi.fn(async () => undefined);
    render(<WorldCardPage entry={entry} bookId="book-1" onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByPlaceholderText("地点名"), { target: { value: "改名青云宗" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByText("放弃未保存的修改？")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "放弃" }));
    expect(screen.getByRole("button", { name: "编辑" })).toBeTruthy();
    expect(screen.getByTestId("world-card-title-reading").textContent).toBe("青云宗");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("保存成功后回到阅读态", async () => {
    stubApis();
    const onSave = vi.fn(async () => undefined);
    render(<WorldCardPage entry={entry} bookId="book-1" onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByPlaceholderText("地点名"), { target: { value: "新山门" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith("loc-1", expect.objectContaining({ title: "新山门", contentMd: "山门在北境" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "编辑" })).toBeTruthy());
    expect(screen.getByTestId("world-card-title-reading").textContent).toBe("新山门");
  });
});

describe("isWorldCardCategory", () => {
  it("覆盖五类世界设定分类，角色与伏笔不走世界卡", () => {
    for (const category of ["world-model", "locations", "factions", "power-system", "props"]) {
      expect(isWorldCardCategory(category)).toBe(true);
    }
    expect(isWorldCardCategory("characters")).toBe(false);
    expect(isWorldCardCategory("foreshadowing")).toBe(false);
    expect(isWorldCardCategory(undefined)).toBe(false);
  });
});

describe("WorldCardPage 动态区（沿用原覆盖，动态数据与阅读态无关）", () => {
  const factionEntry = {
    id: "loc-1",
    title: "青云宗",
    contentMd: "",
    category: "factions",
    status: "confirmed",
  };

  it("渲染静态设定区 + 实体动态区（当前状态/发展历程/关联角色）", async () => {
    fetchJsonMock.mockImplementation(async (url: string) => {
      if (url.includes("/revisions")) return { revisions: [] };
      if (url.includes("/jingwei/search")) return { results: [] };
      if (url.includes("/jingwei/entries")) return { entries: [] };
      if (url.includes("facts/by-entity")) {
        return {
          groups: [
            { entity: "青云宗", facts: [
              { id: "fact-1", subject: "白起", predicate: "阵营", object: "青云宗内门", sourceChapter: 12 },
              { id: "fact-2", subject: "薛行之", predicate: "拜访", object: "青云宗主峰", evidenceText: "薛行之登上青云宗主峰求药。", sourceChapter: 13 },
            ] },
          ],
        };
      }
      if (url.includes("view=event_chain")) {
        return { events: [{ chapterNumber: 13, eventType: "faction_state_changed", evidenceText: "青云宗开放了藏经阁。" }] };
      }
      if (url.includes("view=relationship")) {
        return {
          facts: [{ subject: "青云宗", predicate: "敌对", object: "血魔教", sourceChapter: 11 }],
          events: [{ chapterNumber: 13, eventType: "relationship_changed", subject: "白起", predicate: "拜入", object: "青云宗" }],
        };
      }
      throw new Error(`unexpected request: ${url}`);
    });

    render(<WorldCardPage entry={factionEntry} bookId="book-1" onSave={vi.fn(async () => undefined)} />);

    // 阅读态标题文本 + 分类徽标 + 只读经纬面板
    expect(screen.getByTestId("world-card-title-reading").textContent).toBe("青云宗");
    expect(screen.getByTestId("jingwei-canon-panel")).toBeTruthy();
    expect(screen.getAllByText("势力").length).toBeGreaterThan(0);
    // 动态区：按 factions 关键词抽中的状态事实。
    await waitFor(() => expect(screen.getByText(/阵营：青云宗内门/)).toBeTruthy());
    // 发展历程最近事件。
    expect(screen.getByText("青云宗开放了藏经阁。")).toBeTruthy();
    // 关联角色来自关系图对端实体（去重后）。
    expect(screen.getByText("血魔教")).toBeTruthy();
    expect(screen.getByText("白起")).toBeTruthy();
    const memoryUrls = fetchJsonMock.mock.calls.map((call) => String(call[0])).filter((url) => url.includes("narrative-memory"));
    expect(memoryUrls.every((url) => url.includes("entryId=loc-1") || url.includes("focusEntryId=loc-1"))).toBe(true);
    expect(memoryUrls.some((url) => url.includes("focusEntity=") || url.includes("entity=%E9%9D%92"))).toBe(false);
  });

  it("三路动态数据全空时显示诚实空态，不误报故障", async () => {
    fetchJsonMock.mockImplementation(async (url: string) => {
      if (url.includes("/revisions")) return { revisions: [] };
      if (url.includes("/jingwei/search")) return { results: [] };
      if (url.includes("/jingwei/entries")) return { entries: [] };
      if (url.includes("facts/by-entity")) return { groups: [] };
      if (url.includes("/graph")) return {};
      throw new Error(`unexpected request: ${url}`);
    });

    render(<WorldCardPage entry={factionEntry} bookId="book-1" onSave={vi.fn(async () => undefined)} />);

    await waitFor(() => expect(screen.getByText(/该实体暂无章后结算记录/)).toBeTruthy());
    expect(screen.getByTestId("world-dynamics-empty")).toBeTruthy();
  });

  it("保存时把分类、层级、可见性、结构化字段一并写回", async () => {
    const onSave = vi.fn(async () => undefined);
    stubApis();
    render(<WorldCardPage
      entry={{
        ...factionEntry,
        contentMd: "宗门设定",
        layer: "canon",
        status: "confirmed",
        visibility: "global" as const,
        relatedEntryIds: ["c1"],
        fields: { type: "宗门", description: "西京第一大宗" },
      }}
      bookId="book-1"
      onSave={onSave}
      relatedEntries={[{ id: "c1", title: "薛行之" }]}
    />);

    expect(await screen.findByTestId("jingwei-canon-panel")).toBeTruthy();
    // 已确认条目默认阅读态：先点「编辑」，改一个字段后才可保存
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByPlaceholderText("势力名称"), { target: { value: "青云宗" } });
    fireEvent.change(screen.getByPlaceholderText("势力名称"), { target: { value: "青云宗总坛" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith("loc-1", expect.objectContaining({
      title: "青云宗总坛",
      contentMd: "宗门设定",
      category: "factions",
      layer: "canon",
      visibility: "global",
      relatedEntryIds: ["c1"],
      fields: expect.objectContaining({
        type: "宗门",
        description: "西京第一大宗",
        name: "青云宗总坛",
      }),
    }));
  });
});
