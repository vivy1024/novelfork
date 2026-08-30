import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchJsonMock = vi.hoisted(() => vi.fn());
const invalidateMock = vi.hoisted(() => vi.fn());
const refetch = vi.hoisted(() => vi.fn(async () => undefined));
let compassEntries: Array<{
  id: string;
  category: string;
  title: string;
  fields?: Record<string, unknown>;
  updatedAt?: string;
}> = [];

const apiState = vi.hoisted(() => ({
  data: { entries: [] as Array<{ id: string; category: string; title: string; fields?: Record<string, unknown>; updatedAt?: string }> },
  loading: false,
  error: null as string | null,
  refetch,
}));

vi.mock("@/hooks/use-api", () => ({
  fetchJson: fetchJsonMock,
  invalidateApiPaths: invalidateMock,
  useApi: () => apiState,
}));

import { CreativeCompassPanel, pickCurrentFocusEntry } from "./CreativeCompassPanel";

beforeEach(() => {
  fetchJsonMock.mockReset();
  invalidateMock.mockReset();
  compassEntries = [];
  apiState.data = { entries: compassEntries };
  apiState.loading = false;
  apiState.error = null;
  fetchJsonMock.mockResolvedValue({ entry: { id: "focus-1" } });
});

afterEach(() => cleanup());

describe("CreativeCompassPanel", () => {
  it("空态渲染四字段，输入后防抖 POST 落盘经纬 current-focus", async () => {
    render(<CreativeCompassPanel bookId="book-1" />);
    expect(screen.getByTestId("creative-compass")).toBeTruthy();
    fireEvent.change(screen.getByTestId("creative-compass-goal"), {
      target: { value: "让林舟通过守门人试炼" },
    });
    await waitFor(() => expect(fetchJsonMock).toHaveBeenCalled(), { timeout: 2000 });
    const [url, init] = fetchJsonMock.mock.calls[0] as [string, { method?: string; body?: string }];
    expect(url).toContain("/jingwei/entries");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as { category: string; fields: { goal: string } };
    expect(body.category).toBe("current-focus");
    expect(body.fields.goal).toBe("让林舟通过守门人试炼");
  });

  it("已有条目时把四字段填回，填入本章指示回调 goal", () => {
    compassEntries = [{
      id: "focus-1",
      category: "current-focus",
      title: "创作罗盘",
      fields: { goal: "试炼过关", mustKeep: "旧伤", mustAvoid: "揭底", notes: "备忘" },
      updatedAt: "2026-08-01",
    }];
    apiState.data = { entries: compassEntries };
    const onFillDirective = vi.fn();
    render(<CreativeCompassPanel bookId="book-1" onFillDirective={onFillDirective} />);
    expect((screen.getByTestId("creative-compass-goal") as HTMLTextAreaElement).value).toBe("试炼过关");
    expect((screen.getByTestId("creative-compass-mustKeep") as HTMLTextAreaElement).value).toBe("旧伤");
    fireEvent.click(screen.getByTestId("creative-compass-fill-directive"));
    expect(onFillDirective).toHaveBeenCalledWith("试炼过关");
  });

  it("pickCurrentFocusEntry 忽略大纲条目", () => {
    expect(pickCurrentFocusEntry([
      { id: "o", category: "outline", title: "卷一" },
      { id: "f", category: "current-focus", title: "创作罗盘" },
    ])?.id).toBe("f");
  });
});
