import { describe, expect, it, vi } from "vitest";
import { createWorkflowClient } from "./workflow-client";
import {
  DEFAULT_WRITE_NEXT_RECIPE,
  DEFAULT_AUDIT_RECIPE,
  type WorkflowRecipeConfig,
} from "../../shared/workflow-recipe";

describe("workflow-client", () => {
  it("无 bookId 时返回内置默认流水线预设", async () => {
    const mockFetch = vi.fn();
    const client = createWorkflowClient(mockFetch);
    const result = await client.list();

    expect(result).toEqual([DEFAULT_WRITE_NEXT_RECIPE, DEFAULT_AUDIT_RECIPE]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("有 bookId 时通过 GET 请求正确拉取并携带 signal", async () => {
    const customRecipe: WorkflowRecipeConfig = {
      id: "custom-1",
      name: "自定义流",
      commandId: "/novel:custom",
      description: "自定义描述",
      steps: [],
      resultStrategy: "formal-chapter",
      requireFinalApproval: true,
      maxRetries: 1,
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ recipes: [customRecipe] }),
    });

    const client = createWorkflowClient(mockFetch);
    const controller = new AbortController();
    const result = await client.list("book-xyz", controller.signal);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/books/book-xyz/workflow-recipes",
      { signal: controller.signal }
    );
    expect(result).toEqual([customRecipe]);
  });

  it("当后端返回非 200 状态码时抛出包含状态码的错误", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    const client = createWorkflowClient(mockFetch);
    await expect(client.list("book-not-found")).rejects.toThrow(
      "加载工作流配置失败: HTTP 404"
    );
  });

  it("save 时通过 PUT 请求发送 recipes 并返回落盘数据", async () => {
    const recipes: WorkflowRecipeConfig[] = [
      {
        id: "recipe-save",
        name: "保存流",
        commandId: "/novel:save",
        description: "",
        steps: [],
        resultStrategy: "formal-chapter",
        requireFinalApproval: false,
        maxRetries: 0,
      },
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, recipes }),
    });

    const client = createWorkflowClient(mockFetch);
    const saved = await client.save("book-123", recipes);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/books/book-123/workflow-recipes",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipes }),
      })
    );
    expect(saved).toEqual(recipes);
  });

  it("save 遇到服务器错误时抛出异常", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const client = createWorkflowClient(mockFetch);
    await expect(client.save("book-123", [])).rejects.toThrow(
      "保存工作流失败: HTTP 500"
    );
  });

  it("支持 options 对象传参方式 { fetch: mockFetch } 并正确发起请求", async () => {
    const customRecipe: WorkflowRecipeConfig = {
      id: "opt-1",
      name: "选项传参流",
      commandId: "/novel:opt",
      description: "",
      steps: [],
      resultStrategy: "formal-chapter",
      requireFinalApproval: false,
      maxRetries: 0,
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ recipes: [customRecipe] }),
    });

    const client = createWorkflowClient({ fetch: mockFetch });
    const result = await client.list("book-opts");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/books/book-opts/workflow-recipes",
      { signal: undefined }
    );
    expect(result).toEqual([customRecipe]);
  });
});
