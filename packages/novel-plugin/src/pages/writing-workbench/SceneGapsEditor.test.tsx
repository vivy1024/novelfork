import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { FakeApiRequestError, fetchJson } = vi.hoisted(() => {
  class FakeApiRequestError extends Error {
    constructor(message: string, readonly status?: number) { super(message); }
  }
  return { FakeApiRequestError, fetchJson: vi.fn() };
});

vi.mock("@/hooks/use-api", () => ({
  ApiRequestError: FakeApiRequestError,
  fetchJson: (...args: unknown[]) => fetchJson(...args),
}));

import { SceneGapsEditor, chapterScenesPath } from "./SceneGapsEditor";

const SCENE = {
  id: "scene:book-1:a",
  ordinal: 1,
  title: "客栈",
  conflict: "仇人当面",
  updatedAt: 100,
  gaps: [{ kind: "motivation", gap: "他为何不拔刀", answer: "仇人身边站着他师妹" }],
};

afterEach(() => { cleanup(); fetchJson.mockReset(); });

describe("SceneGapsEditor", () => {
  it("读本章场景并列出已有留白", async () => {
    fetchJson.mockResolvedValueOnce({ scenes: [SCENE] });
    render(<SceneGapsEditor bookId="book-1" chapterNumber={4} />);
    expect(fetchJson).toHaveBeenCalledWith(chapterScenesPath("book-1", 4));
    expect(await screen.findByDisplayValue("他为何不拔刀")).toBeTruthy();
    expect(screen.getByDisplayValue("仇人身边站着他师妹")).toBeTruthy();
  });

  it("增、改、删后带 updatedAt 整组保存；未填完的条目标出来", async () => {
    fetchJson.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(init.body as string);
        return { ok: true, summary: "已保存。", data: { ...SCENE, updatedAt: 101, gaps: body.gaps.filter((gap: { gap: string; answer: string }) => gap.gap && gap.answer) } };
      }
      return { scenes: [SCENE] };
    });
    render(<SceneGapsEditor bookId="book-1" chapterNumber={4} />);
    await screen.findByDisplayValue("他为何不拔刀");

    fireEvent.change(screen.getByLabelText("第 1 场「客栈」留白 1 的真实答案"), { target: { value: "怕误伤师妹" } });
    fireEvent.click(screen.getByRole("button", { name: /加一条留白/ }));
    expect(screen.getByText(/空着的这条保存时不会存下/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("第 1 场「客栈」留白 2 的缺口"), { target: { value: "对峙写多长" } });
    fireEvent.change(screen.getByLabelText("第 1 场「客栈」留白 2 的真实答案"), { target: { value: "三句话" } });

    fireEvent.click(screen.getByRole("button", { name: /^保存/ }));
    expect(await screen.findByText(/叙述者下次写这一章时会读到/)).toBeTruthy();
    const put = fetchJson.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT")!;
    expect(put[0]).toBe("/api/books/book-1/narrative-memory/scenes/scene%3Abook-1%3Aa/gaps");
    expect(JSON.parse((put[1] as RequestInit).body as string)).toEqual({
      expectedUpdatedAt: 100,
      gaps: [
        { kind: "motivation", gap: "他为何不拔刀", answer: "怕误伤师妹" },
        { kind: "motivation", gap: "对峙写多长", answer: "三句话" },
      ],
    });

    fireEvent.click(screen.getByLabelText("删除第 1 场「客栈」留白 1"));
    expect(screen.queryByDisplayValue("他为何不拔刀")).toBeNull();
  });

  it("被别处改过（409）时提示重新载入，不显示保存成功", async () => {
    fetchJson.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === "PUT") throw new FakeApiRequestError("conflict", 409);
      return { scenes: [SCENE] };
    });
    render(<SceneGapsEditor bookId="book-1" chapterNumber={4} />);
    await screen.findByDisplayValue("他为何不拔刀");
    fireEvent.change(screen.getByLabelText("第 1 场「客栈」留白 1 的缺口"), { target: { value: "改了" } });
    fireEvent.click(screen.getByRole("button", { name: /^保存/ }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("重新载入");
  });

  it("本章还没有场景时可以手建一场", async () => {
    fetchJson.mockResolvedValueOnce({ scenes: [] }).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ scenes: [{ ...SCENE, gaps: [] }] });
    render(<SceneGapsEditor bookId="book-1" chapterNumber={4} />);
    fireEvent.click(await screen.findByRole("button", { name: /新建一场/ }));
    await waitFor(() => expect(screen.getByText("这一场还没有留白。")).toBeTruthy());
    expect(fetchJson.mock.calls[1]![0]).toBe("/api/books/book-1/narrative-memory/scenes");
  });
});
