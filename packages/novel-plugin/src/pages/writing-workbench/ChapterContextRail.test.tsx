import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ChapterContextRail, selectDueForeshadowings } from "./ChapterContextRail";

const refetch = vi.fn(async () => undefined);

vi.mock("@/hooks/use-api", () => ({
  useApi: (path: string | null) => {
    if (path?.includes("category=characters")) {
      return {
        data: {
          entries: [
            {
              id: "char-1",
              title: "林舟",
              lifecycle: "active",
              fields: { core_motive: "求真", core_fear: "失去同伴", injury: "左臂旧伤" },
            },
            { id: "char-2", title: "沈砚", lifecycle: "archived", fields: {} },
          ],
        },
        loading: false,
        error: null,
        refetch,
      };
    }
    if (path?.includes("category=foreshadowing")) {
      return {
        data: {
          entries: [
            { id: "fs-1", title: "青铜戒指之谜", fields: { status: "已埋设", plantedChapter: 5 } },
            { id: "fs-2", title: "已回收伏笔", fields: { status: "已回收", plantedChapter: 1 } },
          ],
        },
        loading: false,
        error: null,
        refetch,
      };
    }
    return {
      data: { items: [{ chapterNumber: 10, wordCount: 1234 }] },
      loading: false,
      error: null,
      refetch,
    };
  },
}));

afterEach(() => cleanup());

describe("ChapterContextRail", () => {
  it("按当前章节展示字数、角色内核与到期伏笔，并支持打开角色卡", () => {
    const onOpenJingweiEntry = vi.fn(() => true);
    render(
      <ChapterContextRail
        bookId="book-1"
        chapterNumber={10}
        onOpenJingweiEntry={onOpenJingweiEntry}
      />,
    );

    expect(screen.getByTestId("chapter-context-rail")).toBeTruthy();
    expect(screen.getByText("第 10 章")).toBeTruthy();
    expect(screen.getByText("1,234 字")).toBeTruthy();
    expect(screen.getByRole("button", { name: "打开角色 林舟" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "打开角色 沈砚" })).toBeNull();
    expect(screen.getByText("青铜戒指之谜")).toBeTruthy();
    expect(screen.getByText("⚠️ 青铜戒指之谜（第5章埋设，已5章未推进）")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "打开角色 林舟" }));
    expect(onOpenJingweiEntry).toHaveBeenCalledWith("char-1");
  });

  it("独立计算三章以上未推进且排除已结清状态", () => {
    const due = selectDueForeshadowings([
      { id: "a", title: "旧谜", fields: { status: "已埋设", plantedChapter: 1 } },
      { id: "b", title: "已回收", fields: { status: "已回收", plantedChapter: 1 } },
    ], 5);

    expect(due).toEqual([
      { id: "a", name: "旧谜", plantedChapter: 1, suspenseChapters: 4 },
    ]);
  });
});
