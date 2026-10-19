/**
 * Runtime project ownership for product books.
 *
 * A product book and a Runtime project are 1:1 (`book_runtime_bindings`), and the
 * project is where the per-book authoring settings live: project skills, optional
 * tool routine overrides, MCP overrides. Every one of those writes goes through
 * Runtime's own `requireProjectAccess(..., "write")`, which is satisfied only by an
 * admin, the project's `owner_user_id`, or an explicit `acl_grants` row.
 *
 * So a project created *without* an owner is administrable by admins only: any other
 * author opening 写作台 › 本书设置 sees a read-only surface, and saving is rejected
 * with a 404. `book-provision` therefore sets the owner at creation, and the
 * reconciliation below repairs projects created before that fix.
 *
 * `projects.owner_user_id` is a foreign key onto `users.id`, so an owner is only
 * ever written for an id that really is a Runtime user. Product identities always
 * come from a verified session, but the lookup is kept because a book must never
 * fail to be created just because the owner column could not be filled — and
 * because tests drive the product HTTP surface with synthetic principals.
 */

import { db as runtimeDb, logger, projects, users } from "@vivy1024/narrafork-runtime-bridge";
import { eq } from "@vivy1024/narrafork-runtime-bridge/runtime-db";
import { getNovelForkProductDatabase } from "../db/database";
import { bookRuntimeBindings } from "../db/schema";

/**
 * The user id to store as a project's owner, or `null` when the id names no user.
 *
 * Returning `null` rather than throwing keeps the caller's decision explicit: book
 * creation still succeeds, the project simply stays admin-managed.
 */
export async function resolveRuntimeOwnerUserId(userId: string): Promise<string | null> {
	if (!userId) return null;
	const owner = await runtimeDb.query.users.findFirst({
		where: eq(users.id, userId),
		columns: { id: true },
	});
	return owner?.id ?? null;
}

export interface BookProjectOwnerReconciliation {
	/** Projects that had no owner and were handed to their book's creator. */
	readonly adopted: number;
	/** Bindings whose creator id no longer names a user (or is absent). */
	readonly unresolved: number;
}

/**
 * Give an owner to every bound book project that lacks one.
 *
 * Idempotent and cheap — it only writes rows whose owner is still null — so it runs
 * on each startup, which is what makes the fix reach books created before it. The
 * creator is taken from `book_runtime_bindings.created_by_user_id`: the product
 * layer records the book's owner there and uses the same field for every book
 * ownership check, so the two can never disagree.
 */
export async function reconcileBookProjectOwners(): Promise<BookProjectOwnerReconciliation> {
	const bindings = await getNovelForkProductDatabase().query.bookRuntimeBindings.findMany({
		columns: { runtimeProjectId: true, createdByUserId: true },
	});
	let adopted = 0;
	let unresolved = 0;
	for (const binding of bindings) {
		if (!binding.createdByUserId) {
			unresolved += 1;
			continue;
		}
		const project = await runtimeDb.query.projects.findFirst({
			where: eq(projects.id, binding.runtimeProjectId),
			columns: { id: true, ownerUserId: true },
		});
		// A binding with no project is a different defect (repair territory, not
		// ownership) and must not be silently turned into an ownership write.
		if (!project || project.ownerUserId) continue;
		const ownerUserId = await resolveRuntimeOwnerUserId(binding.createdByUserId);
		if (!ownerUserId) {
			unresolved += 1;
			continue;
		}
		await runtimeDb
			.update(projects)
			.set({ ownerUserId, updatedAt: new Date().toISOString() })
			.where(eq(projects.id, project.id));
		adopted += 1;
	}
	if (adopted > 0 || unresolved > 0) {
		logger.info("Reconciled book project ownership", { adopted, unresolved });
	}
	return { adopted, unresolved };
}
