import {
  createRuntimeAdminRequest,
  encodePathSegment,
  jsonRequest,
  type OkResponse,
  type RuntimeAdminClientOptions,
} from "./client";

export type CustomSubagentToolAccess = "readOnly" | "general" | "custom";

export interface CustomSubagent {
  readonly name: string;
  readonly description: string;
  readonly toolAccess: CustomSubagentToolAccess;
  readonly customTools: readonly string[];
  readonly defaultModel: string;
  readonly prompt: string;
}

export type CustomSubagentInput = CustomSubagent;

export function createCustomSubagentsClient(options: RuntimeAdminClientOptions = {}) {
  const request = createRuntimeAdminRequest(options);
  return {
    list: () => request<readonly CustomSubagent[]>("/api/custom-subagents"),
    get: (name: string) =>
      request<CustomSubagent>(`/api/custom-subagents/${encodePathSegment(name)}`),
    create: (input: CustomSubagentInput) =>
      request<CustomSubagent>("/api/custom-subagents", jsonRequest("POST", input)),
    update: (currentName: string, input: CustomSubagentInput) =>
      request<CustomSubagent>(
        `/api/custom-subagents/${encodePathSegment(currentName)}`,
        jsonRequest("PUT", input),
      ),
    delete: (name: string) =>
      request<OkResponse>(`/api/custom-subagents/${encodePathSegment(name)}`, {
        method: "DELETE",
      }),
  } as const;
}
