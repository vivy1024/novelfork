/**
 * 工作区管理路由测试
 */

import { Hono } from "hono";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { ApiError } from "../errors";
import { createWorkspaceManagementRouter } from "./workspace-management";

// Mock git-utils
vi.mock("../lib/git-utils", () => ({
  listWorktrees: vi.fn(),
  removeWorktree: vi.fn(),
  mergeBranch: vi.fn(),
  getCurrentBranch: vi.fn(),
  getWorktreeStatus: vi.fn(),
  isPathInsideRoot: vi.fn(),
  isValidBranchName: vi.fn(),
  execGit: vi.fn(),
  toGitPath: vi.fn((p: string) => p.replace(/\\/g, "/")),
}));

// Mock user-config-service
vi.mock("../lib/user-config-service", () => ({
  loadUserConfig: vi.fn(),
  updateUserConfig: vi.fn(),
}));

import {
  listWorktrees,
  removeWorktree,
  mergeBranch,
  getWorktreeStatus,
  isPathInsideRoot,
  isValidBranchName,
  execGit,
  toGitPath,
} from "../lib/git-utils";
import { loadUserConfig, updateUserConfig } from "../lib/user-config-service";

const ROOT = "D:/DESKTOP/novelfork";

const DEFAULT_WORKSPACE = {
  maxActiveWorktrees: 5,
  sizeWarningMb: 500,
  autoSaveOnHibernate: true,
  hibernateAfterMinutes: 30,
};

function makeConfig(workspace = DEFAULT_WORKSPACE) {
  return {
    profile: { name: "", email: "" },
    preferences: { theme: "auto" as const, fontSize: 14, fontFamily: "", editorLineHeight: 1.6, editorTabSize: 2, autoSave: true, autoSaveDelay: 2000, dailyWordTarget: 6000, workbenchMode: false, advancedAnimations: true, wrapMarkdown: true, wrapCode: true, wrapDiff: true, language: "zh" },
    runtimeControls: {} as any,
    modelDefaults: {} as any,
    onboarding: {} as any,
    shortcuts: {},
    recentWorkspaces: [],
    proxy: { providers: {}, webFetch: "", platforms: {} },
    workspace,
  };
}

