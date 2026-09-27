// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FANQIE_XUANHUAN_SERIAL_RECIPE } from "../../../engine/workflows/novel-workflows.js";
import type { WorkflowGraphRecipe } from "../../../engine/workflows/workflow-graph.js";
import { blankRecipe } from "./workflow-canvas-model";
import { WorkflowRecipeEditor } from "./WorkflowRecipeEditor";

type FetchCall = { url: string; method: string; body: any };

function mockFetch(respond: (call: FetchCall) => { status?: number; body: unknown }) {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const call = { url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const { status = 200, body } = respond(call);
    return { ok: status < 400, status, json: async () => body };
  }));
  return calls;
}

function renderEditor(recipe: WorkflowGraphRecipe, overrides: Partial<Parameters<typeof WorkflowRecipeEditor>[0]> = {}) {
  const props = {
    recipe,
    apiBase: "/api/books/book-1",
    onSaved: vi.fn(),
    onDeleted: vi.fn(),
    onCreate: vi.fn(),
    onReload: vi.fn(),
    onDirtyChange: vi.fn(),
    ...overrides,
  };
  return { ...render(<WorkflowRecipeEditor {...props} />), props };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const savedDraft = { ...blankRecipe("quick", "快写流"), revision: 2 };

describe("工作流方案编辑器", () => {
  it("画出方案的全部节点；已发布方案显示「已发布」与版本号", () => {
    renderEditor(FANQIE_XUANHUAN_SERIAL_RECIPE);
    for (const node of FANQIE_XUANHUAN_SERIAL_RECIPE.nodes) {
      expect(screen.getByTestId(`workflow-node-${node.id}`)).toBeTruthy();
    }
    expect(screen.getByTestId("workflow-recipe-status").textContent).toBe("已发布");
    expect(screen.queryByTestId("workflow-recipe-dirty")).toBeNull();
  });

  it("没选中节点时加工序：接在流向终点的那道后面，并选中新工序供编辑", () => {
    const { props } = renderEditor(savedDraft);
    fireEvent.click(screen.getByRole("button", { name: "工序" }));
    expect(screen.getByTestId("workflow-node-step-1").textContent).toContain("新工序");
    expect(screen.getByTestId("workflow-recipe-dirty")).toBeTruthy();
    expect(props.onDirtyChange).toHaveBeenLastCalledWith(true);
    // 属性面板切到新工序
    expect((screen.getByLabelText("节点名称") as HTMLInputElement).value).toBe("新工序");
  });

  it("改名：失焦时提交一条编辑指令；名称清空会被拒并给出说明", () => {
    renderEditor(savedDraft);
    fireEvent.click(screen.getByRole("button", { name: "工序" }));
    const name = screen.getByLabelText("节点名称") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "拟蓝图" } });
    fireEvent.blur(name);
    expect(screen.getByTestId("workflow-node-step-1").textContent).toContain("拟蓝图");

    fireEvent.change(name, { target: { value: "  " } });
    fireEvent.blur(name);
    expect(screen.getByTestId("workflow-op-problem").textContent).toContain("名称不能为空");
    expect(screen.getByTestId("workflow-node-step-1").textContent).toContain("拟蓝图");
  });

  it("有结构问题时不能发布，问题逐条列出且可点选定位", () => {
    const broken: WorkflowGraphRecipe = { ...savedDraft, edges: [] };
    renderEditor(broken);
    expect((screen.getByRole("button", { name: /发布/ }) as HTMLButtonElement).disabled).toBe(true);
    const issues = screen.getByTestId("workflow-inspector-issues");
    expect(issues.textContent).toContain("原因");
    fireEvent.click(issues.querySelector("button:not([disabled])") as HTMLButtonElement);
    expect(screen.getByLabelText("节点名称")).toBeTruthy();
  });

  it("保存草稿：整份提交并带上看到的版本号，成功后交回父组件", async () => {
    const calls = mockFetch((call) => ({ body: { ok: true, recipe: { ...call.body.recipe, revision: 3 }, issues: [] } }));
    const { props } = renderEditor(savedDraft);
    fireEvent.click(screen.getByRole("button", { name: "工序" }));
    fireEvent.click(screen.getByRole("button", { name: /保存草稿/ }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    expect(calls[0]).toMatchObject({ method: "PUT", url: "/api/books/book-1/workflow-recipes/quick" });
    expect(calls[0]!.body).toMatchObject({ expectedRevision: 2, recipe: { id: "quick", status: "draft" } });
    expect(calls[0]!.body.recipe.nodes.some((node: { id: string }) => node.id === "step-1")).toBe(true);
    expect(calls[0]!.body.recipe.layout.positions["step-1"]).toBeTruthy();
  });

  it("发布：结构完整的草稿以已发布状态提交", async () => {
    const complete = { ...FANQIE_XUANHUAN_SERIAL_RECIPE, id: "mine", status: "draft" as const, revision: 1 };
    const calls = mockFetch((call) => ({ body: { ok: true, recipe: { ...call.body.recipe, revision: 2 }, issues: [] } }));
    const { props } = renderEditor(complete);
    fireEvent.click(screen.getByRole("button", { name: /发布/ }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    expect(calls[0]!.body).toMatchObject({ expectedRevision: 1, recipe: { status: "published" } });
  });

  it("版本冲突：展示服务端三段说明，可放弃修改并重新载入", async () => {
    mockFetch(() => ({
      status: 409,
      body: {
        error: "「快写流」已被更新",
        code: "revision-conflict",
        explanation: { what: "「快写流」已被更新（你看到的是第 2 版，现在是第 3 版）", why: "叙述者可能刚改过", action: "重新读取方案后再修改" },
      },
    }));
    const { props } = renderEditor(savedDraft);
    fireEvent.click(screen.getByRole("button", { name: "工序" }));
    fireEvent.click(screen.getByRole("button", { name: /保存草稿/ }));
    await waitFor(() => expect(screen.getByTestId("workflow-save-error").textContent).toContain("现在是第 3 版"));
    fireEvent.click(screen.getByRole("button", { name: /重新载入/ }));
    expect(props.onReload).toHaveBeenCalled();
  });

  it("删除要二次确认；未保存的新方案只在本地移除，不发请求", async () => {
    const calls = mockFetch(() => ({ body: { ok: true } }));
    const fresh = blankRecipe("fresh", "新工作流");
    const { props } = renderEditor(fresh);
    fireEvent.click(screen.getByRole("button", { name: /删除方案/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    expect(props.onDeleted).toHaveBeenCalledWith("fresh");
    expect(calls).toHaveLength(0);
  });

  it("删除已保存的方案带上版本号", async () => {
    const calls = mockFetch(() => ({ body: { ok: true } }));
    const { props } = renderEditor(savedDraft);
    fireEvent.click(screen.getByRole("button", { name: /删除方案/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(props.onDeleted).toHaveBeenCalledWith("quick"));
    expect(calls[0]).toMatchObject({ method: "DELETE", url: "/api/books/book-1/workflow-recipes/quick?expectedRevision=2" });
  });

  it("叙述者起草的草稿标明来源", () => {
    renderEditor({ ...savedDraft, createdBy: "narrator" });
    expect(screen.getByText("叙述者起草")).toBeTruthy();
  });
});
