import {
  createRuntimeAdminRequest,
  encodePathSegment,
  jsonRequest,
  type OkResponse,
  type RuntimeAdminClientOptions,
} from "./client";

export type RoutineType = "command" | "skill" | "tool";
export type ProjectRoutineAction = "enable" | "disable" | "reset";
/** NarraFork 可选工具三档；本书覆盖另有「跟随全局」。 */
export type ToolRoutineMode = "manual" | "auto" | "resident";
export type ToolRoutineModeOverride = ToolRoutineMode | "global";

export interface RoutineStatus {
  readonly id: string;
  readonly type: RoutineType;
  readonly category: string;
  readonly name: string;
  readonly descriptionEn: string;
  readonly descriptionZh: string;
  readonly enabled: boolean;
  /** 可选工具套路的三档模式；命令、技能套路没有。 */
  readonly mode?: ToolRoutineMode;
  /** 产品贡献的套路自带中英文名；Runtime 自带套路没有，显示 name。 */
  readonly nameZh?: string;
  readonly nameEn?: string;
  /** 贡献该套路的产品（如 novelfork）；Runtime 自带套路没有。 */
  readonly providerId?: string;
  /** 可选工具套路包含的全部工具名。 */
  readonly toolNames?: readonly string[];
  /** 全局与项目都没设置时的档位。 */
  readonly defaultMode?: ToolRoutineMode;
}

export interface ProjectRoutineStatus extends RoutineStatus {
  readonly override: "global" | "enabled" | "disabled";
  readonly globalEnabled: boolean;
  /** 本书（Runtime 项目）层的工具套路覆盖，或 global 跟随全局。 */
  readonly modeOverride?: ToolRoutineModeOverride;
  readonly globalMode?: ToolRoutineMode;
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