describe("workspace-management routes", () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    // Wrap with error handler matching server.ts behavior
    app = new Hono();
    app.onError((error, c) => {
      if (error instanceof ApiError) {
        return c.json({ error: { code: error.code, message: error.message } }, error.status as 400);
      }
      return c.json(
        { error: { code: "INTERNAL_ERROR", message: "Unexpected server error." } },
        500,
      );
    });
    app.route("/", createWorkspaceManagementRouter(ROOT));
  });

  describe("GET /settings", () => {
    it("returns workspace settings from user config", async () => {
      vi.mocked(loadUserConfig).mockResolvedValue(makeConfig());

      const res = await app.request("http://localhost/settings");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual(DEFAULT_WORKSPACE);
    });

    it("returns 500 when loadUserConfig fails", async () => {
      vi.mocked(loadUserConfig).mockRejectedValue(new Error("disk error"));

      const res = await app.request("http://localhost/settings");

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe("WORKSPACE_SETTINGS_LOAD_FAILED");
    });
  });

  describe("PUT /settings", () => {
    it("updates workspace settings", async () => {
      const updated = { ...DEFAULT_WORKSPACE, maxActiveWorktrees: 10 };
      vi.mocked(updateUserConfig).mockResolvedValue(makeConfig(updated));

      const res = await app.request("http://localhost/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxActiveWorktrees: 10 }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.maxActiveWorktrees).toBe(10);
      expect(vi.mocked(updateUserConfig)).toHaveBeenCalledWith({
        workspace: { maxActiveWorktrees: 10 },
      });
    });

    it("returns 500 when updateUserConfig fails", async () => {
      vi.mocked(updateUserConfig).mockRejectedValue(new Error("write error"));

      const res = await app.request("http://localhost/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxActiveWorktrees: 10 }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe("WORKSPACE_SETTINGS_UPDATE_FAILED");
    });
  });

  describe("GET /worktrees", () => {
    it("returns worktree list with status", async () => {
      vi.mocked(listWorktrees).mockResolvedValue([
        { path: ROOT, branch: "refs/heads/main", head: "abc123", bare: false },
        { path: `${ROOT}/.novelfork-worktrees/draft-1`, branch: "refs/heads/worktree/draft-1", head: "def456", bare: false },
      ]);
      vi.mocked(getWorktreeStatus).mockResolvedValue({
        modified: [],
        added: [],
        deleted: [],
        untracked: [],
        hasChanges: false,
      });
      vi.mocked(isPathInsideRoot).mockReturnValue(true);

      const res = await app.request("http://localhost/worktrees");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.worktrees).toHaveLength(2);
      expect(body.worktrees[0].isMain).toBe(true);
      expect(body.worktrees[1].isMain).toBe(false);
      expect(body.worktrees[0].status).toEqual({
        modified: 0,
        added: 0,
        deleted: 0,
        untracked: 0,
      });
    });

    it("returns 500 when listWorktrees fails", async () => {
      vi.mocked(listWorktrees).mockRejectedValue(new Error("not a git repo"));

      const res = await app.request("http://localhost/worktrees");

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error.code).toBe("WORKTREE_LIST_FAILED");
    });
  });

  describe("POST /worktrees/:name/merge", () => {
    it("merges worktree branch back to main", async () => {
      vi.mocked(listWorktrees).mockResolvedValue([
        { path: ROOT, branch: "refs/heads/main", head: "abc123", bare: false },
        { path: `${ROOT}/.novelfork-worktrees/draft-1`, branch: "refs/heads/worktree/draft-1", head: "def456", bare: false },
      ]);
      vi.mocked(isValidBranchName).mockReturnValue(true);
      vi.mocked(mergeBranch).mockResolvedValue({
        success: true,
        message: "Merge completed successfully",
      });

      const res = await app.request("http://localhost/worktrees/draft-1/merge", {
        method: "POST",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.branch).toBe("worktree/draft-1");
      expect(vi.mocked(mergeBranch)).toHaveBeenCalledWith(ROOT, "worktree/draft-1", true);
    });

    it("returns 404 when worktree not found", async () => {
      vi.mocked(listWorktrees).mockResolvedValue([
        { path: ROOT, branch: "refs/heads/main", head: "abc123", bare: false },
      ]);

      const res = await app.request("http://localhost/worktrees/nonexistent/merge", {
        method: "POST",
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("WORKTREE_NOT_FOUND");
    });

    it("returns merge conflict info", async () => {
      vi.mocked(listWorktrees).mockResolvedValue([
        { path: ROOT, branch: "refs/heads/main", head: "abc123", bare: false },
        { path: `${ROOT}/.novelfork-worktrees/draft-1`, branch: "refs/heads/worktree/draft-1", head: "def456", bare: false },
      ]);
      vi.mocked(isValidBranchName).mockReturnValue(true);
      vi.mocked(mergeBranch).mockResolvedValue({
        success: false,
        message: "Merge conflict detected. Please resolve conflicts manually.",
      });

      const res = await app.request("http://localhost/worktrees/draft-1/merge", {
        method: "POST",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.message).toContain("conflict");
    });
  });

  describe("DELETE /worktrees/:name", () => {
    it("deletes a merged worktree and its branch", async () => {
      vi.mocked(listWorktrees).mockResolvedValue([
        { path: ROOT, branch: "refs/heads/main", head: "abc123", bare: false },
        { path: `${ROOT}/.novelfork-worktrees/draft-1`, branch: "refs/heads/worktree/draft-1", head: "def456", bare: false },
      ]);
      vi.mocked(isValidBranchName).mockReturnValue(true);
      vi.mocked(execGit).mockResolvedValue("  main\n  worktree/draft-1\n");
      vi.mocked(removeWorktree).mockResolvedValue(undefined);

      const res = await app.request("http://localhost/worktrees/draft-1", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.branch).toBe("worktree/draft-1");
      expect(vi.mocked(removeWorktree)).toHaveBeenCalledWith(
        ROOT,
        `${ROOT}/.novelfork-worktrees/draft-1`,
        false,
      );
    });

    it("rejects deleting unmerged worktree without force", async () => {
      vi.mocked(listWorktrees).mockResolvedValue([
        { path: ROOT, branch: "refs/heads/main", head: "abc123", bare: false },
        { path: `${ROOT}/.novelfork-worktrees/draft-1`, branch: "refs/heads/worktree/draft-1", head: "def456", bare: false },
      ]);
      vi.mocked(execGit).mockResolvedValue("  main\n");

      const res = await app.request("http://localhost/worktrees/draft-1", {
        method: "DELETE",
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("WORKTREE_NOT_MERGED");
    });

    it("allows force deleting unmerged worktree", async () => {
      vi.mocked(listWorktrees).mockResolvedValue([
        { path: ROOT, branch: "refs/heads/main", head: "abc123", bare: false },
        { path: `${ROOT}/.novelfork-worktrees/draft-1`, branch: "refs/heads/worktree/draft-1", head: "def456", bare: false },
      ]);
      vi.mocked(execGit).mockResolvedValue("  main\n");
      vi.mocked(removeWorktree).mockResolvedValue(undefined);

      const res = await app.request("http://localhost/worktrees/draft-1?force=true", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(vi.mocked(removeWorktree)).toHaveBeenCalledWith(
        ROOT,
        `${ROOT}/.novelfork-worktrees/draft-1`,
        true,
      );
    });

    it("rejects deleting main worktree", async () => {
      vi.mocked(listWorktrees).mockResolvedValue([
        { path: ROOT, branch: "refs/heads/main", head: "abc123", bare: false },
      ]);

      const res = await app.request("http://localhost/worktrees/main", {
        method: "DELETE",
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("CANNOT_DELETE_MAIN");
    });

    it("returns 404 when worktree not found", async () => {
      vi.mocked(listWorktrees).mockResolvedValue([
        { path: ROOT, branch: "refs/heads/main", head: "abc123", bare: false },
      ]);

      const res = await app.request("http://localhost/worktrees/nonexistent", {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("WORKTREE_NOT_FOUND");
    });
  });
});
