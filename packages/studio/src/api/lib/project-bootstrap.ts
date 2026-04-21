import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

import {
  attachStudioProjectBootstrap,
  buildStudioProjectInitRecord,
  type StudioCreateBookBody,
  type StudioProjectBootstrapRecord,
  type StudioProjectInitRecord,
} from "../book-create.js";
import { ApiError } from "../errors.js";
import { createWorktree, execGit, getCurrentBranch, isGitRepository, listWorktrees } from "./git-utils.js";

export interface PreparedStudioProjectBootstrap {
  readonly bootstrap: StudioProjectBootstrapRecord;
  readonly projectInitRecord: StudioProjectInitRecord;
}

interface PrepareStudioProjectBootstrapOptions {
  readonly root: string;
}

interface WorktreePreparationResult {
  readonly worktreePath: string;
  readonly worktreeBranch: string;
  readonly worktreeCreated: boolean;
}

interface StudioProjectRepositoryRootInput {
  readonly repositorySource: StudioProjectInitRecord["repositorySource"];
  readonly repositoryPath?: string;
  readonly cloneUrl?: string;
}

function normalizePathForComparison(targetPath: string): string {
  return path.resolve(targetPath).replace(/\\/g, "/").replace(/\/+$/, "");
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function normalizeCloneSource(cloneUrl: string, studioRoot: string): string {
  const trimmed = cloneUrl.trim();
  if (!trimmed) {
    throw new ApiError(400, "PROJECT_BOOTSTRAP_CLONE_URL_REQUIRED", "Clone URL is required.");
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, "");
  }

  if (/^[^@\s]+@[^:\s]+:.+/.test(trimmed)) {
    return trimmed;
  }

  return normalizePathForComparison(path.resolve(studioRoot, trimmed));
}

function extractCloneRepositoryStem(cloneUrl: string): string {
  const trimmed = cloneUrl.trim();
  if (!trimmed) {
    return "repo";
  }

  try {
    const parsed = new URL(trimmed);
    const pathname = decodeURIComponent(parsed.pathname);
    const candidate = pathname.split("/").filter(Boolean).at(-1) ?? "repo";
    return candidate.replace(/\.git$/i, "") || "repo";
  } catch {
    const candidate = trimmed.split(/[\\/]/).filter(Boolean).at(-1) ?? trimmed;
    const tail = candidate.split(":").filter(Boolean).at(-1) ?? candidate;
    return tail.replace(/\.git$/i, "") || "repo";
  }
}

function buildCloneRepositoryDirectoryName(cloneUrl: string, studioRoot: string): string {
  const normalizedSource = normalizeCloneSource(cloneUrl, studioRoot);
  const stem = extractCloneRepositoryStem(cloneUrl)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  const hash = createHash("sha1").update(normalizedSource).digest("hex").slice(0, 8);

  return `${stem || "repo"}-${hash}`;
}

function buildWorktreeBranchName(worktreeName: string): string {
  const normalizedName = worktreeName.trim() || "draft-main";
  const slug = normalizedName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  const hash = createHash("sha1").update(normalizedName).digest("hex").slice(0, 8);

  return `worktree/${slug || "draft-main"}-${hash}`;
}

