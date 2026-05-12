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

  // ── 结构化 status ──
  app.get("/status", async (c) => {
    try {
      const repoPath = requireRepoPath(c.req.query("path"));
      const output = await execGit(["status", "--porcelain=v1"], repoPath);
      const branch = await execGit(["rev-parse", "--abbrev-ref", "HEAD"], repoPath).then((s) => s.trim()).catch(() => "unknown");
      const files: Array<{ path: string; status: string; staged: boolean }> = [];

      for (const line of output.split("\n").filter(Boolean)) {
        const indexStatus = line[0];
        const workStatus = line[1];
        const filePath = line.slice(3).trim();
        // 如果 index 有状态（非空格非?），说明已暂存
        const staged = indexStatus !== " " && indexStatus !== "?";
        // 状态码映射
        let status = "modified";
        if (indexStatus === "?" || workStatus === "?") status = "untracked";
        else if (indexStatus === "A" || workStatus === "A") status = "added";
        else if (indexStatus === "D" || workStatus === "D") status = "deleted";
        else if (indexStatus === "R" || workStatus === "R") status = "renamed";

        files.push({ path: filePath, status, staged });
      }

      return c.json({ branch, files, total: files.length });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "GIT_STATUS_FAILED", error instanceof Error ? error.message : "Failed to get git status");
    }
  });

  // ── Git log（结构化） ──
  app.get("/log", async (c) => {
    try {
      const repoPath = requireRepoPath(c.req.query("path"));
      const limit = Math.min(50, Math.max(1, Number(c.req.query("limit")) || 20));
      const output = await execGit(["log", `--format=%H|%h|%s|%an|%ar`, `-n`, String(limit)], repoPath);
      const commits = output.split("\n").filter(Boolean).map((line) => {
        const [hash, short, message, author, date] = line.split("|");
        return { hash, short, message, author, date };
      });
      return c.json({ commits });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "GIT_LOG_FAILED", error instanceof Error ? error.message : "Failed to get git log");
    }
  });

  // ── 暂存全部 ──
  app.post("/add-all", async (c) => {
    try {
      const body = await c.req.json<{ path?: string }>();
      const repoPath = requireRepoPath(body.path);
      await execGit(["add", "-A"], repoPath);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "GIT_ADD_ALL_FAILED", error instanceof Error ? error.message : "Failed to stage all files");
    }
  });

  // ── 丢弃文件变更 ──
  app.post("/discard", async (c) => {
    try {
      const body = await c.req.json<{ path?: string; file?: string }>();
      const repoPath = requireRepoPath(body.path);
      const file = body.file?.trim();
      if (!file) {
        throw new ApiError(400, "FILE_REQUIRED", "File path is required");
      }
      await execGit(["checkout", "--", file], repoPath);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "GIT_DISCARD_FAILED", error instanceof Error ? error.message : "Failed to discard changes");
    }
  });

  // ── 丢弃全部变更 ──
  app.post("/discard-all", async (c) => {
    try {
      const body = await c.req.json<{ path?: string }>();
      const repoPath = requireRepoPath(body.path);
      await execGit(["checkout", "--", "."], repoPath);
      await execGit(["clean", "-fd"], repoPath);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "GIT_DISCARD_ALL_FAILED", error instanceof Error ? error.message : "Failed to discard all changes");
    }
  });

  // ── Stash ──
  app.post("/stash", async (c) => {
    try {
      const body = await c.req.json<{ path?: string; message?: string }>();
      const repoPath = requireRepoPath(body.path);
      const args = ["stash", "push"];
      if (body.message?.trim()) args.push("-m", body.message.trim());
      await execGit(args, repoPath);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "GIT_STASH_FAILED", error instanceof Error ? error.message : "Failed to stash changes");
    }
  });

  // ── Stash pop ──
  app.post("/stash-pop", async (c) => {
    try {
      const body = await c.req.json<{ path?: string }>();
      const repoPath = requireRepoPath(body.path);
      await execGit(["stash", "pop"], repoPath);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "GIT_STASH_POP_FAILED", error instanceof Error ? error.message : "Failed to pop stash");
    }
  });

  return app;
}
