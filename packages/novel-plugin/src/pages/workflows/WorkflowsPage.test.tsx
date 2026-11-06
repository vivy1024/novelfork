// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NOVEL_SUBAGENT_ROSTER } from "../../engine/agents/roster.js";
import { NOVEL_BUILTIN_WORKFLOWS } from "../../engine/workflows/novel-workflows.js";
import { WorkflowsPage } from "./WorkflowsPage";
import { WorkflowRunsPanel } from "./WorkflowRunsPanel";

type Handler = (url: string, init?: RequestInit) => unknown;

function mockFetch(routes: Record<string, Handler>) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = Object.keys(routes).find((pattern) => {
      const [m, p] = pattern.includes(" ") ? pattern.split(" ") as [string, string] : ["GET", pattern];
      return m === method && url.includes(p);
    });
    const body = key ? routes[key]!(url, init) : { error: "not-mocked" };
    const status = !key ? 404 : typeof body === "object" && body && "__status" in body ? Number((body as { __status: number }).__status) : 200;
    return { ok: status < 400, status, json: async () => body };
  }));
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const books = [{ id: "book-1", title: "凡人修仙录" }];
const builtin = NOVEL_BUILTIN_WORKFLOWS;
const custom = {
  ...builtin[0]!,
  id: "mine",
  name: "我的快写流",
  status: "draft" as const,
  revision: 2,
  createdBy: "author" as const,
};

function renderPage(defaultRecipeId: string | null = null, recipes: unknown[] = [...builtin, custom]) {
  const calls = mockFetch({
    "/workflow-recipes": () => ({ recipes }),
    "GET /workflow-default": () => ({
      storedRecipeId: defaultRecipeId,
      recipeId: defaultRecipeId,
      recipeName: defaultRecipeId ? builtin.find((r) => r.id === defaultRecipeId)?.name ?? null : null,
    }),
    "PUT /workflow-default": (_url, init) => {
      const id = JSON.parse(String(init?.body)).recipeId as string | null;
      return { storedRecipeId: id, recipeId: id, recipeName: builtin.find((r) => r.id === id)?.name ?? null };
    },
    "PUT /workflow-recipes/": (_url, init) => {
      const { recipe } = JSON.parse(String(init?.body));
      return { recipe: { ...recipe, revision: 3 } };
    },
  });
  render(<WorkflowsPage books={books} selectedBookId="book-1" onSelectBook={vi.fn()} />);
  return calls;
}

describe("工作流页：方案列表", () => {
  it("内置方案只读（不能改名、没有保存按钮），自己的方案可编辑", async () => {
    renderPage();
    const builtinList = await screen.findByTestId("workflow-builtin-list");
    expect(within(builtinList).getAllByRole("button")).toHaveLength(builtin.length);
    expect(within(screen.getByTestId("workflow-mine-list")).getByText("我的快写流")).toBeTruthy();

    // 默认选中第一个内置方案：只读
    await waitFor(() => expect(screen.getByTestId("workflow-step-editor")).toBeTruthy());
    expect(screen.getByText("内置 · 只读")).toBeTruthy();
    expect(screen.queryByLabelText("方案名称")).toBeNull();
    expect(screen.queryByRole("button", { name: /保存草稿/ })).toBeNull();
    expect(screen.getByRole("button", { name: /复制为我的方案/ })).toBeTruthy();

    fireEvent.click(within(screen.getByTestId("workflow-mine-list")).getByRole("button"));
    await waitFor(() => expect(screen.getByLabelText("方案名称")).toBeTruthy());
    expect(screen.getByRole("button", { name: /保存草稿/ })).toBeTruthy();
  });

  it("复制内置方案：出现在「我的方案」里标为未保存", async () => {
    renderPage();
    await screen.findByTestId("workflow-step-editor");
    fireEvent.click(screen.getByRole("button", { name: /复制为我的方案/ }));
    await waitFor(() => expect(within(screen.getByTestId("workflow-mine-list")).getByText(`${builtin[0]!.name}（我的）`)).toBeTruthy());
    expect(screen.getByTestId("workflow-step-editor-dirty")).toBeTruthy();
  });

  it("纵向步骤：按执行顺序列出工序，委派工序显示子代理中文名", async () => {
    renderPage();
    const list = await screen.findByTestId("workflow-step-list");
    const labels = within(list).getAllByText(/./, { selector: "[id$='-title']" }).map((node) => node.textContent);
    expect(labels[0]).toBe("装配上下文与前置预检");
    expect(labels.at(-1)).toBe("章后状态与账本结算");
    expect(within(screen.getByTestId("workflow-step-step-draft")).getByDisplayValue("委派：执笔")).toBeTruthy();
    // 「谁来做」下拉直接取名册：新增的帮手自动出现
    const draftStep = screen.getByTestId("workflow-step-step-draft");
    const options = within(draftStep).getAllByRole("option").map((option) => option.textContent);
    for (const template of NOVEL_SUBAGENT_ROSTER) expect(options).toContain(`委派：${template.nameZh}`);
    expect(options).toContain("大纲推演（推演后续几章的大纲，交你确认）");
  });
});

