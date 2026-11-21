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

  /**
   * 「直接重结算」不依赖叙述者会话：没有 onAskResettle 时原按钮禁用，
   * 这条路仍要能用 —— 它直接调 resettle 路由，由服务端用作者配置的默认模型结算。
   */
  it("没有叙述者通道时仍可直接重结算，成功后横幅消失", async () => {
    fetchJson.mockImplementation(async (path: string) => {
      if (String(path).includes("settlement-status")) return { changed: true };
      if (String(path).includes("/resettle")) return { summary: "第3章章后结算完成：抽取 2 条事件。" };
      throw new Error(`unexpected fetchJson: ${path}`);
    });
    render(<ChapterSettlementBanner bookId="book-1" chapterNumber={3} content="改动后的正文" />);

    await waitFor(() => expect(screen.getByTestId("chapter-stale-banner")).toBeTruthy(), { timeout: 3000 });
    const direct = screen.getByTestId("chapter-stale-direct-resettle");
    expect(direct).not.toHaveProperty("disabled", true);

    fireEvent.click(direct);
    await waitFor(() => expect(screen.queryByTestId("chapter-stale-banner")).toBeNull());
    expect(fetchJson).toHaveBeenCalledWith(
      "/api/books/book-1/narrative-memory/chapters/3/resettle",
      expect.objectContaining({ method: "POST" }),
    );
  });

  /** 失败时展示后端三段式说明（请求封装已拼成 message），不假装结算成功。 */
  it("直接重结算失败时展示服务端说明且保留横幅", async () => {
    fetchJson.mockImplementation(async (path: string) => {
      if (String(path).includes("settlement-status")) return { changed: true };
      if (String(path).includes("/resettle")) {
        throw new Error("第 3 章没有结算：当前宿主没有提供服务端模型能力。 在叙述者对话里让它结算本章。");
      }
      throw new Error(`unexpected fetchJson: ${path}`);
    });
    render(<ChapterSettlementBanner bookId="book-1" chapterNumber={3} content="改动后的正文" />);

    await waitFor(() => expect(screen.getByTestId("chapter-stale-banner")).toBeTruthy(), { timeout: 3000 });
    fireEvent.click(screen.getByTestId("chapter-stale-direct-resettle"));

    const alert = await screen.findByTestId("chapter-stale-resettle-error");
    expect(alert.textContent).toContain("没有提供服务端模型能力");
    expect(alert.textContent).toContain("在叙述者对话里让它结算本章");
    // 结算没成功，横幅必须留着，别让作者以为记忆已更新。
    expect(screen.getByTestId("chapter-stale-banner")).toBeTruthy();
  });
});
