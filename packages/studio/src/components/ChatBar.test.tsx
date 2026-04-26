import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useApiMock = vi.fn();
const fetchJsonMock = vi.fn();
const postApiMock = vi.fn();

vi.mock("../hooks/use-api", () => ({
  useApi: (...args: unknown[]) => useApiMock(...args),
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
  postApi: (...args: unknown[]) => postApiMock(...args),
}));

import { ChatPanel } from "./ChatBar";

const t = (key: string) => {
  const map: Record<string, string> = {
    "dash.writeNext": "写下一章",
    "book.audit": "审计",
    "book.export": "导出",
    "nav.radar": "雷达",
    "nav.connected": "已连接",
    "common.enterCommand": "输入命令",
  };
  return map[key] ?? key;
};

describe("ChatPanel AI gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
    useApiMock.mockImplementation((path: string) => {
      if (path === "/providers/status") {
        return {
          data: { status: { hasUsableModel: false } },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return { data: null, loading: false, error: null, refetch: vi.fn() };
    });
  });

  afterEach(() => cleanup());

  it("blocks direct write-next commands without clearing the pending input", async () => {
    fetchJsonMock.mockResolvedValueOnce({ books: [{ id: "book-1" }] });

    render(
      <ChatPanel
        open
        onClose={vi.fn()}
        onConfigureModel={vi.fn()}
        t={t as never}
        sse={{ messages: [], connected: true }}
        activeBookId="book-1"
      />,
    );

    fireEvent.change(screen.getByTestId("message-input"), { target: { value: "写下一章" } });
    fireEvent.click(screen.getByTestId("send-message-btn"));

    expect(await screen.findByText("此功能需要配置 AI 模型")).toBeTruthy();
    expect(screen.getByDisplayValue("写下一章")).toBeTruthy();
    expect(postApiMock).not.toHaveBeenCalledWith("/books/book-1/write-next", {});
  });

  it("blocks generic agent commands without clearing the pending input", async () => {
    render(
      <ChatPanel
        open
        onClose={vi.fn()}
        onConfigureModel={vi.fn()}
        t={t as never}
        sse={{ messages: [], connected: true }}
      />,
    );

    fireEvent.change(screen.getByTestId("message-input"), { target: { value: "帮我分析一下剧情" } });
    fireEvent.click(screen.getByTestId("send-message-btn"));

    expect(await screen.findByText("此功能需要配置 AI 模型")).toBeTruthy();
    expect(screen.getByDisplayValue("帮我分析一下剧情")).toBeTruthy();
    expect(fetchJsonMock).not.toHaveBeenCalledWith("/agent", expect.anything());
  });
});
