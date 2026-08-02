/**
 * Product-host project teardown.
 *
 * Runtime HTTP DELETE /api/projects/:id keeps an equivalent inline handler.
 * NovelFork product book deletion must call this shared helper so the bridge
 * never depends on a non-exported route symbol.
 */
// Runtime schema columns and query helpers must come from the same isolated
// Bun dependency tree; Drizzle uses private members in its type identities.
import { eq, inArray } from "../../narrafork-runtime-private/node_modules/drizzle-orm";
import { db } from "../../narrafork-runtime-private/server/db";
import {
	chapters,
	containerInstances,
	explorationGroups,
	mergeSessions,
	narratorMessageRefs,
	narratorMessages,
	narrators,
	narratorToolCalls,
	portAllocations,
	projects,
	terminals,
	terminalTabs,
	terminalViewState,
} from "../../narrafork-runtime-private/server/db/schema";
import { NotFoundError } from "../../narrafork-runtime-private/server/lib/errors";
import { logger } from "../../narrafork-runtime-private/server/lib/logger";
import { chapterService } from "../../narrafork-runtime-private/server/services/chapter-service";
import { refreshCache as refreshContainerProxyCache } from "../../narrafork-runtime-private/server/services/container-proxy";
import { gitService } from "../../narrafork-runtime-private/server/services/git-service";
import { removeTabFromAllUsers } from "../../narrafork-runtime-private/server/services/user-preferences-service";

export async function deleteProjectById(id: string): Promise<void> {
	const project = await db.query.projects.findFirst({
		where: eq(projects.id, id),
	});
	if (!project) throw new NotFoundError("Project", id);

	const projectChapters = await db.query.chapters.findMany({
		where: eq(chapters.projectId, id),
	});

	const nonRoot = projectChapters.filter((ch) => !ch.isRoot);
	const root = projectChapters.filter((ch) => ch.isRoot);

	for (const chapter of nonRoot) {
		try {
			await chapterService.removeForProjectDeletion(chapter.id, project.gitPath);
		} catch (err) {
			logger.warn("Failed to remove chapter during project delete", {
				chapterId: chapter.id,
				error: String(err),
			});
		}
	}
	for (const chapter of root) {
		try {
			await chapterService.removeForProjectDeletion(chapter.id, project.gitPath);
		} catch (err) {
			logger.warn("Failed to remove root chapter during project delete", {
				chapterId: chapter.id,
				error: String(err),
			});
		}
	}

	await db.delete(explorationGroups).where(eq(explorationGroups.projectId, id));

	if (project.gitPath) {
		try {
			await gitService.pruneWorktrees(project.gitPath);
		} catch (err) {
			logger.warn("Failed to prune worktrees during project delete", {
				error: String(err),
			});
		}
	}

	const remainingChapterIds = (
		await db.query.chapters.findMany({
			where: eq(chapters.projectId, id),
			columns: { id: true },
		})
	).map((ch) => ch.id);

	if (remainingChapterIds.length > 0) {
		const remainingNarratorIds = (
			await db.query.narrators.findMany({
				where: inArray(narrators.chapterId, remainingChapterIds),
				columns: { id: true },
			})
		).map((n) => n.id);

		let allNarratorIds = [...remainingNarratorIds];
		if (allNarratorIds.length > 0) {
			const childNarrators = (
				await db.query.narrators.findMany({
					where: inArray(narrators.parentNarratorId, allNarratorIds),
					columns: { id: true },
				})
			).map((n) => n.id);
			allNarratorIds = [...new Set([...allNarratorIds, ...childNarrators])];
		}

		db.transaction((tx) => {
			if (allNarratorIds.length > 0) {
				tx.update(narrators)
					.set({ parentNarratorId: null, forkMessageId: null, pruneBoundaryMessageId: null })
					.where(inArray(narrators.id, allNarratorIds))
					.run();

				tx.delete(terminalViewState)
					.where(inArray(terminalViewState.narratorId, allNarratorIds))
					.run();
				tx.delete(terminalTabs).where(inArray(terminalTabs.narratorId, allNarratorIds)).run();
				tx.delete(terminals).where(inArray(terminals.narratorId, allNarratorIds)).run();
				tx.delete(narratorToolCalls)
					.where(inArray(narratorToolCalls.narratorId, allNarratorIds))
					.run();
				tx.delete(narratorMessageRefs)
					.where(inArray(narratorMessageRefs.narratorId, allNarratorIds))
					.run();
				tx.delete(narratorMessages)
					.where(inArray(narratorMessages.narratorId, allNarratorIds))
					.run();
				tx.delete(narrators).where(inArray(narrators.id, allNarratorIds)).run();
			}

			tx.delete(terminalViewState)
				.where(inArray(terminalViewState.chapterId, remainingChapterIds))
				.run();
			tx.delete(terminalTabs).where(inArray(terminalTabs.chapterId, remainingChapterIds)).run();
			tx.delete(terminals).where(inArray(terminals.chapterId, remainingChapterIds)).run();
			tx.delete(containerInstances)
				.where(inArray(containerInstances.chapterId, remainingChapterIds))
				.run();
			tx.delete(portAllocations)
				.where(inArray(portAllocations.chapterId, remainingChapterIds))
				.run();
			tx.delete(mergeSessions)
				.where(inArray(mergeSessions.targetChapterId, remainingChapterIds))
				.run();

			tx.update(chapters)
				.set({ parentChapterId: null, mergedIntoChapterId: null })
				.where(inArray(chapters.id, remainingChapterIds))
				.run();
			tx.delete(chapters).where(inArray(chapters.id, remainingChapterIds)).run();
		});
	}

	await db.delete(projects).where(eq(projects.id, id));
	removeTabFromAllUsers("project", id).catch((err) => {
		logger.warn("Failed to remove project tab from users", {
			projectId: id,
			error: String(err),
		});
	});
	if (project.proxyDomain) {
		refreshContainerProxyCache().catch((err) => {
			logger.warn("Failed to refresh container proxy cache after project delete", {
				projectId: id,
				error: String(err),
			});
		});
	}
	logger.info("Project deleted", { projectId: id, name: project.name });
}
