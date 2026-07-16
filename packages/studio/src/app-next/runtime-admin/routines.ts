import {
  createRuntimeAdminRequest,
  encodePathSegment,
  jsonRequest,
  type OkResponse,
  type RuntimeAdminClientOptions,
} from "./client";

export type RoutineType = "command" | "skill" | "tool";
export type ProjectRoutineAction = "enable" | "disable" | "reset";

export interface RoutineStatus {
  readonly id: string;
  readonly type: RoutineType;
  readonly category: string;
  readonly name: string;
  readonly descriptionEn: string;
  readonly descriptionZh: string;
  readonly enabled: boolean;
}

export interface ProjectRoutineStatus extends RoutineStatus {
  readonly override: "global" | "enabled" | "disabled";
  readonly globalEnabled: boolean;
}

export interface GlobalPromptCandidate {
  readonly path: string;
  readonly exists: boolean;
}

export interface GlobalPromptResult {
  readonly content: string | null;
  readonly filePath: string | null;
  readonly candidates: readonly GlobalPromptCandidate[];
}

export function createRoutinesClient(options: RuntimeAdminClientOptions = {}) {
  const request = createRuntimeAdminRequest(options);
  return {
    listGlobal: () => request<{ readonly routines: readonly RoutineStatus[] }>("/api/routines"),
    toggleGlobal: (routineId: string, enabled: boolean) =>
      request<OkResponse>(
        `/api/routines/${encodePathSegment(routineId)}/toggle`,
        jsonRequest("POST", { enabled }),
      ),
    listProject: (projectId: string) =>
      request<{ readonly routines: readonly ProjectRoutineStatus[] }>(
        `/api/routines/project/${encodePathSegment(projectId)}`,
      ),
    toggleProject: (projectId: string, routineId: string, action: ProjectRoutineAction) =>
      request<OkResponse>(
        `/api/routines/project/${encodePathSegment(projectId)}/${encodePathSegment(routineId)}/toggle`,
        jsonRequest("POST", { action }),
      ),
    getGlobalPrompt: () => request<GlobalPromptResult>("/api/routines/global-prompt"),
    putGlobalPrompt: (content: string, filePath?: string) =>
      request<{ readonly ok: true; readonly filePath: string }>(
        "/api/routines/global-prompt",
        jsonRequest("PUT", { content, ...(filePath !== undefined ? { filePath } : {}) }),
      ),
  } as const;
}
