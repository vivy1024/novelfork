// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FANQIE_XUANHUAN_SERIAL_RECIPE } from "../../../engine/workflows/novel-workflows.js";
import type { WorkflowGraphRecipe } from "../../../engine/workflows/workflow-graph.js";
import { blankRecipe } from "./workflow-canvas-model";
import { WorkflowRecipeEditor } from "./WorkflowRecipeEditor";

type FetchCall = { url: string; method: string; body: any };

const CATALOG_URLS = ["/subagents", "/api/custom-subagents", "/api/providers/models", "/api/writing-skills", "/runtime/skills"];

function isCatalogGet(call: FetchCall): boolean {
  return call.method === "GET" && CATALOG_URLS.some((suffix) => call.url.endsWith(suffix));
}

function mockFetch(respond: (call: FetchCall) => { status?: number; body: unknown }) {
  const calls: FetchCall[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const call = { url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined };
    const isBgCatalog = isCatalogGet(call);
    if (!isBgCatalog) calls.push(call);
    try {
      const { status = 200, body } = respond(call);
      return { ok: status < 400, status, json: async () => body };
    } catch (err) {
      if (isBgCatalog) return { ok: false, status: 404, json: async () => null };
      throw err;
    }
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

  it("委派子代理工序支持下拉直选内置与本书定制子代理，并可填模型覆盖", async () => {
    mockFetch((call) => {
      if (call.url.endsWith("/subagents")) {
        return { body: { custom: [{ id: "paced-critic", nameZh: "节奏把关（定制）" }] } };
      }
      return { body: { ok: true } };
    });
    renderEditor(savedDraft);
    fireEvent.click(screen.getByRole("button", { name: "工序" }));
    fireEvent.change(screen.getByLabelText("由谁执行"), { target: { value: "subagent" } });
    const select = (await screen.findByLabelText("子代理")) as HTMLSelectElement;
    await waitFor(() => expect(Array.from(select.options).some((o) => o.value === "paced-critic")).toBe(true));
    fireEvent.change(select, { target: { value: "paced-critic" } });
    expect(select.value).toBe("paced-critic");
    const modelInput = screen.getByLabelText("指定模型覆盖") as HTMLInputElement;
    fireEvent.change(modelInput, { target: { value: "4sapi-2:glm-5.3" } });
    fireEvent.blur(modelInput);
    expect(modelInput.value).toBe("4sapi-2:glm-5.3");
  });

  it("动态接入 Runtime 模型、全局子代理、Skills 与权威写入工具目录，支持并行子代理与提示词预设", async () => {
    const calls = mockFetch((call) => {
      if (call.url.endsWith("/api/books/book-1/subagents")) {
        return { body: { custom: [{ id: "paced-critic", nameZh: "节奏把关" }] } };
      }
      if (call.url.endsWith("/api/custom-subagents")) {
        return { body: [{ name: "global-polisher", description: "全局精修师" }] };
      }
      if (call.url.endsWith("/api/providers/models")) {
        return {
          body: {
            models: [
              { providerId: "4sapi-2", providerName: "4SAPI", modelId: "deepseek-v4.1-flash", modelName: "DeepSeek V4.1", enabled: true },
              { providerId: "disabled-p", modelId: "old-model", enabled: false },
            ],
          },
        };
      }
      if (call.url.endsWith("/api/writing-skills")) {
        return {
          body: {
            skills: [
              { id: "nf-golden-opening", slug: "nf-golden-opening", name: "黄金三章", description: "开篇前三章留存策略", kind: "opening" },
              { id: "nf-de-ai-rewrite", slug: "nf-de-ai-rewrite", name: "去AI味重写", description: "四维病灶拆洗", kind: "revision" },
            ],
          },
        };
      }
      if (call.url.endsWith("/runtime/skills")) {
        return {
          body: {
            skills: [
              { name: "黄金三章", description: "重复项应按 name 去重" },
              { name: "本书专属设定表", description: "Runtime 项目技能", kind: "project" },
            ],
          },
        };
      }
      return { body: { ok: true, recipe: { ...call.body?.recipe, revision: 3 }, issues: [] } };
    });

    const { props } = renderEditor(savedDraft);
    fireEvent.click(screen.getByRole("button", { name: "工序" }));

    // 1. 叙述者本人执行模式下也能直选 Runtime 模型覆盖（过滤掉 enabled=false）
    const modelQuickSelect = (await screen.findByLabelText("从 Runtime 模型快选")) as HTMLSelectElement;
    await waitFor(() => expect(Array.from(modelQuickSelect.options).some((o) => o.value === "4sapi-2:deepseek-v4.1-flash")).toBe(true));
    expect(Array.from(modelQuickSelect.options).some((o) => o.value.includes("old-model"))).toBe(false);
    fireEvent.change(modelQuickSelect, { target: { value: "4sapi-2:deepseek-v4.1-flash" } });
    expect((screen.getByLabelText("指定模型覆盖") as HTMLInputElement).value).toBe("4sapi-2:deepseek-v4.1-flash");

    // 2. 切换到委派子代理：同时展示内置、本书定制与 Runtime 全局子代理，并配置并行子代理
    fireEvent.change(screen.getByLabelText("由谁执行"), { target: { value: "subagent" } });
    const agentSelect = (await screen.findByLabelText("子代理")) as HTMLSelectElement;
    const optionTexts = Array.from(agentSelect.options).map((o) => `${o.value}:${o.textContent}`);
    expect(optionTexts.some((t) => t.includes("nf-script-director:") && t.includes("内置"))).toBe(true);
    expect(optionTexts.some((t) => t.includes("paced-critic:") && t.includes("本书定制"))).toBe(true);
    expect(optionTexts.some((t) => t.includes("global-polisher:") && t.includes("Runtime全局"))).toBe(true);
    fireEvent.change(agentSelect, { target: { value: "global-polisher" } });

    fireEvent.click(screen.getByLabelText("添加并行子代理"));
    const parallelName = screen.getByLabelText("第 1 个并行子代理名称") as HTMLInputElement;
    fireEvent.change(parallelName, { target: { value: "action-choreographer" } });
    fireEvent.blur(parallelName);

    // 3. 权威写入工具胶囊点选与输入框双向同步
    const pipelineChip = screen.getByRole("button", { name: /写章落盘 · pipeline\.write/ });
    fireEvent.click(pipelineChip);
    expect((screen.getByLabelText("可用的写入工具") as HTMLInputElement).value).toContain("pipeline.write");

    // 4. Skills 搜索点选（精确使用 skill.name 而非 slug）与 Badge 移除
    const skillSearch = await screen.findByLabelText("搜索可用技能");
    fireEvent.change(skillSearch, { target: { value: "黄金" } });
    fireEvent.click(screen.getByRole("button", { name: /黄金三章/ }));
    expect((screen.getByLabelText("技能") as HTMLInputElement).value).toBe("黄金三章");
    fireEvent.change(skillSearch, { target: { value: "本书专属" } });
    fireEvent.click(screen.getByRole("button", { name: /本书专属设定表/ }));
    expect((screen.getByLabelText("技能") as HTMLInputElement).value).toBe("黄金三章，本书专属设定表");
    fireEvent.click(screen.getByLabelText("移除技能 黄金三章"));
    expect((screen.getByLabelText("技能") as HTMLInputElement).value).toBe("本书专属设定表");

    // 5. 一键套用工序提示词预设模板
    const presetSelect = screen.getByLabelText("套用提示词预设") as HTMLSelectElement;
    fireEvent.change(presetSelect, { target: { value: "tomato-golden-opening-blueprint" } });
    expect((screen.getByLabelText("附加要求") as HTMLTextAreaElement).value).toContain("前 300 字");

    // 6. 保存验证完整结构入库
    fireEvent.click(screen.getByRole("button", { name: /保存草稿/ }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    const savedStep = calls[0]!.body.recipe.nodes.find((n: { id: string }) => n.id === "step-1");
    expect(savedStep).toMatchObject({
      executionMode: "subagent",
      agentId: "global-polisher",
      modelOverride: "4sapi-2:deepseek-v4.1-flash",
      tools: ["pipeline.write"],
      skills: ["本书专属设定表"],
      parallelSubagents: [{ name: "action-choreographer" }],
    });
  });
});