describe("工作流页：编辑与校验", () => {
  it("改坏结构时用作者能懂的话列出问题，并禁用发布", async () => {
    renderPage();
    await screen.findByTestId("workflow-mine-list");
    fireEvent.click(within(screen.getByTestId("workflow-mine-list")).getByRole("button"));
    await waitFor(() => expect(screen.getByLabelText("方案名称")).toBeTruthy());
    expect(screen.queryByTestId("workflow-step-editor-issues")).toBeNull();

    // 审校工序的「需要确认」关掉后，它连出的打回线不再合法
    const audit = screen.getByTestId("workflow-step-step-adversarial-audit");
    fireEvent.click(within(audit).getByLabelText("做完要我确认"));
    const issues = await screen.findByTestId("workflow-step-editor-issues");
    expect(issues.textContent).toContain("不需要作者确认，不能连出打回线");
    expect(issues.textContent).toContain("建议：");
    expect((screen.getByRole("button", { name: /检查并发布/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("上移工序后保存草稿：带上看到的版本号，并按新顺序重连", async () => {
    const calls = renderPage();
    await screen.findByTestId("workflow-mine-list");
    fireEvent.click(within(screen.getByTestId("workflow-mine-list")).getByRole("button"));
    await waitFor(() => expect(screen.getByLabelText("方案名称")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "上移「生成场景蓝图」" }));
    fireEvent.click(screen.getByRole("button", { name: /保存草稿/ }));
    await waitFor(() => expect(calls.some((call) => call.method === "PUT" && call.url.includes("/workflow-recipes/mine"))).toBe(true));
    const saved = calls.find((call) => call.method === "PUT" && call.url.includes("/workflow-recipes/mine"))!.body as {
      expectedRevision: number;
      recipe: { status: string; edges: Array<{ kind: string; source: string; target: string }> };
    };
    expect(saved.expectedRevision).toBe(2);
    expect(saved.recipe.status).toBe("draft");
    expect(saved.recipe.edges.some((edge) => edge.kind === "next" && edge.source === "start" && edge.target === "step-blueprint")).toBe(true);
  });

  it("落盘工序的失败策略里没有「跳过」，并说明原因", async () => {
    renderPage();
    await screen.findByTestId("workflow-mine-list");
    fireEvent.click(within(screen.getByTestId("workflow-mine-list")).getByRole("button"));
    const settle = await screen.findByTestId("workflow-step-step-settlement");
    const select = within(settle).getByLabelText(/失败时/) as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).not.toContain("跳过继续");
    expect(within(settle).getByText(/失败不能跳过/)).toBeTruthy();
    const context = screen.getByTestId("workflow-step-step-context");
    expect([...(within(context).getByLabelText(/失败时/) as HTMLSelectElement).options].map((o) => o.textContent)).toContain("跳过继续");
  });
});

describe("工作流页：本书默认", () => {
  it("显示当前默认；把选中的已发布方案设为默认时写入并刷新", async () => {
    const calls = renderPage(builtin[0]!.id);
    const box = await screen.findByTestId("workflow-book-default");
    await waitFor(() => expect(box.textContent).toContain(builtin[0]!.name));

    fireEvent.click(within(screen.getByTestId("workflow-builtin-list")).getByText(builtin[1]!.name));
    fireEvent.click(await screen.findByRole("button", { name: `把「${builtin[1]!.name}」设为本书默认` }));
    await waitFor(() => expect(box.textContent).toContain(builtin[1]!.name));
    const put = calls.find((call) => call.method === "PUT" && call.url.endsWith("/workflow-default"));
    expect(put?.body).toEqual({ recipeId: builtin[1]!.id });
  });

  it("草稿不能设为默认（没有设为默认的按钮）", async () => {
    renderPage();
    await screen.findByTestId("workflow-mine-list");
    fireEvent.click(within(screen.getByTestId("workflow-mine-list")).getByRole("button"));
    await waitFor(() => expect(screen.getByLabelText("方案名称")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /设为本书默认/ })).toBeNull();
  });
});

describe("工作流页：子代理一览", () => {
  it("列出名册里全部内置子代理的中文名与可用工具，不显示内部 id", async () => {
    renderPage();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "子代理" }));
    fireEvent.click(screen.getByRole("tab", { name: "子代理" }));
    const roster = await screen.findByTestId("workflow-subagent-roster");
    expect(within(roster).getAllByRole("listitem").filter((item) => item.dataset.testid?.startsWith("workflow-subagent-"))).toHaveLength(NOVEL_SUBAGENT_ROSTER.length);
    expect(roster.textContent).toContain("执笔");
    expect(roster.textContent).toContain("结算核对");
    // 名册新增的帮手自动出现在一览里
    for (const name of ["读者视角", "市场视角", "文风把关", "大纲推演", "通用帮手"]) expect(roster.textContent).toContain(name);
    expect(roster.textContent).not.toContain("nf-");
  });
});

