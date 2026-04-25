import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fetchJsonMock = vi.fn();
const postApiMock = vi.fn();
const refetchSectionsMock = vi.fn();

interface JingweiSectionView {
  id: string;
  bookId: string;
  key: string;
  name: string;
  description: string;
  icon: string | null;
  order: number;
  enabled: boolean;
  showInSidebar: boolean;
  participatesInAi: boolean;
  defaultVisibility: "tracked" | "global" | "nested";
  fieldsJson: Array<{ id: string; key: string; label: string; type: string; required: boolean; participatesInSummary?: boolean; helpText?: string }>;
  builtinKind: string | null;
  sourceTemplate: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

let sectionsMock: JingweiSectionView[] = [];

function section(overrides: Partial<JingweiSectionView>): JingweiSectionView {
  return {
    id: "sec-people",
    bookId: "book-1",
    key: "people",
    name: "人物",
    description: "记录人物关系和阶段变化。",
    icon: null,
    order: 0,
    enabled: true,
    showInSidebar: true,
    participatesInAi: true,
    defaultVisibility: "tracked",
    fieldsJson: [],
    builtinKind: "people",
    sourceTemplate: "basic",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

vi.mock("../hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
  postApi: (...args: unknown[]) => postApiMock(...args),
  useApi: (url: string) => {
    if (url === "/books/book-1") {
      return { data: { book: { id: "book-1", title: "凡人修仙录" }, nextChapter: 5 }, loading: false, error: null, refetch: vi.fn() };
    }
    if (url === "/books/book-1/jingwei/sections") {
      return { data: { sections: sectionsMock }, loading: false, error: null, refetch: refetchSectionsMock };
    }
    if (url.startsWith("/books/book-1/bible/") || url === "/questionnaires") {
      return { data: {}, loading: false, error: null, refetch: vi.fn() };
    }
    return { data: undefined, loading: false, error: null, refetch: vi.fn() };
  },
}));

vi.mock("../lib/notify", () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { BibleView } from "./BibleView";

describe("BibleView user-visible naming", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    postApiMock.mockReset();
    refetchSectionsMock.mockReset();
    sectionsMock = [];
  });

  afterEach(() => cleanup());

  it("uses 故事经纬 / 经纬 as the visible product naming instead of Bible", () => {
    render(<BibleView bookId="book-1" nav={{ toDashboard: vi.fn(), toBook: vi.fn() }} />);

    expect(screen.getAllByText("故事经纬").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("经纬栏目")).toBeTruthy();
    expect(screen.getByText("经纬模式")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bBible\b|Novel Bible|Bible Tabs|bible_mode/);
  });

  it("renders editable jingwei section tabs from the section API", () => {
    sectionsMock = [
      section({ id: "sec-people", key: "people", name: "人物", order: 0 }),
      section({ id: "sec-events", key: "events", name: "事件", order: 1, builtinKind: "events" }),
      section({ id: "sec-hidden", key: "hidden", name: "隐藏栏目", order: 2, enabled: false }),
    ];

    render(<BibleView bookId="book-1" nav={{ toDashboard: vi.fn(), toBook: vi.fn() }} />);

    expect(screen.getByRole("button", { name: "管理栏目" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /人物/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /事件/ })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /隐藏栏目/ })).toBeNull();
  });

  it("creates a custom section from the section manager", async () => {
    sectionsMock = [section({ id: "sec-people" })];
    postApiMock.mockResolvedValueOnce({ section: section({ id: "sec-factions", key: "factions", name: "势力" }) });

    render(<BibleView bookId="book-1" nav={{ toDashboard: vi.fn(), toBook: vi.fn() }} />);

    fireEvent.click(screen.getByRole("button", { name: "管理栏目" }));
    fireEvent.click(screen.getByRole("button", { name: "新增栏目" }));
    fireEvent.change(screen.getByLabelText("栏目名"), { target: { value: "势力" } });
    fireEvent.change(screen.getByLabelText("栏目 key"), { target: { value: "factions" } });
    fireEvent.change(screen.getByLabelText("栏目说明"), { target: { value: "记录宗门、家族与组织利益。" } });
    fireEvent.click(screen.getByRole("button", { name: "保存栏目" }));

    await waitFor(() => {
      expect(postApiMock).toHaveBeenCalledWith("/books/book-1/jingwei/sections", expect.objectContaining({
        key: "factions",
        name: "势力",
        description: "记录宗门、家族与组织利益。",
        enabled: true,
        participatesInAi: true,
        defaultVisibility: "tracked",
      }));
    });
    expect(refetchSectionsMock).toHaveBeenCalledTimes(1);
  });

  it("updates section name, switches, order and field definitions", async () => {
    sectionsMock = [section({ id: "sec-people", fieldsJson: [] })];
    fetchJsonMock.mockResolvedValueOnce({ section: section({ id: "sec-people", name: "主要人物" }) });

    render(<BibleView bookId="book-1" nav={{ toDashboard: vi.fn(), toBook: vi.fn() }} />);

    fireEvent.click(screen.getByRole("button", { name: "管理栏目" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑 人物" }));
    fireEvent.change(screen.getByLabelText("栏目名"), { target: { value: "主要人物" } });
    fireEvent.change(screen.getByLabelText("排序"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("switch", { name: "启用栏目" }));
    fireEvent.click(screen.getByRole("switch", { name: "参与 AI 上下文" }));
    fireEvent.click(screen.getByRole("button", { name: "新增字段" }));
    fireEvent.change(screen.getByLabelText("字段标签"), { target: { value: "阶段" } });
    fireEvent.change(screen.getByLabelText("字段 key"), { target: { value: "stage" } });
    fireEvent.click(screen.getByRole("button", { name: "保存栏目" }));

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledWith("/books/book-1/jingwei/sections/sec-people", expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining('"name":"主要人物"'),
      }));
    });
    const [, init] = fetchJsonMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ name: "主要人物", order: 3, enabled: false, participatesInAi: false });
    expect(body.fieldsJson).toEqual([expect.objectContaining({ label: "阶段", key: "stage", type: "text" })]);
  });

  it("archives a section only after confirmation", async () => {
    sectionsMock = [section({ id: "sec-events", key: "events", name: "事件", builtinKind: "events" })];
    fetchJsonMock.mockResolvedValueOnce({ ok: true });

    render(<BibleView bookId="book-1" nav={{ toDashboard: vi.fn(), toBook: vi.fn() }} />);

    fireEvent.click(screen.getByRole("button", { name: "管理栏目" }));
    fireEvent.click(screen.getByRole("button", { name: "归档 事件" }));
    expect(screen.getByText(/归档后会保留栏目数据/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认归档" }));

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledWith("/books/book-1/jingwei/sections/sec-events", expect.objectContaining({ method: "DELETE" }));
    });
  });
});
