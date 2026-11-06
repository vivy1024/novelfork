/** 工作流页用到的接口：方案、本书默认、运行。错误统一带作者能看懂的三段说明（服务端给什么就显示什么）。 */

export interface Explanation {
  readonly what: string;
  readonly why: string;
  readonly action: string;
}

export class WorkflowApiError extends Error {
  constructor(message: string, readonly code?: string, readonly explanation?: Explanation, readonly status?: number) {
    super(message);
    this.name = "WorkflowApiError";
  }
}

export async function workflowRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => null)) as
    | ({ error?: string; code?: string; summary?: string; explanation?: Explanation } & Record<string, unknown>)
    | null;
  if (!res.ok) {
    const explanation = body?.explanation;
    const message = explanation?.what ?? body?.summary ?? body?.error ?? `请求失败（${res.status}）`;
    throw new WorkflowApiError(message, body?.code ?? (typeof body?.error === "string" ? body.error : undefined), explanation, res.status);
  }
  return body as T;
}

export function jsonInit(method: "POST" | "PUT", body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export function bookApiBase(bookId: string): string {
  return `/api/books/${encodeURIComponent(bookId)}`;
}

export function errorExplanation(error: unknown): { message: string; explanation?: Explanation } {
  if (error instanceof WorkflowApiError) return { message: error.message, ...(error.explanation ? { explanation: error.explanation } : {}) };
  return { message: error instanceof Error ? error.message : "操作失败" };
}

export interface BookDefaultWorkflowView {
  readonly storedRecipeId: string | null;
  readonly recipeId: string | null;
  readonly recipeName: string | null;
  readonly notice?: Explanation;
}