// ─── 运行面板 ────────────────────────────────────────────────────────────────

function step(stepId: string, ordinal: number, label: string, status: string, patch: Record<string, unknown> = {}) {
  return { stepId, ordinal, label, status, attempt: 1, executorKind: "narrator", requiresApproval: false, tools: [], ...patch };
}

function detail(status: string, steps: unknown[], candidates: unknown[] = [], revision = 5) {
  return {
    run: { id: "wfrun:1", chapterNumber: 7, recipeName: "爆款连载流", status, revision, updatedAt: 0, steps },
    graph: {
      nodes: [{ id: "draft", label: "起草正文" }, { id: "audit", label: "审校" }, { id: "settle", label: "落盘" }],
      edges: [{ kind: "reject", source: "audit", target: "draft" }],
    },
    candidates,
  };
}

function renderRuns(current: unknown, extra: Record<string, Handler> = {}) {
  const calls = mockFetch({
    "GET /workflow-runs/wfrun": () => current,
    "GET /workflow-runs": () => ({ recent: [{ id: "wfrun:1", chapterNumber: 7, recipeName: "爆款连载流", status: (current as { run: { status: string } }).run.status, revision: 5, updatedAt: 0 }] }),
    ...extra,
  });
  render(<WorkflowRunsPanel apiBase="/api/books/book-1" />);
  return calls;
}

