import {
  DEFAULT_WRITE_NEXT_RECIPE,
  DEFAULT_AUDIT_RECIPE,
  type WorkflowRecipeConfig,
} from "../../shared/workflow-recipe";

export type WorkflowClientFetch = typeof fetch;

export interface WorkflowClientOptions {
  readonly fetch?: WorkflowClientFetch;
}

export interface WorkflowClient {
  readonly list: (
    bookId?: string,
    signal?: AbortSignal
  ) => Promise<readonly WorkflowRecipeConfig[]>;
  readonly save: (
    bookId: string,
    recipes: readonly WorkflowRecipeConfig[],
    signal?: AbortSignal
  ) => Promise<readonly WorkflowRecipeConfig[]>;
}

export function createWorkflowClient(
  fetchOrOptions?: WorkflowClientFetch | WorkflowClientOptions,
): WorkflowClient {
  const customFetch: WorkflowClientFetch =
    typeof fetchOrOptions === "function"
      ? fetchOrOptions
      : fetchOrOptions?.fetch ?? fetch;

  return {
    list: async (
      bookId?: string,
      signal?: AbortSignal
    ): Promise<readonly WorkflowRecipeConfig[]> => {
      if (!bookId) {
        return [DEFAULT_WRITE_NEXT_RECIPE, DEFAULT_AUDIT_RECIPE];
      }
      const res = await customFetch(
        `/api/books/${encodeURIComponent(bookId)}/workflow-recipes`,
        { signal }
      );
      if (!res.ok) {
        throw new Error(`加载工作流配置失败: HTTP ${res.status}`);
      }
      const data = (await res.json()) as { recipes?: readonly WorkflowRecipeConfig[] };
      return Array.isArray(data.recipes) && data.recipes.length > 0
        ? data.recipes
        : [DEFAULT_WRITE_NEXT_RECIPE, DEFAULT_AUDIT_RECIPE];
    },

    save: async (
      bookId: string,
      recipes: readonly WorkflowRecipeConfig[],
      signal?: AbortSignal
    ): Promise<readonly WorkflowRecipeConfig[]> => {
      const res = await customFetch(
        `/api/books/${encodeURIComponent(bookId)}/workflow-recipes`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipes }),
          signal,
        }
      );
      if (!res.ok) {
        throw new Error(`保存工作流失败: HTTP ${res.status}`);
      }
      const data = (await res.json()) as { recipes?: readonly WorkflowRecipeConfig[] };
      return data.recipes ?? recipes;
    },
  };
}


