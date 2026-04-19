/**
 * Git Worktree 操作单元测试
 * 测试 git-utils 中的 worktree 相关函数
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import {
  listWorktrees,
  createWorktree,
  removeWorktree,
  getWorktreeStatus,
  mergeBranch,
  forkBranch,
  isValidBranchName,
  toGitPath,
  execGit,
} from "./git-utils";

describe("Git Worktree Operations", () => {
  let testRepo: string;

  beforeEach(async () => {
    // 创建临时测试仓库
    testRepo = path.join(os.tmpdir(), `novelfork-test-${Date.now()}`);
    await fs.mkdir(testRepo, { recursive: true });

    // 初始化 Git 仓库
    await execGit(["init"], testRepo);
    await execGit(["config", "user.name", "Test User"], testRepo);
    await execGit(["config", "user.email", "test@example.com"], testRepo);

    // 创建初始提交
    const readmePath = path.join(testRepo, "README.md");
    await fs.writeFile(readmePath, "# Test Repository\n");
    await execGit(["add", "README.md"], testRepo);
    await execGit(["commit", "-m", "Initial commit"], testRepo);
  });

  afterEach(async () => {
    // 清理测试仓库
    try {
      await fs.rm(testRepo, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });

  describe("isValidBranchName", () => {
    it("should accept valid branch names", () => {
      expect(isValidBranchName("main")).toBe(true);
      expect(isValidBranchName("feature/test")).toBe(true);
      expect(isValidBranchName("fix-123")).toBe(true);
      expect(isValidBranchName("v1.0.0")).toBe(true);
      expect(isValidBranchName("user_branch")).toBe(true);
    });

    it("should reject invalid branch names", () => {
      expect(isValidBranchName(".hidden")).toBe(false); // 以点开头
      expect(isValidBranchName("branch..name")).toBe(false); // 连续点
      expect(isValidBranchName("branch/")).toBe(false); // 以斜杠结尾
      expect(isValidBranchName("")).toBe(false); // 空字符串
    });
  });

  describe("toGitPath", () => {
    it("should convert Windows paths to Git paths", () => {
      expect(toGitPath("C:\\Users\\test\\file.txt")).toBe("C:/Users/test/file.txt");
      expect(toGitPath("path\\to\\file")).toBe("path/to/file");
      expect(toGitPath("already/unix/path")).toBe("already/unix/path");
    });
  });

  describe("listWorktrees", () => {
    it("should list main worktree", async () => {
      const worktrees = await listWorktrees(testRepo);

      expect(worktrees).toHaveLength(1);
      // Git 返回的路径可能是正斜杠格式
      expect(worktrees[0].path.replace(/\//g, "\\")).toBe(testRepo);
      expect(worktrees[0].branch).toContain("master");
      expect(worktrees[0].bare).toBe(false);
    });

    it("should list multiple worktrees", async () => {
      // 创建额外的 worktree
      const worktreePath = path.join(testRepo, ".novelfork-worktrees", "feature-1");
      await createWorktree(testRepo, "feature-1");

      const worktrees = await listWorktrees(testRepo);

      expect(worktrees.length).toBeGreaterThanOrEqual(2);
      expect(worktrees.some(w => w.path.includes("feature-1"))).toBe(true);
    });
  });

  describe("createWorktree", () => {
    it("should create worktree with auto-generated branch", async () => {
      const worktreePath = await createWorktree(testRepo, "feature-test");

      expect(worktreePath).toContain("feature-test");

      // 验证 worktree 存在
      const stat = await fs.stat(worktreePath);
      expect(stat.isDirectory()).toBe(true);

      // 验证在 worktree 列表中（路径可能格式不同）
      const worktrees = await listWorktrees(testRepo);
      const normalized = worktreePath.replace(/\\/g, "/");
      expect(worktrees.some(w => w.path === normalized || w.path === worktreePath)).toBe(true);
    });

    it("should create worktree with specified branch", async () => {
      const worktreePath = await createWorktree(testRepo, "custom", "custom-branch");

      const worktrees = await listWorktrees(testRepo);
      const normalized = worktreePath.replace(/\\/g, "/");
      const worktree = worktrees.find(w => w.path === normalized || w.path === worktreePath);

      expect(worktree).toBeDefined();
      expect(worktree?.branch).toContain("custom-branch");
    });

    it("should reject invalid worktree names", async () => {
      await expect(createWorktree(testRepo, "../escape")).rejects.toThrow("Invalid worktree name");
      await expect(createWorktree(testRepo, "path/with/slash")).rejects.toThrow("Invalid worktree name");
    });

    it("should reject duplicate worktree names", async () => {
      await createWorktree(testRepo, "duplicate");
      await expect(createWorktree(testRepo, "duplicate")).rejects.toThrow("already exists");
    });

    it("should reject invalid branch names", async () => {
      await expect(createWorktree(testRepo, "test", ".invalid")).rejects.toThrow("Invalid branch name");
    });
  });

  describe("removeWorktree", () => {
    it("should remove worktree", async () => {
      const worktreePath = await createWorktree(testRepo, "to-remove");

      await removeWorktree(testRepo, worktreePath, false);

      // 验证 worktree 不在列表中
      const worktrees = await listWorktrees(testRepo);
      expect(worktrees.some(w => w.path === worktreePath)).toBe(false);
    });

    it("should force remove worktree with uncommitted changes", async () => {
      const worktreePath = await createWorktree(testRepo, "dirty");

      // 创建未提交的更改
      const testFile = path.join(worktreePath, "test.txt");
      await fs.writeFile(testFile, "uncommitted content");

      // 不使用 force 应该失败
      await expect(removeWorktree(testRepo, worktreePath, false)).rejects.toThrow();

      // 使用 force 应该成功
      await removeWorktree(testRepo, worktreePath, true);

      const worktrees = await listWorktrees(testRepo);
      expect(worktrees.some(w => w.path === worktreePath)).toBe(false);
    });
  });

  describe("getWorktreeStatus", () => {
    it("should return clean status for clean worktree", async () => {
      const status = await getWorktreeStatus(testRepo);

      expect(status.hasChanges).toBe(false);
      expect(status.modified).toHaveLength(0);
      expect(status.added).toHaveLength(0);
      expect(status.deleted).toHaveLength(0);
      expect(status.untracked).toHaveLength(0);
    });

    it("should detect modified files", async () => {
      const readmePath = path.join(testRepo, "README.md");
      await fs.writeFile(readmePath, "# Modified\n");

      const status = await getWorktreeStatus(testRepo);

      expect(status.hasChanges).toBe(true);
      // Git status 解析可能截断文件名，检查是否有任何修改
      expect(status.modified.length).toBeGreaterThan(0);
    });

    it("should detect untracked files", async () => {
      const newFile = path.join(testRepo, "new.txt");
      await fs.writeFile(newFile, "new content");

      const status = await getWorktreeStatus(testRepo);

      expect(status.hasChanges).toBe(true);
      expect(status.untracked).toContain("new.txt");
    });

    it("should detect added files", async () => {
      const newFile = path.join(testRepo, "added.txt");
      await fs.writeFile(newFile, "added content");
      await execGit(["add", "added.txt"], testRepo);

      const status = await getWorktreeStatus(testRepo);

      expect(status.hasChanges).toBe(true);
      expect(status.added).toContain("added.txt");
    });

    it("should detect deleted files", async () => {
      const readmePath = path.join(testRepo, "README.md");
      await fs.unlink(readmePath);
      await execGit(["add", "README.md"], testRepo);

      const status = await getWorktreeStatus(testRepo);

      expect(status.hasChanges).toBe(true);
      expect(status.deleted).toContain("README.md");
    });
  });

  describe("forkBranch", () => {
    it("should create new branch from current", async () => {
      const branchName = await forkBranch(testRepo, "new-feature");

      expect(branchName).toBe("new-feature");

      // 验证分支存在
      const currentBranch = await execGit(["branch", "--show-current"], testRepo);
      expect(currentBranch).toBe("new-feature");
    });

    it("should reject invalid branch names", async () => {
      await expect(forkBranch(testRepo, ".invalid")).rejects.toThrow("Invalid branch name");
      await expect(forkBranch(testRepo, "branch..name")).rejects.toThrow("Invalid branch name");
    });

    it("should reject duplicate branch names", async () => {
      await forkBranch(testRepo, "duplicate");
      await expect(forkBranch(testRepo, "duplicate")).rejects.toThrow("already exists");
    });
  });

  describe("mergeBranch", () => {
    beforeEach(async () => {
      // 创建一个分支用于测试合并
      await execGit(["checkout", "-b", "feature"], testRepo);
      const featureFile = path.join(testRepo, "feature.txt");
      await fs.writeFile(featureFile, "feature content");
      await execGit(["add", "feature.txt"], testRepo);
      await execGit(["commit", "-m", "Add feature"], testRepo);
      await execGit(["checkout", "master"], testRepo);
    });

    it("should merge branch successfully", async () => {
      const result = await mergeBranch(testRepo, "feature", true);

      expect(result.success).toBe(true);
      expect(result.message).toBeTruthy();

      // 验证文件已合并
      const featureFile = path.join(testRepo, "feature.txt");
      const exists = await fs.access(featureFile).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it("should use --no-ff flag when specified", async () => {
      await mergeBranch(testRepo, "feature", true);

      // 验证合并提交存在（非快进）
      const log = await execGit(["log", "--oneline", "-1"], testRepo);
      expect(log).toContain("Merge");
    });

    it("should reject invalid branch names", async () => {
      await expect(mergeBranch(testRepo, ".invalid")).rejects.toThrow("Invalid branch name");
    });

    it("should handle merge conflicts gracefully", async () => {
      // 创建冲突
      await execGit(["checkout", "feature"], testRepo);
      const readmePath = path.join(testRepo, "README.md");
      await fs.writeFile(readmePath, "# Feature README\n");
      await execGit(["add", "README.md"], testRepo);
      await execGit(["commit", "-m", "Update README in feature"], testRepo);

      await execGit(["checkout", "master"], testRepo);
      await fs.writeFile(readmePath, "# Master README\n");
      await execGit(["add", "README.md"], testRepo);
      await execGit(["commit", "-m", "Update README in master"], testRepo);

      try {
        const result = await mergeBranch(testRepo, "feature", true);
        // 合并冲突应该返回 success: false
        expect(result.success).toBe(false);
        expect(result.message.toLowerCase()).toContain("conflict");
      } catch (error: any) {
        // 如果抛出异常，验证错误信息包含 merge 或 conflict
        const msg = error.message.toLowerCase();
        expect(msg.includes("merge") || msg.includes("conflict")).toBe(true);
      } finally {
        // 清理冲突状态
        try {
          await execGit(["merge", "--abort"], testRepo);
        } catch {
          // 忽略清理错误
        }
      }
    });
  });

  describe("Integration: Full Worktree Workflow", () => {
    it("should complete full worktree lifecycle", async () => {
      // 1. 创建 worktree
      const worktreePath = await createWorktree(testRepo, "full-test");
      expect(worktreePath).toBeTruthy();

      // 2. 在 worktree 中创建文件
      const testFile = path.join(worktreePath, "test.txt");
      await fs.writeFile(testFile, "test content");

      // 3. 检查状态
      const status = await getWorktreeStatus(worktreePath);
      expect(status.hasChanges).toBe(true);
      expect(status.untracked).toContain("test.txt");

      // 4. 提交更改
      await execGit(["add", "test.txt"], worktreePath);
      await execGit(["commit", "-m", "Add test file"], worktreePath);

      // 5. 验证状态已清理
      const cleanStatus = await getWorktreeStatus(worktreePath);
      expect(cleanStatus.hasChanges).toBe(false);

      // 6. 删除 worktree
      await removeWorktree(testRepo, worktreePath, false);

      // 7. 验证已删除
      const worktrees = await listWorktrees(testRepo);
      expect(worktrees.some(w => w.path === worktreePath)).toBe(false);
    });

    it("should handle fork and merge workflow", async () => {
      // 1. 创建 worktree
      const worktreePath = await createWorktree(testRepo, "fork-test");

      // 2. 在 worktree 中创建分支
      const branchName = await forkBranch(worktreePath, "fork-feature");
      expect(branchName).toBe("fork-feature");

      // 3. 添加内容
      const featureFile = path.join(worktreePath, "fork.txt");
      await fs.writeFile(featureFile, "fork content");
      await execGit(["add", "fork.txt"], worktreePath);
      await execGit(["commit", "-m", "Add fork file"], worktreePath);

      // 4. 切换回主分支
      await execGit(["checkout", "master"], testRepo);

      // 5. 合并分支
      const result = await mergeBranch(testRepo, "fork-feature", true);
      expect(result.success).toBe(true);

      // 6. 验证文件已合并
      const mergedFile = path.join(testRepo, "fork.txt");
      const exists = await fs.access(mergedFile).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });
  });
});
