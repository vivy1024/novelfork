import {
  createRuntimeAdminRequest,
  encodePath,
  encodePathSegment,
  jsonRequest,
  type OkResponse,
  type RuntimeAdminClientOptions,
  withQuery,
} from "./client";

export interface SkillSummary {
  readonly name: string;
  readonly description: string;
  readonly location: string;
  readonly files: readonly string[];
  readonly disabled?: boolean;
}

export interface Skill extends SkillSummary {
  readonly content: string;
}

export interface SkillInput {
  readonly name: string;
  readonly description: string;
  readonly content: string;
}

export interface SkillUpdateInput {
  readonly name?: string;
  readonly description: string;
  readonly content: string;
}

function projectPath(path: string, projectId: string): string {
  return withQuery(path, { projectId });
}

export function createSkillsClient(options: RuntimeAdminClientOptions = {}) {
  const request = createRuntimeAdminRequest(options);
  return {
    listGlobal: () => request<readonly SkillSummary[]>("/api/skills/global"),
    getGlobal: (name: string) =>
      request<Skill>(`/api/skills/global/${encodePathSegment(name)}`),
    createGlobal: (input: SkillInput) =>
      request<Skill>("/api/skills/global", jsonRequest("POST", input)),
    updateGlobal: (currentName: string, input: SkillInput) =>
      request<Skill>(
        `/api/skills/global/${encodePathSegment(currentName)}`,
        jsonRequest("PUT", input),
      ),
    deleteGlobal: (name: string) =>
      request<OkResponse>(`/api/skills/global/${encodePathSegment(name)}`, { method: "DELETE" }),
    toggleGlobal: (name: string, enabled: boolean) =>
      request<SkillSummary>(
        `/api/skills/global/${encodePathSegment(name)}/toggle`,
        jsonRequest("POST", { enabled }),
      ),
    listProject: (projectId: string) =>
      request<readonly SkillSummary[]>(projectPath("/api/skills", projectId)),
    getProject: (projectId: string, name: string) =>
      request<Skill>(projectPath(`/api/skills/${encodePathSegment(name)}`, projectId)),
    createProject: (projectId: string, input: SkillInput) =>
      request<Skill>(projectPath("/api/skills", projectId), jsonRequest("POST", input)),
    updateProject: (projectId: string, currentName: string, input: SkillUpdateInput) =>
      request<Skill>(
        projectPath(`/api/skills/${encodePathSegment(currentName)}`, projectId),
        jsonRequest("PUT", input),
      ),
    deleteProject: (projectId: string, name: string) =>
      request<OkResponse>(projectPath(`/api/skills/${encodePathSegment(name)}`, projectId), {
        method: "DELETE",
      }),
    readProjectFile: (projectId: string, name: string, filePath: string) =>
      request<{ readonly content: string }>(
        projectPath(
          `/api/skills/${encodePathSegment(name)}/files/${encodePath(filePath)}`,
          projectId,
        ),
      ),
  } as const;
}
