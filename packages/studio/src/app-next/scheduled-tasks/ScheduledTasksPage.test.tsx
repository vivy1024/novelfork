import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  setEnabled: vi.fn(),
  runNow: vi.fn(),
  listRuns: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("../runtime-admin/scheduled-tasks", async () => {
  const actual = await vi.importActual<typeof import("../runtime-admin/scheduled-tasks")>("../runtime-admin/scheduled-tasks");
  return { ...actual, scheduledTasksClient: clientMocks };
});

import { ScheduledTasksPage } from "./ScheduledTasksPage";
import type { ScheduledTask, ScheduledTaskRun } from "../runtime-admin/scheduled-tasks";

const task: ScheduledTask = {
  id: "task-1",
  name: "每日续写",
  enabled: true,
  cronExpr: "0 9 * * *",
  timezone: "Asia/Shanghai",
  prompt: "继续写下一章",
  systemPrompt: null,
  model: null,
  permissionMode: "bypassPermissions",
  locale: "zh-CN",
  runContext: "standalone",
  cwd: null,
  projectId: null,
  chapterId: null,
  narratorMode: "new",
  reuseNarratorId: null,
  createdBy: "user-1",
  lastRunAt: null,
  nextRunAt: "2026-03-21T01:00:00.000Z",
  lastNarratorId: null,
  lastStatus: null,
  lastError: null,
  createdAt: "2026-03-20T00:00:00.000Z",
  updatedAt: "2026-03-20T00:00:00.000Z",
};

const run: ScheduledTaskRun = {
  id: "run-1",
  taskId: "task-1",
  narratorId: "narrator-1",
  status: "success",
  error: null,
  runContext: "standalone",
  manual: true,
  startedAt: "2026-03-20T01:00:00.000Z",
  finishedAt: "2026-03-20T01:00:01.250Z",
  durationMs: 1250,
  createdAt: "2026-03-20T01:00:01.250Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  clientMocks.list.mockResolvedValue([task]);
  clientMocks.create.mockImplementation(async (input) => ({ ...task, id: "task-2", ...input }));
  clientMocks.update.mockImplementation(async (_id, input) => ({ ...task, ...input }));
  clientMocks.setEnabled.mockResolvedValue({ ...task, enabled: false, nextRunAt: null });
  clientMocks.runNow.mockResolvedValue({ ...task, lastStatus: "success", lastRunAt: "2026-03-20T01:00:01.250Z" });
  clientMocks.listRuns.mockResolvedValue({ runs: [run], nextCursor: null });
  clientMocks.delete.mockResolvedValue({ ok: true });
});

afterEach(() => cleanup());

describe("ScheduledTasksPage", () => {
  it("loads real tasks and exposes toggle, run, history, edit, and delete actions", async () => {
    render(<ScheduledTasksPage />);

    expect(await screen.findByText("每日续写")).toBeTruthy();
    expect(clientMocks.list).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "停用" }));
    await waitFor(() => expect(clientMocks.setEnabled).toHaveBeenCalledWith("task-1", false));

    fireEvent.click(screen.getByRole("button", { name: "立即运行" }));
    await waitFor(() => expect(clientMocks.runNow).toHaveBeenCalledWith("task-1"));

    fireEvent.click(screen.getByRole("button", { name: "历史" }));
    await waitFor(() => expect(clientMocks.listRuns).toHaveBeenCalledWith("task-1", { limit: 50 }));
    expect(await screen.findByText("narrator-1")).toBeTruthy();
    expect(screen.getByText("手动")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "关闭" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByRole("heading", { name: "编辑计划任务" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(screen.getByRole("heading", { name: "删除计划任务" })).toBeTruthy();
  });

  it("creates with the validator-aligned request body", async () => {
    render(<ScheduledTasksPage />);
    await screen.findByText("每日续写");

    fireEvent.click(screen.getByRole("button", { name: "创建计划任务" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "每小时检查" } });
    fireEvent.change(screen.getByLabelText("Cron 表达式"), { target: { value: "0 * * * *" } });
    fireEvent.change(screen.getByLabelText("运行提示词"), { target: { value: "检查章节一致性" } });
    fireEvent.change(screen.getByLabelText("IANA 时区"), { target: { value: "Asia/Shanghai" } });
    fireEvent.click(screen.getByRole("button", { name: "创建任务" }));

    await waitFor(() => expect(clientMocks.create).toHaveBeenCalledWith({
      name: "每小时检查",
      cronExpr: "0 * * * *",
      timezone: "Asia/Shanghai",
      prompt: "检查章节一致性",
      systemPrompt: null,
      model: null,
      permissionMode: "bypassPermissions",
      locale: "zh-CN",
      runContext: "standalone",
      cwd: null,
      projectId: null,
      chapterId: null,
      narratorMode: "new",
      enabled: true,
    }));
  });

  it("renders HTTP status and server message instead of hiding request errors", async () => {
    clientMocks.list.mockRejectedValueOnce(Object.assign(new Error("Administrator role required"), { status: 403 }));

    render(<ScheduledTasksPage />);

    expect(await screen.findByText("403 · Administrator role required")).toBeTruthy();
    expect(screen.getByText("Scheduled Tasks 请求失败")).toBeTruthy();
  });
});
