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
  useEditor: () => ({
    storage: { markdown: { getMarkdown: () => "宗门设定" } },
    getText: () => "宗门设定",
    commands: { setContent: vi.fn() },
  }),
  EditorContent: () => null,
}));

function isNarrativeMemoryUrl(url: string): boolean {
  return url.includes("narrative-memory");
}

function mockJingweiAndMemory(handler: (url: string) => unknown) {
  fetchJsonMock.mockImplementation(async (url: string) => {
    if (url.includes("/revisions")) return { revisions: [] };
    if (url.includes("/jingwei/search")) return { results: [] };
    if (url.includes("/jingwei/entries")) return { entries: [] };
    return handler(url);
  });
}

import { WorldCardPage, isWorldCardCategory } from "./WorldCardPage";

const entry = {
  id: "loc-1",
  title: "青云宗",
  contentMd: "",
  category: "factions",
};

afterEach(() => {
  cleanup();
  fetchJsonMock.mockReset();
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

describe("WorldCardPage", () => {
  it("渲染静态设定区 + 实体动态区（当前状态/发展历程/关联角色）", async () => {
    mockJingweiAndMemory((url) => {
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

    render(<WorldCardPage entry={entry} bookId="book-1" saving={false} onSave={vi.fn(async () => undefined)} />);

    // 静态区标题 + 分类徽标。
    expect(screen.getByDisplayValue("青云宗")).toBeTruthy();
    expect(screen.getByTestId("jingwei-canon-panel")).toBeTruthy();
    expect(screen.getByLabelText("分类")).toBeTruthy();
    expect(screen.getAllByText("势力").length).toBeGreaterThan(0);
    // 动态区：按 factions 关键词抽中的状态事实。
    await waitFor(() => expect(screen.getByText(/阵营：青云宗内门/)).toBeTruthy());
    // 发展历程最近事件。
    expect(screen.getByText("青云宗开放了藏经阁。")).toBeTruthy();
    // 关联角色来自关系图对端实体（去重后）。
    expect(screen.getByText("血魔教")).toBeTruthy();
    expect(screen.getByText("白起")).toBeTruthy();
    const memoryUrls = fetchJsonMock.mock.calls.map((call) => String(call[0])).filter(isNarrativeMemoryUrl);
    expect(memoryUrls.every((url) => url.includes("entryId=loc-1") || url.includes("focusEntryId=loc-1"))).toBe(true);
    expect(memoryUrls.some((url) => url.includes("focusEntity=") || url.includes("entity=%E9%9D%92"))).toBe(false);
  });

  it("三路动态数据全空时显示诚实空态，不误报故障", async () => {
    mockJingweiAndMemory((url) => {
      if (url.includes("facts/by-entity")) return { groups: [] };
      if (url.includes("/graph")) return {};
      throw new Error(`unexpected request: ${url}`);
    });

    render(<WorldCardPage entry={entry} bookId="book-1" saving={false} onSave={vi.fn(async () => undefined)} />);

    await waitFor(() => expect(screen.getByText(/该实体暂无章后结算记录/)).toBeTruthy());
    expect(screen.getByRole("button", { name: /保存/ }).hasAttribute("disabled")).toBe(false);
  });

  it("保存时把分类、层级、可见性、结构化字段一并写回", async () => {
    const onSave = vi.fn(async () => undefined);
    mockJingweiAndMemory(() => ({ groups: [], events: [], facts: [] }));
    render(<WorldCardPage
      entry={{
        ...entry,
        layer: "canon",
        status: "confirmed",
        visibility: "global",
        relatedEntryIds: ["c1"],
        fields: { type: "宗门", description: "西京第一大宗" },
      }}
      bookId="book-1"
      saving={false}
      onSave={onSave}
      relatedEntries={[{ id: "c1", title: "薛行之" }]}
    />);

    expect(await screen.findByTestId("jingwei-canon-panel")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /保存/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave).toHaveBeenCalledWith("loc-1", expect.objectContaining({
      title: "青云宗",
      contentMd: "宗门设定",
      category: "factions",
      layer: "canon",
      visibility: "global",
      relatedEntryIds: ["c1"],
      fields: expect.objectContaining({
        name: "青云宗",
        type: "宗门",
        description: "西京第一大宗",
      }),
    }));
  });
});