function stripBranchRef(branch: string): string {
  return branch.replace(/^refs\/heads\//, "");
}

async function initRepository(repoRoot: string, initialBranch: string): Promise<void> {
  await mkdir(repoRoot, { recursive: true });
  await execGit(["init", `--initial-branch=${initialBranch}`], repoRoot);
}

async function cloneRepository(cloneUrl: string, repoRoot: string, studioRoot: string): Promise<void> {
  await mkdir(path.dirname(repoRoot), { recursive: true });
  await execGit(["clone", cloneUrl, repoRoot], studioRoot);
}

async function branchExists(repoRoot: string, branch: string): Promise<boolean> {
  try {
    await execGit(["show-ref", "--verify", `refs/heads/${branch}`], repoRoot);
    return true;
  } catch {
    return false;
  }
}

async function hasHeadCommit(repoRoot: string): Promise<boolean> {
  try {
    await execGit(["rev-parse", "--verify", "HEAD"], repoRoot);
    return true;
  } catch {
    return false;
  }
}

async function resolveBaseBranch(
  repoRoot: string,
  requestedBranch: string,
): Promise<{ branch: string; fallback: boolean } | undefined> {
  if (!await hasHeadCommit(repoRoot)) {
    return undefined;
  }

  if (await branchExists(repoRoot, requestedBranch)) {
    return { branch: requestedBranch, fallback: false };
  }

  const currentBranch = await getCurrentBranch(repoRoot);
  if (currentBranch.trim()) {
    return { branch: currentBranch.trim(), fallback: currentBranch.trim() !== requestedBranch };
  }

  throw new ApiError(
    400,
    "PROJECT_BOOTSTRAP_BRANCH_NOT_FOUND",
    `Base branch "${requestedBranch}" was not found in repository "${repoRoot}".`,
  );
}

async function ensureWorktree(
  repoRoot: string,
  worktreeName: string,
  requestedBaseBranch: string,
): Promise<WorktreePreparationResult & { baseBranch: string; baseBranchFallback: boolean }> {
  const worktreePath = path.join(repoRoot, ".novelfork-worktrees", worktreeName);
  const normalizedWorktreePath = normalizePathForComparison(worktreePath);
  const existingWorktree = (await listWorktrees(repoRoot)).find(
    (worktree) => normalizePathForComparison(worktree.path) === normalizedWorktreePath,
  );

  const worktreeBranch = existingWorktree
    ? stripBranchRef(existingWorktree.branch)
    : buildWorktreeBranchName(worktreeName);
  const baseBranchResolution = await resolveBaseBranch(repoRoot, requestedBaseBranch);
  const baseBranch = baseBranchResolution?.branch ?? requestedBaseBranch;
  const baseBranchFallback = baseBranchResolution?.fallback ?? false;

  if (existingWorktree) {
    return {
      baseBranch,
      baseBranchFallback,
      worktreePath,
      worktreeBranch,
      worktreeCreated: false,
    };
  }

  if (baseBranchResolution) {
    await createWorktree(repoRoot, worktreeName, {
      branch: worktreeBranch,
      startPoint: baseBranchResolution.branch,
    });
  } else {
    await createWorktree(repoRoot, worktreeName, worktreeBranch);
  }

  return {
    baseBranch,
    baseBranchFallback,
    worktreePath,
    worktreeBranch,
    worktreeCreated: true,
  };
}

export function resolveStudioProjectRepositoryRoot(
  record: StudioProjectRepositoryRootInput,
  studioRoot: string,
): string {
  if (record.repositorySource === "existing") {
    if (!record.repositoryPath) {
      throw new ApiError(400, "PROJECT_BOOTSTRAP_PATH_REQUIRED", "Existing repository path is required.");
    }
    return path.resolve(studioRoot, record.repositoryPath);
  }

  if (record.repositorySource === "clone") {
    return path.resolve(
      studioRoot,
      ".novelfork-repos",
      buildCloneRepositoryDirectoryName(record.cloneUrl ?? "", studioRoot),
    );
  }

  if (record.repositoryPath) {
    return path.resolve(studioRoot, record.repositoryPath);
  }

  return path.resolve(studioRoot);
}

export async function prepareStudioProjectBootstrap(
  record: StudioProjectInitRecord,
  options: PrepareStudioProjectBootstrapOptions,
): Promise<StudioProjectBootstrapRecord> {
  if (!record.initializationPlan.readyToContinue) {
    const missingField = record.initializationPlan.blockingField ?? "repositoryPath";
    throw new ApiError(
      400,
      "PROJECT_BOOTSTRAP_INCOMPLETE",
      `Project initialization is incomplete: missing ${missingField}.`,
    );
  }

  const repositoryRoot = resolveStudioProjectRepositoryRoot(record, options.root);
  let repositoryCreated = false;

  if (record.repositorySource === "existing") {
    if (!await pathExists(repositoryRoot)) {
      throw new ApiError(
        404,
        "PROJECT_BOOTSTRAP_REPOSITORY_NOT_FOUND",
        `Existing repository path was not found: "${repositoryRoot}".`,
      );
    }
    if (!await isGitRepository(repositoryRoot)) {
      throw new ApiError(
        400,
        "PROJECT_BOOTSTRAP_REPOSITORY_INVALID",
        `Existing repository path is not a Git repository: "${repositoryRoot}".`,
      );
    }
  } else if (record.repositorySource === "clone") {
    if (!await pathExists(repositoryRoot)) {
      await cloneRepository(record.cloneUrl ?? "", repositoryRoot, options.root);
      repositoryCreated = true;
    } else if (!await isGitRepository(repositoryRoot)) {
      throw new ApiError(
        400,
        "PROJECT_BOOTSTRAP_REPOSITORY_INVALID",
        `Clone target path is not a Git repository: "${repositoryRoot}".`,
      );
    }
  } else if (!await isGitRepository(repositoryRoot)) {
    await initRepository(repositoryRoot, record.gitBranch);
    repositoryCreated = true;
  }

  const preparedWorktree = await ensureWorktree(repositoryRoot, record.worktreeName, record.gitBranch);

  return {
    status: "prepared",
    repositoryRoot,
    baseBranch: preparedWorktree.baseBranch,
    ...(preparedWorktree.baseBranchFallback ? { baseBranchFallback: true } : {}),
    worktreePath: preparedWorktree.worktreePath,
    worktreeBranch: preparedWorktree.worktreeBranch,
    repositoryCreated,
    worktreeCreated: preparedWorktree.worktreeCreated,
  };
}

export async function prepareStudioBookProjectBootstrap(
  body: StudioCreateBookBody,
  now: string,
  options: PrepareStudioProjectBootstrapOptions,
): Promise<PreparedStudioProjectBootstrap | undefined> {
  if (!body.projectInit) {
    return undefined;
  }

  const projectInitRecord = buildStudioProjectInitRecord(body, now);
  const bootstrap = await prepareStudioProjectBootstrap(projectInitRecord, options);

  return {
    bootstrap,
    projectInitRecord: attachStudioProjectBootstrap(projectInitRecord, bootstrap),
  };
}

export async function persistStudioProjectInitRecord(
  bookDir: string,
  projectInitRecord: StudioProjectInitRecord,
): Promise<void> {
  await mkdir(bookDir, { recursive: true });
  await writeFile(
    path.join(bookDir, ".novelfork-project-init.json"),
    `${JSON.stringify(projectInitRecord, null, 2)}\n`,
    "utf-8",
  );
}
