/**
 * Git 命令封装库
 * 提供安全的 Git 操作接口，防止命令注入
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";

const execFileAsync = promisify(execFile);

/**
 * Worktree 信息
 */
export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  bare: boolean;
}

/**
 * Git 状态信息
 */
export interface GitStatus {
  modified: string[];
  added: string[];
  deleted: string[];
  untracked: string[];
  hasChanges: boolean;
}

/**
 * 执行 Git 命令
 * @param args Git 命令参数
 * @param cwd 工作目录
 * @returns 命令输出
 */
export async function execGit(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    return stdout.trim();
  } catch (error: any) {
    const stderr = error.stderr || error.message;
    throw new Error(`Git command failed: ${stderr}`);
  }
}

/**
 * 验证分支名格式
 * @param branch 分支名
 * @returns 是否有效
 */
export function isValidBranchName(branch: string): boolean {
  // Git 分支名规则：字母、数字、斜杠、连字符、下划线、点
  // 不能以点开头，不能包含连续点，不能以斜杠结尾
  const pattern = /^(?!\.)[a-zA-Z0-9/_.-]+(?<!\/)$/;
  return pattern.test(branch) && !branch.includes("..");
}

/**
 * 将 Windows 路径转换为 Git 路径（正斜杠）
 * @param winPath Windows 路径
 * @returns Git 路径
 */
export function toGitPath(winPath: string): string {
  return winPath.replace(/\\/g, "/");
}

/**
 * 列出所有 worktrees
 * @param root 仓库根目录
 * @returns Worktree 列表
 */
export async function listWorktrees(root: string): Promise<WorktreeInfo[]> {
  const output = await execGit(["worktree", "list", "--porcelain"], root);

  const worktrees: WorktreeInfo[] = [];
  const lines = output.split("\n");

  let current: Partial<WorktreeInfo> = {};

  for (const line of lines) {
    if (line.startsWith("worktree ")) {
      current.path = line.substring(9);
    } else if (line.startsWith("HEAD ")) {
      current.head = line.substring(5);
    } else if (line.startsWith("branch ")) {
      current.branch = line.substring(7);
    } else if (line === "bare") {
      current.bare = true;
    } else if (line === "") {
      // 空行表示一个 worktree 结束
      if (current.path) {
        worktrees.push({
          path: current.path,
          branch: current.branch || "(detached)",
          head: current.head || "",
          bare: current.bare || false,
        });
      }
      current = {};
    }
  }

  // 处理最后一个 worktree（如果没有结尾空行）
  if (current.path) {
    worktrees.push({
      path: current.path,
      branch: current.branch || "(detached)",
      head: current.head || "",
      bare: current.bare || false,
    });
  }

  return worktrees;
}

/**
 * 创建 worktree
 * @param root 仓库根目录
 * @param name Worktree 名称
 * @param branch 分支名（可选，默认基于当前分支创建新分支）
 * @returns Worktree 路径
 */
export async function createWorktree(
  root: string,
  name: string,
  branch?: string
): Promise<string> {
  // 验证名称（防止路径遍历）
  if (name.includes("..") || name.includes("/") || name.includes("\\")) {
    throw new Error("Invalid worktree name: must not contain path separators");
  }

  // 验证分支名
  if (branch && !isValidBranchName(branch)) {
    throw new Error(`Invalid branch name: ${branch}`);
  }

  // Worktree 路径
  const worktreePath = path.join(root, ".inkos-worktrees", name);
  const gitPath = toGitPath(worktreePath);

  // 检查是否已存在
  const existing = await listWorktrees(root);
  if (existing.some(w => w.path === worktreePath)) {
    throw new Error(`Worktree already exists: ${name}`);
  }

  // 创建 worktree
  const args = ["worktree", "add"];

  if (branch) {
    // 使用指定分支
    args.push("-b", branch, gitPath);
  } else {
    // 基于当前分支创建新分支
    const newBranch = `worktree/${name}`;
    args.push("-b", newBranch, gitPath);
  }

  await execGit(args, root);

  return worktreePath;
}

/**
 * 删除 worktree
 * @param root 仓库根目录
 * @param worktreePath Worktree 路径
 * @param force 强制删除（忽略未提交更改）
 */
export async function removeWorktree(
  root: string,
  worktreePath: string,
  force = false
): Promise<void> {
  const args = ["worktree", "remove"];

  if (force) {
    args.push("--force");
  }

  args.push(toGitPath(worktreePath));

  await execGit(args, root);
}

/**
 * 获取 worktree 状态
 * @param worktreePath Worktree 路径
 * @returns Git 状态
 */
export async function getWorktreeStatus(worktreePath: string): Promise<GitStatus> {
  const output = await execGit(["status", "--porcelain"], worktreePath);

  const status: GitStatus = {
    modified: [],
    added: [],
    deleted: [],
    untracked: [],
    hasChanges: false,
  };

  if (!output) {
    return status;
  }

  status.hasChanges = true;

  for (const line of output.split("\n")) {
    if (!line) continue;

    const statusCode = line.substring(0, 2);
    const filePath = line.substring(3);

    // 解析状态码
    if (statusCode.includes("M")) {
      status.modified.push(filePath);
    } else if (statusCode.includes("A")) {
      status.added.push(filePath);
    } else if (statusCode.includes("D")) {
      status.deleted.push(filePath);
    } else if (statusCode === "??") {
      status.untracked.push(filePath);
    }
  }

  return status;
}

/**
 * 获取 diff
 * @param worktreePath Worktree 路径
 * @param base 基准分支/提交
 * @param target 目标分支/提交（默认 HEAD）
 * @returns Diff 输出
 */
export async function getDiff(
  worktreePath: string,
  base: string,
  target = "HEAD"
): Promise<string> {
  // 验证引用名
  if (!isValidBranchName(base) || !isValidBranchName(target)) {
    throw new Error("Invalid branch or commit reference");
  }

  return await execGit(["diff", `${base}...${target}`], worktreePath);
}

/**
 * 获取当前分支名
 * @param cwd 工作目录
 * @returns 分支名
 */
export async function getCurrentBranch(cwd: string): Promise<string> {
  return await execGit(["branch", "--show-current"], cwd);
}

/**
 * 检查是否在 Git 仓库中
 * @param cwd 工作目录
 * @returns 是否在仓库中
 */
export async function isGitRepository(cwd: string): Promise<boolean> {
  try {
    await execGit(["rev-parse", "--git-dir"], cwd);
    return true;
  } catch {
    return false;
  }
}
