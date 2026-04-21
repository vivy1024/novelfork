import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { StudioCreateBookBody } from "../book-create.js";
import type { ApiError } from "../errors.js";
import { execGit } from "./git-utils.js";
import { prepareStudioBookProjectBootstrap } from "./project-bootstrap.js";

function buildCreateBody(overrides: Partial<StudioCreateBookBody> = {}): StudioCreateBookBody {
  return {
    title: "测试书",
    genre: "xuanhuan",
    language: "zh",
    platform: "qidian",
    projectInit: {
      repositorySource: "new",
      workflowMode: "outline-first",
      templatePreset: "genre-default",
      gitBranch: "main",
      worktreeName: "draft-测试书",
    },
    ...overrides,
  };
}

async function createCommittedRepository(repoRoot: string, branch = "story-base"): Promise<void> {
  await execGit(["init", `--initial-branch=${branch}`], repoRoot);
  await execGit(["config", "user.name", "Test User"], repoRoot);
  await execGit(["config", "user.email", "test@example.com"], repoRoot);
  await writeFile(join(repoRoot, "README.md"), "# test\n", "utf-8");
  await execGit(["add", "README.md"], repoRoot);
  await execGit(["commit", "-m", "Initial commit"], repoRoot);
}

describe("project-bootstrap", () => {
  it("bootstraps a new repository under the studio root and prepares a worktree", async () => {
    const studioRoot = await mkdtemp(join(tmpdir(), "novelfork-bootstrap-new-"));

    try {
      const prepared = await prepareStudioBookProjectBootstrap(
        buildCreateBody(),
        "2026-04-20T00:00:00.000Z",
        { root: studioRoot },
      );

      expect(prepared).toBeDefined();
      expect(prepared?.bootstrap).toMatchObject({
        status: "prepared",
        repositoryRoot: studioRoot,
        baseBranch: "main",
        repositoryCreated: true,
        worktreeCreated: true,
      });
      expect(prepared?.bootstrap.worktreeBranch).toMatch(/^worktree\//);
      await expect(access(join(studioRoot, ".git"))).resolves.toBeUndefined();
      await expect(access(join(studioRoot, ".novelfork-worktrees", "draft-测试书"))).resolves.toBeUndefined();
    } finally {
      await rm(studioRoot, { recursive: true, force: true });
    }
  });

  it("uses the current branch as a truthful fallback when an existing repo lacks the requested base branch", async () => {
    const studioRoot = await mkdtemp(join(tmpdir(), "novelfork-bootstrap-existing-root-"));
    const existingRepo = await mkdtemp(join(tmpdir(), "novelfork-bootstrap-existing-repo-"));

    try {
      await createCommittedRepository(existingRepo, "story-base");

      const prepared = await prepareStudioBookProjectBootstrap(
        buildCreateBody({
          projectInit: {
            repositorySource: "existing",
            repositoryPath: existingRepo,
            workflowMode: "outline-first",
            templatePreset: "genre-default",
            gitBranch: "main",
            worktreeName: "draft-existing",
          },
        }),
        "2026-04-20T00:00:00.000Z",
        { root: studioRoot },
      );

      expect(prepared?.bootstrap).toMatchObject({
        status: "prepared",
        repositoryRoot: existingRepo,
        baseBranch: "story-base",
        baseBranchFallback: true,
        repositoryCreated: false,
        worktreeCreated: true,
      });
      await expect(access(join(existingRepo, ".novelfork-worktrees", "draft-existing"))).resolves.toBeUndefined();
    } finally {
      await rm(studioRoot, { recursive: true, force: true });
      await rm(existingRepo, { recursive: true, force: true });
    }
  });

  it("uses unique worktree branches even when different Chinese names normalize to the same ASCII slug", async () => {
    const studioRoot = await mkdtemp(join(tmpdir(), "novelfork-bootstrap-branch-collision-root-"));
    const existingRepo = await mkdtemp(join(tmpdir(), "novelfork-bootstrap-branch-collision-repo-"));

    try {
      await createCommittedRepository(existingRepo, "main");

      const firstPrepared = await prepareStudioBookProjectBootstrap(
        buildCreateBody({
          projectInit: {
            repositorySource: "existing",
            repositoryPath: existingRepo,
            workflowMode: "outline-first",
            templatePreset: "genre-default",
            gitBranch: "main",
            worktreeName: "draft-测试书",
          },
        }),
        "2026-04-20T00:00:00.000Z",
        { root: studioRoot },
      );

      const secondPrepared = await prepareStudioBookProjectBootstrap(
        buildCreateBody({
          title: "仙路长明",
          projectInit: {
            repositorySource: "existing",
            repositoryPath: existingRepo,
            workflowMode: "outline-first",
            templatePreset: "genre-default",
            gitBranch: "main",
            worktreeName: "draft-仙路长明",
          },
        }),
        "2026-04-20T00:00:00.000Z",
        { root: studioRoot },
      );

      expect(firstPrepared?.bootstrap.worktreeBranch).not.toBe(secondPrepared?.bootstrap.worktreeBranch);
      await expect(access(join(existingRepo, ".novelfork-worktrees", "draft-测试书"))).resolves.toBeUndefined();
      await expect(access(join(existingRepo, ".novelfork-worktrees", "draft-仙路长明"))).resolves.toBeUndefined();
    } finally {
      await rm(studioRoot, { recursive: true, force: true });
      await rm(existingRepo, { recursive: true, force: true });
    }
  });

  it("rejects clone bootstrap explicitly instead of fabricating success", async () => {
    const studioRoot = await mkdtemp(join(tmpdir(), "novelfork-bootstrap-clone-"));

    try {
      await expect(
        prepareStudioBookProjectBootstrap(
          buildCreateBody({
            projectInit: {
              repositorySource: "clone",
              cloneUrl: "https://github.com/example/repo.git",
              workflowMode: "serial-ops",
              templatePreset: "web-serial",
              gitBranch: "main",
              worktreeName: "draft-clone",
            },
          }),
          "2026-04-20T00:00:00.000Z",
          { root: studioRoot },
        ),
      ).rejects.toMatchObject({
        status: 501,
        code: "PROJECT_BOOTSTRAP_CLONE_UNSUPPORTED",
      } satisfies Partial<ApiError>);
    } finally {
      await rm(studioRoot, { recursive: true, force: true });
    }
  });
});
