import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => mocks.fetchJson(...args),
}));

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
  items: [] as Array<{
    id: string;
    kind: string;
    title: string;
    category: string;
    reason: string;
    sourceRefs: Array<{ chapterNumber: number }>;
    confidence: number;
    createdAt: number;
  }>,
}));

import { fetchJson } from "@/hooks/use-api";
import { DissectDraftPanel } from "./DissectDraftPanel";

const SEED_ITEMS = [
  { id: "s1", kind: "character", title: "李安平", category: "characters", reason: "拆书抽出，关联到主角", sourceRefs: [{ chapterNumber: 1 }], confidence: 0.9, createdAt: 0 },
  { id: "s2", kind: "location", title: "中都", category: "locations", reason: "拆书抽出，出现地名", sourceRefs: [{ chapterNumber: 5 }], confidence: 0.8, createdAt: 0 },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.items = SEED_ITEMS.map((item) => ({ ...item }));
  mocks.fetchJson.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/jingwei/staging?limit=300")) {
      return { ok: true, count: mocks.items.length, total: mocks.items.length, items: [...mocks.items] };
    }
    if (url.includes("/decision") && init?.method === "POST") {
      const match = url.match(/staging\/([^/]+)\/decision/);
      const id = match?.[1];
      mocks.items = mocks.items.filter((item) => item.id !== id);
      return { ok: true };
    }
    return { ok: true };
  });
});

afterEach(() => cleanup());

describe("拆书草案面板（T4.2 综合发布）", () => {
  it("列出草案、显示抽取理由与来源章、按 kind 过滤", async () => {
    render(<DissectDraftPanel bookId="book-1" />);

    await waitFor(() => expect(screen.getByTestId("dissect-draft-list")).toBeTruthy());
    expect(screen.getByText("李安平")).toBeTruthy();
    expect(screen.getByText("中都")).toBeTruthy();
    expect(screen.getByText("拆书抽出，关联到主角")).toBeTruthy();
    expect(screen.getByText("拆书抽出，出现地名")).toBeTruthy();
    expect(screen.getByText("来源：第 1 章")).toBeTruthy();

    expect(screen.getByTestId("dissect-draft-kinds")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "地点" }));
    expect(screen.queryByText("李安平")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "全部" })[0]!);
    expect(screen.getByText("李安平")).toBeTruthy();
  });

  it("promote：调用正式 decision 通道并从列表移除、宿主收到刷新通知", async () => {
    const onChanged = vi.fn();
    render(<DissectDraftPanel bookId="book-1" onChanged={onChanged} />);

    await waitFor(() => screen.getByTestId("dissect-draft-promote-s1"));
    fireEvent.click(screen.getByTestId("dissect-draft-promote-s1"));

    await waitFor(() => {
      const promote = mocks.fetchJson.mock.calls.find(([url, init]) =>
        (url as string).includes("/jingwei/staging/s1/decision") && (init as RequestInit)?.method === "POST");
      if (!promote) throw new Error("还没见到 promote 的 POST");
      expect(JSON.parse((promote[1] as RequestInit).body as string)).toEqual({ stagingDecision: "promote" });
    });
    await waitFor(() => expect(screen.queryByText("李安平")).toBeNull());
    await waitFor(() => expect(screen.getByTestId("dissect-draft-note").textContent).toContain("已写入正式条目"));
    expect(onChanged).toHaveBeenCalled();
  });

  it("reject：同样走 decision 通道并从列表移除", async () => {
    render(<DissectDraftPanel bookId="book-1" />);
    await waitFor(() => screen.getByTestId("dissect-draft-reject-s1"));
    fireEvent.click(screen.getByTestId("dissect-draft-reject-s1"));

    await waitFor(() => {
      const reject = mocks.fetchJson.mock.calls.find(([url]) =>
        (url as string).includes("/jingwei/staging/s1/decision"));
      if (!reject) throw new Error("还没见到 reject 的 POST");
      expect(JSON.parse((reject[1] as RequestInit).body as string)).toEqual({ stagingDecision: "reject" });
    });
    await waitFor(() => expect(screen.getByTestId("dissect-draft-note").textContent).toContain("已废弃"));
  });

  it("空暂存区显示引导文案", async () => {
    mocks.items = [];
    render(<DissectDraftPanel bookId="book-1" />);
    await waitFor(() => expect(screen.getByTestId("dissect-draft-empty").textContent).toContain("没有待确认的拆书草案"));
  });
});
