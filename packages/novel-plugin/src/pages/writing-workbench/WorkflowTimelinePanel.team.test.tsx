import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NovelWorkflowRecipe } from "../../engine/workflows/novel-workflows.js";
import { WorkflowTimelinePanel } from "./WorkflowTimelinePanel";

// 画布与编辑器是重组件（xyflow 依赖 ResizeObserver 等），本测试只关心按钮到接口的链路。
vi.mock("./workflow-canvas/WorkflowCanvas", () => ({ WorkflowCanvas: () => null }));
vi.mock("./workflow-canvas/WorkflowRecipeEditor", () => ({ WorkflowRecipeEditor: () => null }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function teamRecipe(): NovelWorkflowRecipe {
  return {
    schemaVersion: 1,
    id: "team-recipe",
    name: "团队测试方案",
    commandId: "/novel:test",
    description: "",
    status: "published",
    revision: 1,
    maxRetries: 0,
    nodes: [
      { type: "start", id: "start" },
      { type: "step", id: "step-draft", kind: "writer-generate", label: "起草", enabled: true, agentId: "writer", executionMode: "subagent" },
      { type: "end", id: "end" },
    ],
    edges: [
      { id: "e1", source: "start", target: "step-draft", kind: "next" },
      { id: "e2", source: "step-draft", target: "end", kind: "next" },
    ],
  } as unknown as NovelWorkflowRecipe;
}

describe("WorkflowTimelinePanel 组建工人团队", () => {
  it("按当前方案调 ensure-workflow-team 并展示工人名单", async () => {
    const calls: { url: string; method: string; body?: unknown }[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      const json = (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
      if (url.endsWith("/workflow-recipes")) return json({ recipes: [teamRecipe()] });
      if (url.includes("/workflow-runs") && method === "GET") return json({ active: null, recent: [] });
      if (url.endsWith("/narrators/ensure-workflow-team")) {
        return json({
          recipeId: "team-recipe",
          recipeName: "团队测试方案",
          members: [
            { roleKey: "writer", title: "工作流工人·writer", narratorId: "n-1", created: true, stepIds: ["step-draft"] },
          ],
        });
      }
      return json({ summary: `unhandled ${method} ${url}` }, 404);
    });

    render(<WorkflowTimelinePanel bookId="book-team" currentChapter={1} />);

    const button = await screen.findByTestId("workflow-ensure-team");
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);

    const notice = await screen.findByTestId("workflow-team-notice");
    expect(notice.textContent).toContain("工作流工人·writer");
    expect(notice.textContent).toContain("新建 1");

    const ensure = calls.find((call) => call.url.endsWith("/narrators/ensure-workflow-team"));
    expect(ensure).toBeDefined();
    expect(ensure?.method).toBe("POST");
    expect(ensure?.body).toEqual({ recipeId: "team-recipe" });
    expect(ensure?.url).toContain("/api/books/book-team/narrators/ensure-workflow-team");
  });

  it("接口失败时给出作者可读的报错", async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const json = (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
      if (url.endsWith("/workflow-recipes")) return json({ recipes: [teamRecipe()] });
      if (url.includes("/workflow-runs") && method === "GET") return json({ active: null, recent: [] });
      if (url.endsWith("/narrators/ensure-workflow-team")) return json({ summary: "该书还没有就绪的叙述者" }, 409);
      return json({ summary: `unhandled ${method} ${url}` }, 404);
    });

    render(<WorkflowTimelinePanel bookId="book-team" currentChapter={1} />);
    const button = await screen.findByTestId("workflow-ensure-team");
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("组建工人团队失败");
    expect(alert.textContent).toContain("该书还没有就绪的叙述者");
    expect(screen.queryByTestId("workflow-team-notice")).toBeNull();
  });
});
