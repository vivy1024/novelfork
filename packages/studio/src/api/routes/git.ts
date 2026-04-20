import { Hono } from "hono";
import { ApiError } from "../errors.js";
import { createWorktree, execGit, mergeBranch } from "../lib/git-utils.js";

function requireRepoPath(pathValue: string | undefined): string {
  const repoPath = pathValue?.trim();
  if (!repoPath) {
    throw new ApiError(400, "PATH_REQUIRED", "Repository path is required");
  }
  return repoPath;
}

export function createGitRouter(): Hono {
  const app = new Hono();

  app.get("/overview", async (c) => {
    try {
      const repoPath = requireRepoPath(c.req.query("path"));
      const [log, diff, status] = await Promise.all([
        execGit(["log", "--oneline", "-n", "20"], repoPath),
        execGit(["diff", "HEAD"], repoPath),
        execGit(["status", "--short"], repoPath),
      ]);
      return c.json({ log, diff, status });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "GIT_OVERVIEW_FAILED", error instanceof Error ? error.message : "Failed to load git overview");
    }
  });

  app.get("/branches", async (c) => {
    try {
      const repoPath = requireRepoPath(c.req.query("path"));
      const output = await execGit(["branch", "-a"], repoPath);
      const branches = output
        .split("\n")
        .map((line) => line.replace(/^\*?\s+/, "").trim())
        .filter(Boolean);
      return c.json({ branches });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "GIT_BRANCHES_FAILED", error instanceof Error ? error.message : "Failed to list branches");
    }
  });

  app.post("/add", async (c) => {
    try {
      const body = await c.req.json<{ path?: string; file?: string }>();
      const repoPath = requireRepoPath(body.path);
      const file = body.file?.trim();
      if (!file) {
        throw new ApiError(400, "FILE_REQUIRED", "File path is required");
      }
      await execGit(["add", file], repoPath);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "GIT_ADD_FAILED", error instanceof Error ? error.message : "Failed to stage file");
    }
  });

  app.post("/commit", async (c) => {
    try {
      const body = await c.req.json<{ path?: string; message?: string }>();
      const repoPath = requireRepoPath(body.path);
      const message = body.message?.trim();
      if (!message) {
        throw new ApiError(400, "MESSAGE_REQUIRED", "Commit message is required");
      }
      await execGit(["commit", "-m", message], repoPath);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "GIT_COMMIT_FAILED", error instanceof Error ? error.message : "Failed to create commit");
    }
  });

  app.post("/worktree/create", async (c) => {
    try {
      const body = await c.req.json<{ path?: string; name?: string; branch?: string }>();
      const repoPath = requireRepoPath(body.path);
      const name = body.name?.trim();
      if (!name) {
        throw new ApiError(400, "NAME_REQUIRED", "Worktree name is required");
      }
      const worktreePath = await createWorktree(repoPath, name, body.branch?.trim());
      return c.json({ ok: true, path: worktreePath });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "GIT_WORKTREE_CREATE_FAILED", error instanceof Error ? error.message : "Failed to create worktree");
    }
  });

  app.post("/merge", async (c) => {
    try {
      const body = await c.req.json<{ path?: string; sourceBranch?: string }>();
      const repoPath = requireRepoPath(body.path);
      const sourceBranch = body.sourceBranch?.trim();
      if (!sourceBranch) {
        throw new ApiError(400, "SOURCE_BRANCH_REQUIRED", "Source branch is required");
      }
      const result = await mergeBranch(repoPath, sourceBranch, true);
      return c.json({ ok: result.success, message: result.message });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "GIT_MERGE_FAILED", error instanceof Error ? error.message : "Failed to merge branch");
    }
  });

  return app;
}
