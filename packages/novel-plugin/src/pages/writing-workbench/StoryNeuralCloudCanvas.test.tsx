import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { StoryNeuralCloudCanvas } from "./StoryNeuralCloudCanvas";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  fetchJsonMock.mockReset();
});

describe("StoryNeuralCloudCanvas", () => {
  it("空数据给出下一步，而不是空画布", async () => {
    fetchJsonMock.mockResolvedValue({ entries: [], facts: [], events: [] });
    render(<StoryNeuralCloudCanvas bookId="book-1" currentChapter={3} />);
    expect(await screen.findByTestId("story-neural-cloud-empty")).toBeTruthy();
    expect(screen.getByText(/先在经纬里写下角色/)).toBeTruthy();
  });

  it("读取失败给出重试", async () => {
    fetchJsonMock.mockRejectedValue(new Error("图谱服务断开"));
    render(<StoryNeuralCloudCanvas bookId="book-1" />);
    expect(await screen.findByTestId("story-neural-cloud-error")).toBeTruthy();
    expect(screen.getByText("图谱服务断开")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
  });

  it("有数据时渲染点云和检查器空态", async () => {
    fetchJsonMock.mockImplementation(async (url: string) => {
      if (String(url).includes("category=characters")) {
        return { entries: [{ id: "entry-linzhou", category: "characters", title: "林舟", fields: { name: "林舟", firstChapter: 1 } }] };
      }
      if (String(url).includes("/narrative-memory/graph")) return { facts: [], events: [] };
      return { entries: [] };
    });
    render(<StoryNeuralCloudCanvas bookId="book-1" currentChapter={1} />);
    expect(await screen.findByTestId("story-neural-cloud")).toBeTruthy();
    expect(screen.getByTestId("story-neural-cloud-canvas")).toBeTruthy();
    expect(screen.getByText("点一个点")).toBeTruthy();
  });
});
