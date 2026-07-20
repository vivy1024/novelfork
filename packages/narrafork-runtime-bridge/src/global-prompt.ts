import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { ValidationError } from "../../narrafork-runtime-private/server/lib/errors";

export interface GlobalPromptPathOptions {
	/** Explicit repository root for an embedded host or test. */
	repositoryRoot?: string;
	/** A working directory from which the nearest Git repository root is resolved. */
	startPath?: string;
}

export interface GlobalPromptCandidate {
	path: string;
	exists: boolean;
}

export interface LoadedGlobalPrompt {
	content: string | null;
	filePath: string | null;
	candidates: GlobalPromptCandidate[];
}

/**
 * Resolve the owning Git repository for a working directory. Prompt files are
 * deliberately repository-scoped: user-home and descendant instruction files
 * are never candidates.
 */
export function resolveRepositoryRoot(options: GlobalPromptPathOptions = {}): string | null {
	if (options.repositoryRoot) return resolve(options.repositoryRoot);

	let current = resolve(options.startPath ?? process.cwd());
	while (true) {
		// A Git worktree may expose .git as either a directory or a file.
		if (existsSync(join(current, ".git"))) return current;
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

/** Return the only accepted repository-root instruction files, in precedence order. */
export function getGlobalPromptCandidates(options: GlobalPromptPathOptions = {}): string[] {
	const repositoryRoot = resolveRepositoryRoot(options);
	if (!repositoryRoot) return [];
	return [join(repositoryRoot, "AGENT.md"), join(repositoryRoot, "CLAUDE.md")].map((candidate) =>
		resolve(candidate),
	);
}

async function isReadableFile(path: string): Promise<boolean> {
	const info = await stat(path).catch(() => null);
	return Boolean(info?.isFile());
}

/** Load the first readable repository-root prompt using AGENT.md then CLAUDE.md precedence. */
export async function loadGlobalPrompt(
	options: GlobalPromptPathOptions = {},
): Promise<LoadedGlobalPrompt> {
	const candidates: GlobalPromptCandidate[] = [];
	let content: string | null = null;
	let filePath: string | null = null;

	for (const candidate of getGlobalPromptCandidates(options)) {
		const exists = await isReadableFile(candidate);
		candidates.push({ path: candidate, exists });
		if (filePath || !exists) continue;
		const loaded = await readFile(candidate, "utf-8").catch(() => null);
		if (loaded !== null) {
			content = loaded;
			filePath = candidate;
		}
	}

	return { content, filePath, candidates };
}

export async function resolveGlobalPromptWriteTarget(
	requestedFilePath?: string,
	options: GlobalPromptPathOptions = {},
): Promise<string> {
	const candidates = getGlobalPromptCandidates(options);
	if (candidates.length === 0) {
		throw new ValidationError("A Git repository root is required for repository prompt writes");
	}
	if (requestedFilePath) {
		const requested = resolve(requestedFilePath);
		if (!candidates.includes(requested)) {
			throw new ValidationError("filePath must be a repository-root AGENT.md or CLAUDE.md path");
		}
		return requested;
	}

	for (const candidate of candidates) {
		if (await isReadableFile(candidate)) return candidate;
	}
	return candidates[0];
}

export async function writeGlobalPrompt(
	content: string,
	requestedFilePath?: string,
	options: GlobalPromptPathOptions = {},
): Promise<string> {
	const targetPath = await resolveGlobalPromptWriteTarget(requestedFilePath, options);
	await mkdir(dirname(targetPath), { recursive: true });
	await writeFile(targetPath, content, "utf-8");
	return targetPath;
}
