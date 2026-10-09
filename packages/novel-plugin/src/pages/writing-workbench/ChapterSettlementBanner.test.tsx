import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchJson = vi.fn();

vi.mock("@/hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
}));

import { ChapterSettlementBanner } from "./ChapterSettlementBanner";

beforeEach(() => {
  fetchJson.mockReset().mockResolvedValue({ changed: true });
});

afterEach(() => {
  cleanup();
});

describe("ChapterSettlementBanner 改章 stale 横幅", () => {
  it("结算后正文被改过时显示横幅；有叙述者通道时按钮可点", async () => {
    const onAskResettle = vi.fn();
    render(<ChapterSettlementBanner bookId="book-1" chapterNumber={3} content="改动后的正文" onAskResettle={onAskResettle} />);

    await waitFor(() => expect(screen.getByTestId("chapter-stale-banner")).toBeTruthy(), { timeout: 3000 });
    expect(fetchJson).toHaveBeenCalledWith(
      expect.stringContaining("settlement-status"),
      expect.objectContaining({ method: "POST" }),
    );
    const button = screen.getByRole("button", { name: "让叙述者重结算" });
    expect(button).not.toHaveProperty("disabled", true);
    fireEvent.click(button);
    expect(onAskResettle).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("chapter-stale-no-narrator")).toBeNull();
  });

  it("没有叙述者通道时按钮禁用并给出说明，不再静默吞掉点击", async () => {
    render(<ChapterSettlementBanner bookId="book-1" chapterNumber={3} content="改动后的正文" />);

    await waitFor(() => expect(screen.getByTestId("chapter-stale-banner")).toBeTruthy(), { timeout: 3000 });
    const button = screen.getByRole("button", { name: "让叙述者重结算" });
    expect(button).toHaveProperty("disabled", true);
    expect(button.getAttribute("title")).toContain("叙述者会话");
    expect(screen.getByTestId("chapter-stale-no-narrator").textContent).toContain("先在对话里开启叙述者会话");
  });

  it("指纹未变时不显示横幅", async () => {
    fetchJson.mockResolvedValue({ changed: false });
    render(<ChapterSettlementBanner bookId="book-1" chapterNumber={3} content="未改动的正文" />);

    await waitFor(() => expect(fetchJson).toHaveBeenCalled(), { timeout: 3000 });
    expect(screen.queryByTestId("chapter-stale-banner")).toBeNull();
  });
});
