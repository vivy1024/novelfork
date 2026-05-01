/**
 * Routines 服务 - 套路系统配置管理
 */

import { promises as fs } from "fs";
import path from "path";
import os from "os";
import type { Routines } from "../../types/routines.js";
import { DEFAULT_ROUTINES } from "../../types/routines.js";

const GLOBAL_CONFIG_DIR = path.join(os.homedir(), ".novelfork");
const GLOBAL_ROUTINES_FILE = path.join(GLOBAL_CONFIG_DIR, "routines.json");
const PROJECT_ROUTINES_FILE = ".novelfork/routines.json";

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
    hooks: [...DEFAULT_ROUTINES.hooks],
  };
}

export function normalizeRoutines(input: Partial<Routines> | null | undefined): Routines {
  const fallback = cloneDefaultRoutines();
  const source = input ?? {};

  return {
    commands: Array.isArray(source.commands) ? [...source.commands] : fallback.commands,
    tools: Array.isArray(source.tools) ? [...source.tools] : fallback.tools,
    permissions: Array.isArray(source.permissions) ? [...source.permissions] : fallback.permissions,
    globalSkills: Array.isArray(source.globalSkills) ? [...source.globalSkills] : fallback.globalSkills,
    projectSkills: Array.isArray(source.projectSkills) ? [...source.projectSkills] : fallback.projectSkills,
    subAgents: Array.isArray(source.subAgents) ? [...source.subAgents] : fallback.subAgents,
    globalPrompts: Array.isArray(source.globalPrompts) ? [...source.globalPrompts] : fallback.globalPrompts,
    systemPrompts: Array.isArray(source.systemPrompts) ? [...source.systemPrompts] : fallback.systemPrompts,
    mcpTools: Array.isArray(source.mcpTools) ? [...source.mcpTools] : fallback.mcpTools,
    hooks: Array.isArray(source.hooks) ? [...source.hooks] : fallback.hooks,
  };
}

/**
 * 确保配置目录存在
 */
async function ensureConfigDir(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // 目录已存在，忽略错误
  }
}

/**
 * 加载全局配置
 */
export async function loadGlobalRoutines(): Promise<Routines> {
  try {
    await ensureConfigDir(GLOBAL_CONFIG_DIR);
    const content = await fs.readFile(GLOBAL_ROUTINES_FILE, "utf-8");
    return normalizeRoutines(JSON.parse(content) as Partial<Routines>);
  } catch {
    // 文件不存在或解析失败，返回默认配置
    return cloneDefaultRoutines();
  }
}

/**
 * 保存全局配置
 */
export async function saveGlobalRoutines(routines: Routines): Promise<void> {
  await ensureConfigDir(GLOBAL_CONFIG_DIR);
  await fs.writeFile(GLOBAL_ROUTINES_FILE, JSON.stringify(normalizeRoutines(routines), null, 2), "utf-8");
}

/**
 * 加载项目配置
 */
export async function loadProjectRoutines(projectRoot: string): Promise<Routines | null> {
  try {
    const configPath = path.join(projectRoot, PROJECT_ROUTINES_FILE);
    const content = await fs.readFile(configPath, "utf-8");
    return normalizeRoutines(JSON.parse(content) as Partial<Routines>);
  } catch {
    // 文件不存在，返回 null
    return null;
  }
}

/**
 * 保存项目配置
 */
export async function saveProjectRoutines(projectRoot: string, routines: Routines): Promise<void> {
  const configDir = path.join(projectRoot, ".novelfork");
  await ensureConfigDir(configDir);
  const configPath = path.join(projectRoot, PROJECT_ROUTINES_FILE);
  await fs.writeFile(configPath, JSON.stringify(normalizeRoutines(routines), null, 2), "utf-8");
}

/**
 * 合并全局和项目配置（项目配置优先）
 */
export function mergeRoutines(global: Routines, project: Routines | null): Routines {
  const globalRoutines = normalizeRoutines(global);
  if (!project) {
    return globalRoutines;
  }

  const projectRoutines = normalizeRoutines(project);

  return {
    commands: mergeByKey(globalRoutines.commands, projectRoutines.commands, (item) => item.id),
    tools: mergeByKey(globalRoutines.tools, projectRoutines.tools, (item) => item.name),
    permissions: mergeByKey(
      globalRoutines.permissions,
      projectRoutines.permissions,
      (item) => `${item.tool}::${item.pattern ?? ""}`,
    ),
    globalSkills: [...globalRoutines.globalSkills],
    projectSkills: [...projectRoutines.projectSkills],
    subAgents: mergeByKey(globalRoutines.subAgents, projectRoutines.subAgents, (item) => item.id),
    globalPrompts: [...globalRoutines.globalPrompts],
    systemPrompts: mergeByKey(globalRoutines.systemPrompts, projectRoutines.systemPrompts, (item) => item.id),
    mcpTools: mergeByKey(globalRoutines.mcpTools, projectRoutines.mcpTools, (item) => item.id),
    hooks: mergeByKey(globalRoutines.hooks, projectRoutines.hooks, (item) => item.id),
  };
}

function mergeByKey<T>(globalItems: T[], projectItems: T[], getKey: (item: T) => string | undefined): T[] {
  const merged = [...globalItems];

  for (const projectItem of projectItems) {
    const key = getKey(projectItem);
    if (!key) {
      merged.push(projectItem);
      continue;
    }

    const index = merged.findIndex((item) => getKey(item) === key);
    if (index >= 0) {
      merged[index] = projectItem;
    } else {
      merged.push(projectItem);
    }
  }

  return merged;
}

/**
 * 重置为默认配置
 */
export async function resetRoutines(scope: "global" | "project", projectRoot?: string): Promise<Routines> {
  const defaultRoutines = cloneDefaultRoutines();

  if (scope === "global") {
    await saveGlobalRoutines(defaultRoutines);
  } else if (projectRoot) {
    await saveProjectRoutines(projectRoot, defaultRoutines);
  }

  return defaultRoutines;
}
