import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchJsonMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-api", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/use-api")>("@/hooks/use-api");
  return { ...actual, fetchJson: fetchJsonMock };
});

import { scheduledTasksClient, type ScheduledTaskInput } from "../runtime-admin/scheduled-tasks";

const input: ScheduledTaskInput = {
  name: "每日续写",
  cronExpr: "0 9 * * *",
  timezone: "Asia/Shanghai",
  prompt: "继续写下一章",
  systemPrompt: null,
  model: null,
  permissionMode: "bypassPermissions",
  locale: "zh-CN",
  runContext: "chapter",
  cwd: null,
  projectId: "project/alpha",
  chapterId: "chapter 1",
  narratorMode: "reuse",
  enabled: true,
};

beforeEach(() => {
  fetchJsonMock.mockReset();
  fetchJsonMock.mockResolvedValue({});
});

describe("scheduledTasksClient", () => {
  it("uses the real Scheduled Tasks list and item paths", async () => {
    await scheduledTasksClient.list();
    await scheduledTasksClient.get("task/a b");

    expect(fetchJsonMock).toHaveBeenNthCalledWith(1, "/api/scheduled-tasks");
    expect(fetchJsonMock).toHaveBeenNthCalledWith(2, "/api/scheduled-tasks/task%2Fa%20b");
  });

  it("sends the exact create and update request bodies", async () => {
    await scheduledTasksClient.create(input);
    await scheduledTasksClient.update("task-1", { name: "更新名称", enabled: false });

    expect(fetchJsonMock).toHaveBeenNthCalledWith(1, "/api/scheduled-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(fetchJsonMock).toHaveBeenNthCalledWith(2, "/api/scheduled-tasks/task-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "更新名称", enabled: false }),
    });
  });

  it("uses toggle, run-now, history, and delete routes with their contract bodies", async () => {
    await scheduledTasksClient.setEnabled("task/1", false);
    await scheduledTasksClient.runNow("task/1");
    await scheduledTasksClient.listRuns("task/1", { limit: 50, cursor: "2026-03-20T10:00:00.000Z" });
    await scheduledTasksClient.delete("task/1");

    expect(fetchJsonMock).toHaveBeenNthCalledWith(1, "/api/scheduled-tasks/task%2F1/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(fetchJsonMock).toHaveBeenNthCalledWith(2, "/api/scheduled-tasks/task%2F1/run", { method: "POST" });
    expect(fetchJsonMock).toHaveBeenNthCalledWith(
      3,
      "/api/scheduled-tasks/task%2F1/runs?limit=50&cursor=2026-03-20T10%3A00%3A00.000Z",
    );
    expect(fetchJsonMock).toHaveBeenNthCalledWith(4, "/api/scheduled-tasks/task%2F1", { method: "DELETE" });
  });

  it("preserves fetchJson HTTP status errors for the page", async () => {
    const forbidden = Object.assign(new Error("Administrator role required"), { status: 403 });
    fetchJsonMock.mockRejectedValueOnce(forbidden);

    await expect(scheduledTasksClient.list()).rejects.toMatchObject({
      message: "Administrator role required",
      status: 403,
    });
  });
});
