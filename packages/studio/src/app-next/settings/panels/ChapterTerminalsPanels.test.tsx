import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clients = vi.hoisted(() => ({
  chapterContainers: { get: vi.fn(), patch: vi.fn() },
  terminals: { list: vi.fn(), kill: vi.fn(), batchKill: vi.fn(), killOrphan: vi.fn(), reattach: vi.fn(), reattachOrphan: vi.fn() },
}));

vi.mock("../../runtime-admin/chapter-containers", () => ({
  createChapterContainerSettingsClient: () => clients.chapterContainers,
}));
vi.mock("../../runtime-admin/terminals", () => ({
  createTerminalsAdminClient: () => clients.terminals,
}));
vi.mock("@/lib/notify", () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

import { ChaptersContainersPanel } from "./ChaptersContainersPanel";
import { TerminalsPanel } from "./TerminalsPanel";

const terminalData = {
  terminals: [
    { id: "term-1", name: "写作终端", status: "running", attached: false, cwd: "D:/books/one", createdAt: "2026-06-01T10:00:00.000Z", processes: [{ pid: 7, ppid: 1, command: "bun", state: "R", rss: 2048, cpu: 1, elapsed: "00:20" }] },
    { id: "term-2", name: "已退出终端", status: "exited", attached: false, cwd: null, createdAt: "2026-06-01T09:00:00.000Z", processes: [] },
  ],
  orphanSockets: [{ terminalId: "orphan-1", socketPath: "/tmp/narrafork-orphan-1.sock" }],
};

beforeEach(() => {
  clients.chapterContainers.get.mockResolvedValue({
    chapters: { maxActiveWorktrees: 11, maxActiveContainers: 6, worktreeSizeWarningMb: 600, autoSaveOnDormant: false, dormantAfterMinutes: 15 },
    containers: { portRangeStart: 11000, portRangeEnd: 21000, proxy: { enabled: false, port: 7781 } },
  });
  clients.chapterContainers.patch.mockResolvedValue({});
  clients.terminals.list.mockResolvedValue(terminalData);
  clients.terminals.kill.mockResolvedValue({ ok: true });
  clients.terminals.batchKill.mockResolvedValue({ results: [{ id: "term-1", ok: true }] });
  clients.terminals.killOrphan.mockResolvedValue({ ok: true });
  clients.terminals.reattach.mockResolvedValue({ ok: true });
  clients.terminals.reattachOrphan.mockResolvedValue({ ...terminalData.terminals[0], id: "orphan-1" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("ChaptersContainersPanel", () => {
  it("loads native fields and PATCHes the explicit chapters/containers slices", async () => {
    render(<ChaptersContainersPanel />);
    expect(await screen.findByRole("heading", { name: "章节与容器" })).toBeTruthy();
    expect(screen.getByLabelText("最大活动工作树")).toHaveProperty("value", "11");

    fireEvent.change(screen.getByLabelText("最大活动工作树"), { target: { value: "14" } });
    fireEvent.click(screen.getByLabelText("休眠时自动保存"));
    fireEvent.click(screen.getByLabelText("启用容器代理"));
    fireEvent.change(screen.getByLabelText("容器代理端口"), { target: { value: "7790" } });
    fireEvent.click(screen.getByRole("button", { name: "保存章节与容器设置" }));

    await waitFor(() => expect(clients.chapterContainers.patch).toHaveBeenCalledWith({
      chapters: { maxActiveWorktrees: 14, maxActiveContainers: 6, worktreeSizeWarningMb: 600, autoSaveOnDormant: true, dormantAfterMinutes: 15 },
      containers: { portRangeStart: 11000, portRangeEnd: 21000, proxy: { enabled: true, port: 7790 } },
    }));
  });
});

describe("TerminalsPanel", () => {
  it("loads real terminal records and runs reattach, batch kill, and orphan actions", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<TerminalsPanel />);

    expect(await screen.findByText("写作终端")).toBeTruthy();
    expect(screen.getByText("已退出终端")).toBeTruthy();
    expect(screen.getByText("orphan-1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "恢复孤立终端 orphan-1" }));
    await waitFor(() => expect(clients.terminals.reattachOrphan).toHaveBeenCalledWith("orphan-1"));

    fireEvent.click(screen.getByRole("button", { name: "恢复终端 写作终端" }));
    await waitFor(() => expect(clients.terminals.reattach).toHaveBeenCalledWith("term-1"));

    fireEvent.click(screen.getByLabelText("选择终端 写作终端"));
    fireEvent.click(screen.getByRole("button", { name: "终止所选（1）" }));
    await waitFor(() => expect(clients.terminals.batchKill).toHaveBeenCalledWith(["term-1"]));
  });
});
