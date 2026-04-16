/**
 * 测试环境配置
 * 设置 Mock、清理测试数据
 */

import { beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * 测试工作目录
 */
export const TEST_WORKSPACE = path.join(process.cwd(), ".test-workspace");

/**
 * 创建测试目录
 */
export async function setupTestWorkspace(): Promise<string> {
  await fs.mkdir(TEST_WORKSPACE, { recursive: true });
  return TEST_WORKSPACE;
}

/**
 * 清理测试目录
 */
export async function cleanupTestWorkspace(): Promise<void> {
  try {
    await fs.rm(TEST_WORKSPACE, { recursive: true, force: true });
  } catch (error) {
    // 忽略清理错误
  }
}

/**
 * 创建测试文件
 */
export async function createTestFile(
  relativePath: string,
  content: string
): Promise<string> {
  const fullPath = path.join(TEST_WORKSPACE, relativePath);
  const dir = path.dirname(fullPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(fullPath, content, "utf-8");
  return fullPath;
}

/**
 * 读取测试文件
 */
export async function readTestFile(relativePath: string): Promise<string> {
  const fullPath = path.join(TEST_WORKSPACE, relativePath);
  return await fs.readFile(fullPath, "utf-8");
}

/**
 * 检查文件是否存在
 */
export async function fileExists(relativePath: string): Promise<boolean> {
  try {
    const fullPath = path.join(TEST_WORKSPACE, relativePath);
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mock Git 命令
 * 用于测试 Worktree 功能
 */
export function mockGitCommands() {
  const mockExecFile = vi.fn((cmd: string, args: string[], callback: any) => {
    // Mock git worktree list
    if (args.includes("worktree") && args.includes("list")) {
      const output = `worktree ${TEST_WORKSPACE}
HEAD abc123def456
branch refs/heads/main

`;
      callback(null, { stdout: output, stderr: "" });
      return;
    }

    // Mock git worktree add
    if (args.includes("worktree") && args.includes("add")) {
      callback(null, { stdout: "", stderr: "" });
      return;
    }

    // Mock git worktree remove
    if (args.includes("worktree") && args.includes("remove")) {
      callback(null, { stdout: "", stderr: "" });
      return;
    }

    // Mock git status
    if (args.includes("status")) {
      callback(null, { stdout: "", stderr: "" });
      return;
    }

    // Mock git diff
    if (args.includes("diff")) {
      callback(null, { stdout: "", stderr: "" });
      return;
    }

    // Mock git branch
    if (args.includes("branch")) {
      callback(null, { stdout: "main\n", stderr: "" });
      return;
    }

    // Mock git rev-parse
    if (args.includes("rev-parse")) {
      callback(null, { stdout: ".git\n", stderr: "" });
      return;
    }

    // 默认成功
    callback(null, { stdout: "", stderr: "" });
  });

  return mockExecFile;
}

/**
 * 全局测试设置
 */
beforeEach(async () => {
  await setupTestWorkspace();
});

afterEach(async () => {
  await cleanupTestWorkspace();
  vi.clearAllMocks();
});
