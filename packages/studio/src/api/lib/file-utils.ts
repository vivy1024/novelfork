/**
 * 文件操作工具库
 * 封装 Node.js fs 操作，统一错误处理和路径验证
 */

import * as fs from "node:fs/promises";
import type { Stats } from "node:fs";
import * as path from "node:path";

/**
 * 验证路径是否在工作空间内
 * 防止路径遍历攻击
 */
export function validatePath(filePath: string, workspaceRoot: string): { valid: boolean; error?: string } {
  try {
    const resolved = path.resolve(workspaceRoot, filePath);
    const relative = path.relative(workspaceRoot, resolved);

    // 检查是否包含 ".."
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return {
        valid: false,
        error: `Path "${filePath}" is outside workspace root`,
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 读取文件内容
 */
export async function readFile(
  filePath: string,
  workspaceRoot: string,
  options?: {
    encoding?: BufferEncoding;
    offset?: number;
    limit?: number;
  }
): Promise<{ success: boolean; content?: string; error?: string }> {
  const validation = validatePath(filePath, workspaceRoot);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    const fullPath = path.resolve(workspaceRoot, filePath);
    const content = await fs.readFile(fullPath, options?.encoding || "utf-8");

    // 处理行范围
    if (options?.offset !== undefined || options?.limit !== undefined) {
      const lines = content.split("\n");
      const start = options.offset || 0;
      const end = options.limit ? start + options.limit : lines.length;
      const selectedLines = lines.slice(start, end);
      return { success: true, content: selectedLines.join("\n") };
    }

    return { success: true, content };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { success: false, error: `File not found: ${filePath}` };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 写入文件内容
 */
export async function writeFile(
  filePath: string,
  content: string,
  workspaceRoot: string,
  options?: {
    encoding?: BufferEncoding;
    createDirs?: boolean;
  }
): Promise<{ success: boolean; error?: string }> {
  const validation = validatePath(filePath, workspaceRoot);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    const fullPath = path.resolve(workspaceRoot, filePath);

    // 创建父目录
    if (options?.createDirs) {
      const dir = path.dirname(fullPath);
      await fs.mkdir(dir, { recursive: true });
    }

    await fs.writeFile(fullPath, content, options?.encoding || "utf-8");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 编辑文件内容（精确字符串替换）
 */
export async function editFile(
  filePath: string,
  oldString: string,
  newString: string,
  workspaceRoot: string,
  options?: {
    replaceAll?: boolean;
  }
): Promise<{ success: boolean; error?: string; replacements?: number }> {
  const validation = validatePath(filePath, workspaceRoot);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    const fullPath = path.resolve(workspaceRoot, filePath);
    const content = await fs.readFile(fullPath, "utf-8");

    // 检查 oldString 是否存在
    if (!content.includes(oldString)) {
      return {
        success: false,
        error: `String not found in file: "${oldString.slice(0, 50)}${oldString.length > 50 ? "..." : ""}"`,
      };
    }

    // 执行替换
    let newContent: string;
    let replacements = 0;

    if (options?.replaceAll) {
      const parts = content.split(oldString);
      replacements = parts.length - 1;
      newContent = parts.join(newString);
    } else {
      // 只替换第一个匹配
      const index = content.indexOf(oldString);
      newContent = content.slice(0, index) + newString + content.slice(index + oldString.length);
      replacements = 1;
    }

    // 写回文件
    await fs.writeFile(fullPath, newContent, "utf-8");

    return { success: true, replacements };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { success: false, error: `File not found: ${filePath}` };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 检查文件是否存在
 */
export async function fileExists(
  filePath: string,
  workspaceRoot: string
): Promise<{ exists: boolean; error?: string }> {
  const validation = validatePath(filePath, workspaceRoot);
  if (!validation.valid) {
    return { exists: false, error: validation.error };
  }

  try {
    const fullPath = path.resolve(workspaceRoot, filePath);
    await fs.access(fullPath);
    return { exists: true };
  } catch {
    return { exists: false };
  }
}

/**
 * 获取文件信息
 */
export async function getFileInfo(
  filePath: string,
  workspaceRoot: string
): Promise<{ success: boolean; info?: Stats; error?: string }> {
  const validation = validatePath(filePath, workspaceRoot);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    const fullPath = path.resolve(workspaceRoot, filePath);
    const info = await fs.stat(fullPath);
    return { success: true, info };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { success: false, error: `File not found: ${filePath}` };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
