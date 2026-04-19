/**
 * Routines 服务 - 套路系统配置管理
 */

import { promises as fs } from "fs";
import path from "path";
import os from "os";
import type { Routines } from "../../types/routines.js";
import { DEFAULT_ROUTINES } from "../../types/routines.js";

const GLOBAL_CONFIG_DIR = path.join(os.homedir(), ".inkos");
const GLOBAL_ROUTINES_FILE = path.join(GLOBAL_CONFIG_DIR, "routines.json");
const PROJECT_ROUTINES_FILE = ".inkos/routines.json";

/**
 * 确保配置目录存在
 */
async function ensureConfigDir(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error) {
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
    return JSON.parse(content) as Routines;
  } catch (error) {
    // 文件不存在或解析失败，返回默认配置
    return { ...DEFAULT_ROUTINES };
  }
}

/**
 * 保存全局配置
 */
export async function saveGlobalRoutines(routines: Routines): Promise<void> {
  await ensureConfigDir(GLOBAL_CONFIG_DIR);
  await fs.writeFile(GLOBAL_ROUTINES_FILE, JSON.stringify(routines, null, 2), "utf-8");
}

/**
 * 加载项目配置
 */
export async function loadProjectRoutines(projectRoot: string): Promise<Routines | null> {
  try {
    const configPath = path.join(projectRoot, PROJECT_ROUTINES_FILE);
    const content = await fs.readFile(configPath, "utf-8");
    return JSON.parse(content) as Routines;
  } catch (error) {
    // 文件不存在，返回 null
    return null;
  }
}

/**
 * 保存项目配置
 */
export async function saveProjectRoutines(projectRoot: string, routines: Routines): Promise<void> {
  const configDir = path.join(projectRoot, ".inkos");
  await ensureConfigDir(configDir);
  const configPath = path.join(projectRoot, PROJECT_ROUTINES_FILE);
  await fs.writeFile(configPath, JSON.stringify(routines, null, 2), "utf-8");
}

/**
 * 合并全局和项目配置（项目配置优先）
 */
export function mergeRoutines(global: Routines, project: Routines | null): Routines {
  if (!project) {
    return global;
  }

  return {
    commands: [...global.commands, ...project.commands],
    tools: mergeTools(global.tools, project.tools),
    permissions: [...project.permissions, ...global.permissions], // 项目权限优先
    globalSkills: global.globalSkills,
    projectSkills: project.projectSkills,
    subAgents: [...global.subAgents, ...project.subAgents],
    globalPrompts: global.globalPrompts,
    systemPrompts: [...global.systemPrompts, ...project.systemPrompts],
    mcpTools: mergeTools(global.mcpTools, project.mcpTools),
  };
}

/**
 * 合并工具配置（项目配置覆盖全局配置）
 */
function mergeTools<T extends { name?: string; id?: string }>(
  global: T[],
  project: T[]
): T[] {
  const merged = [...global];

  for (const projectItem of project) {
    const key = projectItem.name ?? projectItem.id;
    const index = merged.findIndex((item) => (item.name ?? item.id) === key);

    if (index >= 0) {
      merged[index] = projectItem; // 覆盖
    } else {
      merged.push(projectItem); // 新增
    }
  }

  return merged;
}

/**
 * 重置为默认配置
 */
export async function resetRoutines(scope: "global" | "project", projectRoot?: string): Promise<Routines> {
  const defaultRoutines = { ...DEFAULT_ROUTINES };

  if (scope === "global") {
    await saveGlobalRoutines(defaultRoutines);
  } else if (projectRoot) {
    await saveProjectRoutines(projectRoot, defaultRoutines);
  }

  return defaultRoutines;
}
