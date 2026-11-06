// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { WorkflowTimelinePanel } from "@vivy1024/novelfork-novel-plugin/pages/writing-workbench";

const recipes = [
  {
    schemaVersion: 2,
    id: "backend-suspense-flow",
    name: "后端反转悬疑流",
    commandId: "/novel:suspense",
    description: "从后端 story/workflow_recipes.json 加载的真实数据",
    status: "published",
    revision: 1,
    nodes: [
      { id: "start", type: "start", label: "开始" },
      { id: "step-1", type: "step", kind: "context-load", label: "拉取悬疑大纲", enabled: true, tools: [] },
      { id: "step-2", type: "step", kind: "writer-generate", label: "起草高压反转", enabled: true, requiresApproval: true },
      { id: "end", type: "end", label: "完成" },
    ],
    edges: [
      { id: "e1", source: "start", target: "step-1", kind: "next" },
      { id: "e2", source: "step-1", target: "step-2", kind: "next" },
      { id: "e3", source: "step-2", target: "end", kind: "next" },
    ],
    resultStrategy: "formal-chapter",
    maxRetries: 1,
  },
];

function step(stepId: string, ordinal: number, label: string, status: string, patch: Record<string, unknown> = {}) {
  return {
    stepId, ordinal, label, status, attempt: status === "pending" ? 0 : 1, maxAttempts: 2,
    executorKind: "narrator", requiresApproval: ordinal === 2, expectedOutput: ordinal === 1 ? "other" : "prose",
    tools: [], kind: "custom-tool", onFailure: "stop", ...patch,
  };
}

function detail(status: string, currentStepId: string, steps: unknown[], candidates: unknown[] = [], revision = 3, graph?: unknown) {
  return {
    run: { id: "wfrun:1", chapterNumber: 3, recipeName: "后端反转悬疑流", status, currentStepId, revision, updatedAt: 0, steps },
    ...(graph ? { graph } : {}),
    brief: "简报",
    candidates,
    events: [],
  };
}

type Handler = (url: string, init?: RequestInit) => unknown;

function mockFetch(routes: Record<string, Handler>) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fn = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    // 按声明顺序取第一个命中的路由；「POST 」前缀只匹配 POST。没声明的一律 404。
    const key = Object.keys(routes).find((pattern) => pattern.startsWith("POST ")
      ? method === "POST" && url.includes(pattern.slice(5))
      : url.includes(pattern));
    const body = key ? routes[key]!(url, init) : { summary: "not-mocked" };
    const status = !key ? 404 : typeof body === "object" && body && "__status" in body ? Number((body as { __status: number }).__status) : 200;
    return { ok: status < 400, status, json: async () => body };
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

beforeEach(() => {
  // 画布用的 React Flow 依赖这两个浏览器 API，jsdom 没有实现。
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal("DOMMatrixReadOnly", class {
    m22 = 1;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WorkflowTimelinePanel：本书默认工作流与落盘受阻", () => {
  const second = { ...recipes[0]!, id: "fast-flow", name: "快写流" };

  it("有本书默认时默认选中它并标注，仍可临时换", async () => {
    const calls = mockFetch({
      "/workflow-recipes": () => ({ recipes: [recipes[0], second] }),
      "/workflow-default": () => ({ storedRecipeId: "fast-flow", recipeId: "fast-flow", recipeName: "快写流" }),
      "POST /workflow-runs": () => detail("running", "step-1", [step("step-1", 1, "拉取悬疑大纲", "running")], [], 0),
      "/workflow-runs?": () => ({ active: null, recent: [] }),
    });
    render(<WorkflowTimelinePanel bookId="book-test" currentChapter={4} narratorId="narrator-1" />);
    await waitFor(() => expect((screen.getByLabelText("生产方案") as HTMLSelectElement).value).toBe("fast-flow"));
    expect(screen.getByRole("option", { name: /快写流 .*本书默认/ })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("生产方案"), { target: { value: "backend-suspense-flow" } });
    await waitFor(() => expect((screen.getByRole("button", { name: /启动工作流/ }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: /启动工作流/ }));
    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    expect(calls.find((call) => call.method === "POST")?.body).toMatchObject({ recipeId: "backend-suspense-flow", chapterNumber: 4 });
  });

  it("没有默认（或读不到）时按列表第一个", async () => {
    mockFetch({
      "/workflow-recipes": () => ({ recipes: [recipes[0], second] }),
      "/workflow-runs?": () => ({ active: null, recent: [] }),
    });
    render(<WorkflowTimelinePanel bookId="book-test" narratorId="narrator-1" />);
    await waitFor(() => expect((screen.getByLabelText("生产方案") as HTMLSelectElement).value).toBe("backend-suspense-flow"));
  });

  it("落盘工序受阻：隐藏跳过并说明原因，写意见后打回重写正文", async () => {
    const blocked = detail("blocked", "step-2", [
      step("step-1", 1, "起草正文", "done"),
      step("step-2", 2, "成品落盘", "failed", { tools: ["pipeline.write"], note: { what: "正文字数不在范围内", why: "只有 1200 字", action: "打回补写" } }),
    ]);
    const calls = mockFetch({
      "/workflow-recipes": () => ({ recipes }),
      "POST /reject": () => detail("running", "step-1", [step("step-1", 1, "起草正文", "running"), step("step-2", 2, "成品落盘", "pending")], [], 4),
      "/workflow-runs?": () => ({ active: blocked, recent: [] }),
    });
    render(<WorkflowTimelinePanel bookId="book-test" narratorId="narrator-1" />);
    const card = await screen.findByTestId("workflow-blocked-card");
    expect(screen.queryByRole("button", { name: /^跳过$/ })).toBeNull();
    expect(screen.getByTestId("workflow-blocked-no-skip").textContent).toContain("不能跳过");
    const rejectButton = screen.getByRole("button", { name: /打回重写正文/ }) as HTMLButtonElement;
    expect(rejectButton.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("打回重写正文的意见"), { target: { value: "补到 3000 字" } });
    fireEvent.click(rejectButton);
    await waitFor(() => expect(calls.some((call) => call.url.includes("/steps/step-2/reject"))).toBe(true));
    expect(calls.find((call) => call.url.includes("/steps/step-2/reject"))?.body).toEqual({ expectedRevision: 3, note: "补到 3000 字" });
    expect(card).toBeTruthy();
  });

  it("非落盘工序受阻仍可跳过", async () => {
    const blocked = detail("blocked", "step-1", [step("step-1", 1, "拉取悬疑大纲", "failed", { tools: ["cockpit.snapshot"] })]);
    mockFetch({ "/workflow-recipes": () => ({ recipes }), "/workflow-runs?": () => ({ active: blocked, recent: [] }) });
    render(<WorkflowTimelinePanel bookId="book-test" narratorId="narrator-1" />);
    await screen.findByTestId("workflow-blocked-card");
    expect(screen.getByRole("button", { name: /跳过/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /打回重写正文/ })).toBeNull();
  });
});
