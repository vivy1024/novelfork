import { fetchJson, postApi, putApi } from "../../hooks/use-api";
import type { Routines } from "../../types/routines";
import { DEFAULT_ROUTINES } from "../../types/routines";

export type RoutinesScope = "global" | "project" | "merged";
export type EditableRoutinesScope = Exclude<RoutinesScope, "merged">;

interface RoutinesResponse {
  routines?: Routines | null;
}

function cloneDefaultRoutines(): Routines {
  return {
    commands: [...DEFAULT_ROUTINES.commands],
    tools: [...DEFAULT_ROUTINES.tools],
    permissions: [...DEFAULT_ROUTINES.permissions],
    globalSkills: [...DEFAULT_ROUTINES.globalSkills],
    projectSkills: [...DEFAULT_ROUTINES.projectSkills],
    subAgents: [...DEFAULT_ROUTINES.subAgents],
    globalPrompts: [...DEFAULT_ROUTINES.globalPrompts],
    systemPrompts: [...DEFAULT_ROUTINES.systemPrompts],
    mcpTools: [...DEFAULT_ROUTINES.mcpTools],
  };
}

function buildQuery(projectRoot?: string): string {
  if (!projectRoot) {
    return "";
  }
  return `?root=${encodeURIComponent(projectRoot)}`;
}

export async function fetchRoutines(scope: RoutinesScope, projectRoot?: string): Promise<Routines> {
  if (scope === "project" && !projectRoot) {
    throw new Error("Project root is required for project routines");
  }

  const path = scope === "global"
    ? "/routines/global"
    : scope === "project"
      ? `/routines/project${buildQuery(projectRoot)}`
      : `/routines/merged${buildQuery(projectRoot)}`;

  const response = await fetchJson<RoutinesResponse>(path);
  return response.routines ?? cloneDefaultRoutines();
}

export async function saveRoutines(
  scope: EditableRoutinesScope,
  routines: Routines,
  projectRoot?: string,
): Promise<void> {
  if (scope === "project" && !projectRoot) {
    throw new Error("Project root is required for project routines");
  }

  const path = scope === "global"
    ? "/routines/global"
    : `/routines/project${buildQuery(projectRoot)}`;

  await putApi(path, routines);
}

export async function resetRoutines(scope: EditableRoutinesScope, projectRoot?: string): Promise<Routines> {
  if (scope === "project" && !projectRoot) {
    throw new Error("Project root is required for project routines");
  }

  const response = await postApi<RoutinesResponse>("/routines/reset", {
    scope,
    projectRoot,
  });

  return response.routines ?? cloneDefaultRoutines();
}
