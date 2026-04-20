import { fetchJson } from "../hooks/use-api";

export interface GitCommitSummary {
  hash: string;
  message: string;
}

export interface GitOverview {
  log: string;
  diff: string;
  status: string;
}

export interface GitMergeResponse {
  ok: boolean;
  message: string;
}

function buildQuery(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

export async function fetchGitOverview(repoPath: string): Promise<GitOverview> {
  return fetchJson(`/git/overview?${buildQuery({ path: repoPath })}`);
}

export async function fetchGitBranches(repoPath: string): Promise<{ branches: string[] }> {
  return fetchJson(`/git/branches?${buildQuery({ path: repoPath })}`);
}

export async function stageGitFile(repoPath: string, file: string): Promise<void> {
  await fetchJson("/git/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: repoPath, file }),
  });
}

export async function commitGitChanges(repoPath: string, message: string): Promise<void> {
  await fetchJson("/git/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: repoPath, message }),
  });
}

export async function createGitWorktree(repoPath: string, name: string, branch?: string): Promise<{ ok: boolean; path: string }> {
  return fetchJson("/git/worktree/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: repoPath, name, branch }),
  });
}

export async function mergeGitBranch(repoPath: string, sourceBranch: string): Promise<GitMergeResponse> {
  return fetchJson("/git/merge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: repoPath, sourceBranch }),
  });
}
