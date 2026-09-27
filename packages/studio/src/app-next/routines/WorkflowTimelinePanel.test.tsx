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

describe("WorkflowTimelinePanel 执行监视器（Studio DOM 集成）", () => {
  it("没有叙述者会话时说明原因并禁止启动", async () => {
    mockFetch({ "/workflow-recipes": () => ({ recipes }), "/workflow-runs": () => ({ active: null, recent: [] }) });
    render(<WorkflowTimelinePanel bookId="book-test" currentChapter={5} />);
    await waitFor(() => expect(screen.getByText("后端反转悬疑流 (2 道工序)")).toBeTruthy());
    expect(screen.getByTestId("workflow-no-narrator")).toBeTruthy();
    expect((screen.getByRole("button", { name: /启动工作流/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("启动：按所选方案与章号建运行，只给叙述者发一句开工提示，并显示进行中的运行", async () => {
    const calls = mockFetch({
      "/workflow-recipes": () => ({ recipes }),
      "POST /workflow-runs": () => detail("running", "step-1", [step("step-1", 1, "拉取悬疑大纲", "running"), step("step-2", 2, "起草高压反转", "pending")], [], 0),
      "/workflow-runs?": () => ({ active: null, recent: [] }),
    });
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<WorkflowTimelinePanel bookId="book-test" currentChapter={3} narratorId="narrator-1" onSendToNarrator={onSend} />);
    await waitFor(() => expect((screen.getByRole("button", { name: /启动工作流/ }) as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(screen.getByRole("button", { name: /启动工作流/ }));
    await waitFor(() => expect(screen.getByTestId("workflow-active-run")).toBeTruthy());

    const post = calls.find((call) => call.method === "POST");
    expect(post?.body).toEqual({ recipeId: "backend-suspense-flow", chapterNumber: 3, narratorId: "narrator-1" });
    expect(onSend).toHaveBeenCalledTimes(1);
    const kickoff = String(onSend.mock.calls[0]![0]);
    expect(kickoff).toContain("第 3 章");
    expect(kickoff).toContain("workflow_get_current_step");
    expect(kickoff).not.toContain("起草高压反转");
    expect(screen.getByTestId("workflow-running-card").textContent).toContain("拉取悬疑大纲");
  });

  it("等待确认：展示待审正文；批准带上版本号；打回必须写意见", async () => {
    const awaiting = detail(
      "awaiting_approval",
      "step-2",
      [step("step-1", 1, "拉取悬疑大纲", "done"), step("step-2", 2, "起草高压反转", "awaiting_approval")],
      [{ id: "c1", stepId: "step-2", kind: "prose", payload: { title: "反转", content: "她终于开口。" }, validation: { wordCount: 6 }, decision: "pending" }],
    );
    const calls = mockFetch({
      "/workflow-recipes": () => ({ recipes }),
      "/steps/step-2/approve": () => detail("done", "", [step("step-1", 1, "拉取悬疑大纲", "done"), step("step-2", 2, "起草高压反转", "done")], [], 4),
      "/steps/step-2/reject": () => detail("running", "step-2", [step("step-1", 1, "拉取悬疑大纲", "done"), step("step-2", 2, "起草高压反转", "running")], [], 4),
      "/workflow-runs?": () => ({ active: awaiting, recent: [] }),
    });
    render(<WorkflowTimelinePanel bookId="book-test" narratorId="narrator-1" />);
    await waitFor(() => expect(screen.getByTestId("workflow-approval-card")).toBeTruthy());
    expect(screen.getByTestId("workflow-candidate-prose").textContent).toContain("她终于开口。");

    const reject = screen.getByRole("button", { name: /打回/ }) as HTMLButtonElement;
    expect(reject.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("打回意见"), { target: { value: "反转来得太早" } });
    expect(reject.disabled).toBe(false);
    fireEvent.click(reject);
    await waitFor(() => expect(calls.some((call) => call.url.includes("/reject"))).toBe(true));
    expect(calls.find((call) => call.url.includes("/reject"))?.body).toEqual({ expectedRevision: 3, note: "反转来得太早" });
  });

  it("批准时带上当前版本号", async () => {
    const awaiting = detail(
      "awaiting_approval",
      "step-2",
      [step("step-1", 1, "拉取悬疑大纲", "done"), step("step-2", 2, "起草高压反转", "awaiting_approval")],
      [{ id: "c1", stepId: "step-2", kind: "prose", payload: { content: "正文" }, validation: {}, decision: "pending" }],
      7,
    );
    const calls = mockFetch({
      "/workflow-recipes": () => ({ recipes }),
      "/steps/step-2/approve": () => detail("done", "", [], [], 8),
      "/workflow-runs?": () => ({ active: awaiting, recent: [] }),
    });
    render(<WorkflowTimelinePanel bookId="book-test" narratorId="narrator-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /批准/ }));
    await waitFor(() => expect(calls.some((call) => call.url.includes("/approve"))).toBe(true));
    expect(calls.find((call) => call.url.includes("/approve"))?.body).toEqual({ expectedRevision: 7 });
  });

  it("受阻：展示三段说明，可重试", async () => {
    const blocked = detail("blocked", "step-1", [
      step("step-1", 1, "拉取悬疑大纲", "failed", { note: { what: "缺上下文", why: "当前聚焦为空", action: "补写当前聚焦" } }),
      step("step-2", 2, "起草高压反转", "pending"),
    ]);
    const calls = mockFetch({
      "/workflow-recipes": () => ({ recipes }),
      "/retry": () => detail("running", "step-1", [step("step-1", 1, "拉取悬疑大纲", "running"), step("step-2", 2, "起草高压反转", "pending")], [], 4),
      "/workflow-runs?": () => ({ active: blocked, recent: [] }),
    });
    render(<WorkflowTimelinePanel bookId="book-test" narratorId="narrator-1" />);
    await waitFor(() => expect(screen.getByTestId("workflow-blocked-card")).toBeTruthy());
    expect(screen.getByTestId("workflow-blocked-card").textContent).toContain("当前聚焦为空");
    fireEvent.click(screen.getByRole("button", { name: /重试本工序/ }));
    await waitFor(() => expect(screen.getByTestId("workflow-running-card")).toBeTruthy());
    expect(calls.find((call) => call.url.includes("/retry"))?.body).toEqual({ expectedRevision: 3, stepId: "step-1" });
  });

  it("操作失败（如版本冲突）时显示服务端说明", async () => {
    const awaiting = detail("awaiting_approval", "step-2", [step("step-1", 1, "拉取悬疑大纲", "done"), step("step-2", 2, "起草高压反转", "awaiting_approval")], []);
    mockFetch({
      "/workflow-recipes": () => ({ recipes }),
      "/approve": () => ({ __status: 409, summary: "运行已被更新（你看到的是第 3 版，现在是第 4 版）。" }),
      "/workflow-runs?": () => ({ active: awaiting, recent: [] }),
    });
    render(<WorkflowTimelinePanel bookId="book-test" narratorId="narrator-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /批准/ }));
    await waitFor(() => expect(screen.getByTestId("workflow-action-error").textContent).toContain("现在是第 4 版"));
  });

  it("方案加载失败时不展示假内置预设，并提供重试", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    render(<WorkflowTimelinePanel bookId="book-fail" narratorId="narrator-1" />);
    await waitFor(() => expect(screen.getByText(/加载工作流配置失败: HTTP 500/)).toBeTruthy());
    expect(screen.queryByText("拉取悬疑大纲")).toBeNull();
    expect((screen.getByRole("button", { name: /启动工作流/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("并行：两道工序同时等你确认时各有一张卡，各自批准", async () => {
    const awaiting = detail("awaiting_approval", "plan", [
      step("plan", 1, "拟蓝图", "awaiting_approval", { requiresApproval: true }),
      step("research", 2, "查资料", "awaiting_approval", { requiresApproval: true }),
    ]);
    const calls = mockFetch({
      "/workflow-recipes": () => ({ recipes }),
      "/steps/research/approve": () => detail("awaiting_approval", "plan", [
        step("plan", 1, "拟蓝图", "awaiting_approval", { requiresApproval: true }),
        step("research", 2, "查资料", "done", { requiresApproval: true }),
      ], [], 4),
      "/workflow-runs?": () => ({ active: awaiting, recent: [] }),
    });
    render(<WorkflowTimelinePanel bookId="book-test" narratorId="narrator-1" />);
    await waitFor(() => expect(screen.getAllByTestId("workflow-approval-card")).toHaveLength(2));
    const researchCard = screen.getAllByTestId("workflow-approval-card").find((card) => card.textContent?.includes("查资料"))!;
    fireEvent.click(researchCard.querySelector("button") as HTMLButtonElement);
    await waitFor(() => expect(screen.getAllByTestId("workflow-approval-card")).toHaveLength(1));
    expect(calls.some((call) => call.url.includes("/steps/research/approve"))).toBe(true);
    expect(screen.getByTestId("workflow-approval-card").textContent).toContain("拟蓝图");
  });

  it("流程图上有打回线时，打回按钮写明回到哪道工序；分支结果与未走到的工序如实显示", async () => {
    const graph = {
      nodes: [
        { id: "start", type: "start", label: "开始" },
        { id: "draft", type: "step", kind: "writer-generate", label: "起草", enabled: true },
        { id: "audit", type: "step", kind: "audit", label: "审查", enabled: true, requiresApproval: true, outcomes: ["通过", "不通过"] },
        { id: "fix", type: "step", kind: "writer-generate", label: "返修", enabled: true },
        { id: "end", type: "end", label: "完成" },
      ],
      edges: [
        { id: "e1", source: "start", target: "draft", kind: "next" },
        { id: "e2", source: "draft", target: "audit", kind: "next" },
        { id: "e3", source: "audit", target: "end", kind: "next", outcome: "通过" },
        { id: "e4", source: "audit", target: "fix", kind: "next", outcome: "不通过" },
        { id: "e5", source: "fix", target: "end", kind: "next" },
        { id: "r1", source: "audit", target: "draft", kind: "reject" },
      ],
    };
    const awaiting = detail("awaiting_approval", "audit", [
      step("draft", 1, "起草", "done"),
      step("audit", 2, "审查", "awaiting_approval", { requiresApproval: true, outcome: "通过" }),
      step("fix", 3, "返修", "bypassed"),
    ], [], 5, graph);
    mockFetch({ "/workflow-recipes": () => ({ recipes }), "/workflow-runs?": () => ({ active: awaiting, recent: [] }) });
    render(<WorkflowTimelinePanel bookId="book-test" narratorId="narrator-1" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "打回到「起草」" })).toBeTruthy());
    const steps = screen.getByTestId("workflow-run-steps").textContent ?? "";
    expect(steps).toContain("结果：通过");
    expect(steps).toContain("分支未走到");

    fireEvent.click(screen.getByRole("button", { name: /流程图/ }));
    expect(screen.getByTestId("workflow-run-graph")).toBeTruthy();
    expect(screen.getByTestId("workflow-node-run-audit").textContent).toContain("结果：通过");
    expect(screen.getByTestId("workflow-node-run-fix").textContent).toContain("未走到");
  });

  it("草稿不能启动；画布上可以看到它并发布", async () => {
    const draft = { ...recipes[0]!, id: "narrator-draft", name: "叙述者草稿", status: "draft", createdBy: "narrator" };
    mockFetch({ "/workflow-recipes": () => ({ recipes: [draft] }), "/workflow-runs?": () => ({ active: null, recent: [] }) });
    render(<WorkflowTimelinePanel bookId="book-test" narratorId="narrator-1" />);
    await waitFor(() => expect(screen.getByTestId("workflow-recipe-editor")).toBeTruthy());
    expect((screen.getByRole("button", { name: /启动工作流/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("叙述者起草")).toBeTruthy();
    expect((screen.getByRole("button", { name: "发布" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("新建空白方案：先出现在方案列表里标为未保存，有未保存修改时锁住方案切换", async () => {
    mockFetch({ "/workflow-recipes": () => ({ recipes }), "/workflow-runs?": () => ({ active: null, recent: [] }) });
    render(<WorkflowTimelinePanel bookId="book-test" narratorId="narrator-1" />);
    await waitFor(() => expect(screen.getByTestId("workflow-recipe-editor")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /新建空白/ }));
    await waitFor(() => expect(screen.getByRole("option", { name: "新工作流 (0 道工序) · 草稿 · 未保存" })).toBeTruthy());
    expect((screen.getByLabelText("生产方案") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /启动工作流/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("切换作品时取消旧请求，避免串书", () => {
    let abortCalled = false;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
      opts?.signal?.addEventListener("abort", () => {
        abortCalled = true;
      });
      return new Promise(() => {});
    }));
    const { rerender } = render(<WorkflowTimelinePanel bookId="book-A" />);
    rerender(<WorkflowTimelinePanel bookId="book-B" />);
    expect(abortCalled).toBe(true);
  });
});