describe("运行面板", () => {
  const awaiting = detail("awaiting_approval", [
    step("draft", 1, "起草正文", "done"),
    step("audit", 2, "审校", "awaiting_approval", { requiresApproval: true }),
  ], [{ id: "c1", stepId: "audit", kind: "audit", payload: { passed: false, summary: "冲突没升级", issues: [{ description: "第三段降智" }] }, validation: {}, decision: "pending" }]);

  it("等待确认时有醒目提示与审校意见；确认带 expectedRevision", async () => {
    const calls = renderRuns(awaiting, { "POST /approve": () => detail("running", [step("draft", 1, "起草正文", "done"), step("audit", 2, "审校", "done")], [], 6) });
    expect((await screen.findByTestId("workflow-runs-waiting")).textContent).toContain("第 7 章");
    const card = await screen.findByTestId("workflow-run-approval");
    expect(card.textContent).toContain("第三段降智");
    fireEvent.click(within(card).getByRole("button", { name: /确认/ }));
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/steps/audit/approve"))).toBe(true));
    expect(calls.find((call) => call.url.endsWith("/steps/audit/approve"))!.body).toEqual({ expectedRevision: 5 });
  });

  it("打回必须写意见，按打回线说明回到哪道工序，带意见与版本号", async () => {
    const calls = renderRuns(awaiting, { "POST /reject": () => detail("running", [step("draft", 1, "起草正文", "running"), step("audit", 2, "审校", "pending")], [], 6) });
    const card = await screen.findByTestId("workflow-run-approval");
    const rejectButton = within(card).getByRole("button", { name: "打回到「起草正文」" }) as HTMLButtonElement;
    expect(rejectButton.disabled).toBe(true);
    fireEvent.change(within(card).getByLabelText("打回「审校」的意见"), { target: { value: "冲突要升级" } });
    fireEvent.click(rejectButton);
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/steps/audit/reject"))).toBe(true));
    expect(calls.find((call) => call.url.endsWith("/steps/audit/reject"))!.body).toEqual({ note: "冲突要升级", expectedRevision: 5 });
  });

  it("落盘工序受阻：没有「跳过」，可写意见打回重写正文", async () => {
    const blocked = detail("blocked", [
      step("draft", 1, "起草正文", "done"),
      step("settle", 2, "落盘", "failed", { tools: ["pipeline.write"], note: { what: "正文只有 1200 字", why: "低于本书下限", action: "补写或打回" } }),
    ]);
    const calls = renderRuns(blocked, { "POST /reject": () => detail("running", [step("draft", 1, "起草正文", "running"), step("settle", 2, "落盘", "pending")], [], 6) });
    const card = await screen.findByTestId("workflow-run-blocked");
    expect(within(card).queryByRole("button", { name: "跳过" })).toBeNull();
    expect(within(card).getByTestId("workflow-run-no-skip").textContent).toContain("不能跳过");
    const rejectButton = within(card).getByRole("button", { name: /打回重写正文/ }) as HTMLButtonElement;
    expect(rejectButton.disabled).toBe(true);
    fireEvent.change(within(card).getByLabelText(/打回重写正文的意见/), { target: { value: "补到 3000 字" } });
    fireEvent.click(rejectButton);
    await waitFor(() => expect(calls.some((call) => call.url.endsWith("/steps/settle/reject"))).toBe(true));
    expect(calls.find((call) => call.url.endsWith("/steps/settle/reject"))!.body).toEqual({ note: "补到 3000 字", expectedRevision: 5 });
  });

  it("非落盘工序受阻仍可跳过", async () => {
    renderRuns(detail("blocked", [step("ctx", 1, "读取上下文", "failed", { tools: ["cockpit.snapshot"] })]));
    const card = await screen.findByTestId("workflow-run-blocked");
    expect(within(card).getByRole("button", { name: "跳过" })).toBeTruthy();
    expect(within(card).queryByRole("button", { name: /打回重写正文/ })).toBeNull();
  });

  it("操作失败（版本冲突）时显示服务端说明", async () => {
    renderRuns(awaiting, {
      "POST /approve": () => ({ __status: 409, error: "revision-conflict", explanation: { what: "运行已被更新", why: "叙述者刚提交了新产物", action: "看过最新内容后再确认" } }),
    });
    const card = await screen.findByTestId("workflow-run-approval");
    fireEvent.click(within(card).getByRole("button", { name: /确认/ }));
    expect((await screen.findByTestId("workflow-runs-error")).textContent).toContain("运行已被更新");
  });
});
