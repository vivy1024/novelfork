import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchJsonMock = vi.fn();

vi.mock("../hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

vi.mock("./AutoCompressToggle", () => ({
  AutoCompressToggle: () => <div>AutoCompressToggle</div>,
}));

import { ContextPanel } from "./ContextPanel";

describe("ContextPanel", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    fetchJsonMock.mockImplementation(async (url: string) => {
      if (url === "/api/ai/context-assembly") {
        return {
          entries: [
            {
              id: "entry-1",
              source: "chapter_summaries",
              label: "章节摘要",
              content: "这是最近章节的摘要。",
              tokens: 4200,
              active: true,
            },
          ],
          totalTokens: 4200,
          budgetMax: 8000,
        };
      }

      if (url === "/api/context/book-demo/usage") {
        return {
          totalTokens: 85000,
          maxTokens: 100000,
          percentage: 85,
          messages: 8,
          canCompress: true,
          governance: {
            source: "runtimeControls.contextCompressionThresholdPercent",
            compressionThresholdPercent: 90,
            truncateTargetPercent: 60,
            compressionReason: "当前上下文未达到 runtimeControls.contextCompressionThresholdPercent=90% 的压缩阈值",
          },
        };
      }

      throw new Error(`Unexpected request: ${url}`);
    });
  });

  it("shows runtime context governance for book mode", async () => {
    const onClose = vi.fn();
    render(
      <ContextPanel visible onClose={onClose} mode="book" bookId="book-demo" chapterNumber={12} />,
    );

    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledWith("/api/ai/context-assembly", expect.any(Object));
    });
    await waitFor(() => {
      expect(fetchJsonMock).toHaveBeenCalledWith("/api/context/book-demo/usage");
    });

    expect(screen.getByText("上下文治理")).toBeTruthy();
    expect(screen.getByText(/压缩阈值 90%/)).toBeTruthy();
    expect(screen.getByText(/截断目标 60%/)).toBeTruthy();
    expect(screen.getByText("策略来源：runtimeControls.contextCompressionThresholdPercent")).toBeTruthy();
    expect(screen.getByText(/当前上下文未达到 runtimeControls.contextCompressionThresholdPercent=90% 的压缩阈值/)).toBeTruthy();
    expect(screen.getByText("AutoCompressToggle")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "压缩上下文" }));
    expect(fetchJsonMock).toHaveBeenCalledWith("/api/context/book-demo/compress", { method: "POST" });
  });
});
