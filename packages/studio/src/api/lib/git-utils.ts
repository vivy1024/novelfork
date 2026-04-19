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
  const worktreePath = path.join(root, ".novelfork-worktrees", name);
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
 * 获取单个文件的 diff
 * @param worktreePath Worktree 路径
 * @param filePath 文件路径
 * @returns Diff 输出
 */
export async function getFileDiff(
  worktreePath: string,
  filePath: string
): Promise<string> {
  // 验证文件路径（防止路径遍历）
  if (filePath.includes("..")) {
    throw new Error("Invalid file path: path traversal not allowed");
  }

  // 获取文件相对于 HEAD 的 diff
  try {
    return await execGit(["diff", "HEAD", "--", filePath], worktreePath);
  } catch (error) {
    // 如果文件是新增的（untracked），尝试显示完整内容
    try {
      const content = await execGit(["show", `:0:${filePath}`], worktreePath);
      // 构造一个伪 diff 格式
      const lines = content.split("\n");
      const diffLines = lines.map((line, i) => `+${line}`);
      return `@@ -0,0 +1,${lines.length} @@\n${diffLines.join("\n")}`;
    } catch {
      // 如果是未跟踪文件，返回空 diff
      return "";
    }
  }
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

/**
 * 合并分支到当前分支
 * @param cwd 工作目录
 * @param sourceBranch 源分支名
 * @param noFf 禁用快进合并（默认 true，保留合并历史）
 * @returns 合并结果信息
 */
export async function mergeBranch(
  cwd: string,
  sourceBranch: string,
  noFf = true
): Promise<{ success: boolean; message: string }> {
  if (!isValidBranchName(sourceBranch)) {
    throw new Error(`Invalid branch name: ${sourceBranch}`);
  }

  try {
    const args = ["merge"];
    if (noFf) {
      args.push("--no-ff");
    }
    args.push(sourceBranch);

    const output = await execGit(args, cwd);
    return { success: true, message: output || "Merge completed successfully" };
  } catch (error: any) {
    const message = error.message || "Merge failed";
    if (message.includes("CONFLICT")) {
      return { success: false, message: "Merge conflict detected. Please resolve conflicts manually." };
    }
    throw error;
  }
}

/**
 * 从当前分支创建新分支（Fork）
 * @param cwd 工作目录
 * @param newBranch 新分支名
 * @returns 新分支名
 */
export async function forkBranch(cwd: string, newBranch: string): Promise<string> {
  if (!isValidBranchName(newBranch)) {
    throw new Error(`Invalid branch name: ${newBranch}`);
  }

  // 检查分支是否已存在
  try {
    await execGit(["rev-parse", "--verify", newBranch], cwd);
    throw new Error(`Branch already exists: ${newBranch}`);
  } catch (error: any) {
    // 分支不存在，继续创建
    if (!error.message.includes("Branch already exists")) {
      // 预期的错误（分支不存在），继续
    } else {
      throw error;
    }
  }

  await execGit(["checkout", "-b", newBranch], cwd);
  return newBranch;
}
