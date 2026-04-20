import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchJsonMock = vi.fn();

vi.mock("../../hooks/use-api", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import { ResourcesTab } from "./ResourcesTab";

describe("ResourcesTab", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders runtime resources and storage scan panel from the admin API", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      stats: {
        cpu: { usage: 18.2, cores: 8 },
        memory: { used: 8 * 1024 * 1024 * 1024, total: 16 * 1024 * 1024 * 1024 },
        disk: { used: 32 * 1024 * 1024 * 1024, total: 128 * 1024 * 1024 * 1024 },
        network: { sent: 1024, received: 2048 },
      },
    });

    render(<ResourcesTab />);

    expect(await screen.findByRole("heading", { name: "资源 / 存储面板" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "运行资源" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "存储扫描" })).toBeTruthy();
    expect(screen.getByText("18.2%")).toBeTruthy();
    expect(screen.getByText("8 核心")).toBeTruthy();
    expect(screen.getByText("8.00 GB / 16.00 GB")).toBeTruthy();
    expect(screen.getByText("存储扫描工作台")).toBeTruthy();
    expect(screen.getByText("接入状态")).toBeTruthy();
    expect(fetchJsonMock).toHaveBeenCalledWith("/api/admin/resources");
  });

  it("keeps the storage scan section visible when runtime stats are empty", async () => {
    fetchJsonMock.mockResolvedValueOnce({ stats: null });

    render(<ResourcesTab />);

    expect(await screen.findByText("暂无运行资源快照")).toBeTruthy();
    expect(screen.getByText("当前接口未返回 stats 字段；运行资源区块已站住，后续接入后会自动展示最新快照。")).toBeTruthy();
    expect(screen.getByText("存储扫描工作台")).toBeTruthy();
    expect(screen.getAllByText("待接入").length).toBeGreaterThan(0);
  });

  it("shows runtime load errors without hiding the storage scan section", async () => {
    fetchJsonMock.mockRejectedValueOnce(new Error("资源接口暂不可用"));

    render(<ResourcesTab />);

    expect(await screen.findByText("运行资源快照加载失败")).toBeTruthy();
    expect(screen.getByText("资源接口暂不可用")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试加载" })).toBeTruthy();
    expect(screen.getByText("存储扫描工作台")).toBeTruthy();
  });

  it("records a placeholder storage scan request", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      stats: {
        cpu: { usage: 10, cores: 4 },
        memory: { used: 4 * 1024 * 1024 * 1024, total: 8 * 1024 * 1024 * 1024 },
        disk: { used: 0, total: 0 },
        network: { sent: 0, received: 0 },
      },
    });

    render(<ResourcesTab />);

    await screen.findByRole("heading", { name: "资源 / 存储面板" });

    fireEvent.click(screen.getByRole("button", { name: "立即扫描（占位）" }));

    expect(screen.getByText("1 次")).toBeTruthy();
    expect(screen.getByText("已记录一次占位扫描请求。后续接入真实任务后，这里会展示扫描进度、结果摘要与异常资源列表。")).toBeTruthy();
  });
});
