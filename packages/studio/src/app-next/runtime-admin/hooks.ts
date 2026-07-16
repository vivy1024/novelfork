import {
  createRuntimeAdminRequest,
  encodePathSegment,
  jsonRequest,
  type OkResponse,
  type RuntimeAdminClientOptions,
  withQuery,
} from "./client";

export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "Stop"
  | "Attention"
  | "AttentionResolved";
export type HookType = "command" | "http";
export type HookProxyMode = "default" | "direct" | "system" | "custom";

export interface RuntimeHook {
  readonly id: string;
  readonly projectId: string | null;
  readonly event: HookEvent;
  readonly matcher: string;
  readonly type: HookType;
  readonly command: string | null;
  readonly url: string | null;
  readonly headers: Readonly<Record<string, string>> | null;
  readonly proxyMode: HookProxyMode | null;
  readonly proxyUrl: string | null;
  readonly prompt: string | null;
  readonly model: string | null;
  readonly timeout: number;
  readonly enabled: boolean;
  readonly sortOrder: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface HookInputBase {
  readonly projectId?: string;
  readonly event: HookEvent;
  readonly matcher?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly proxyMode?: HookProxyMode;
  readonly proxyUrl?: string;
  readonly timeout?: number;
  readonly enabled?: boolean;
  readonly sortOrder?: number;
}

export type CreateHookInput =
  | (HookInputBase & { readonly type: "command"; readonly command: string; readonly url?: never })
  | (HookInputBase & { readonly type: "http"; readonly url: string; readonly command?: never });

export interface UpdateHookInput {
  readonly event?: HookEvent;
  readonly matcher?: string;
  readonly type?: HookType;
  readonly command?: string | null;
  readonly url?: string | null;
  readonly headers?: Readonly<Record<string, string>> | null;
  readonly proxyMode?: HookProxyMode | null;
  readonly proxyUrl?: string | null;
  readonly timeout?: number;
  readonly enabled?: boolean;
  readonly sortOrder?: number;
}

export function createHooksClient(options: RuntimeAdminClientOptions = {}) {
  const request = createRuntimeAdminRequest(options);
  return {
    list: (projectId?: string) =>
      request<readonly RuntimeHook[]>(withQuery("/api/hooks", { projectId })),
    listGlobal: () => request<readonly RuntimeHook[]>("/api/hooks"),
    listAll: () => request<readonly RuntimeHook[]>("/api/hooks/all"),
    get: (id: string) => request<RuntimeHook>(`/api/hooks/${encodePathSegment(id)}`),
    create: (input: CreateHookInput) =>
      request<RuntimeHook>("/api/hooks", jsonRequest("POST", input)),
    update: (id: string, input: UpdateHookInput) =>
      request<RuntimeHook>(
        `/api/hooks/${encodePathSegment(id)}`,
        jsonRequest("PUT", input),
      ),
    delete: (id: string) =>
      request<OkResponse>(`/api/hooks/${encodePathSegment(id)}`, { method: "DELETE" }),
  } as const;
}
