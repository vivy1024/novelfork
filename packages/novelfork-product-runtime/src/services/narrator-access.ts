import { and, eq } from "@vivy1024/narrafork-runtime-bridge/runtime-db";
import {
	AppError,
	chapters,
	db,
	narrators,
	narratorToolCalls,
	NotFoundError,
	users,
} from "@vivy1024/narrafork-runtime-bridge";
import { ownsBookBinding } from "../policy/book-product-policy";
import {
	bookRuntimeBindingService,
	getControlledBooksRoot,
	resolveTrustedBookRoot,
	type BookRuntimeBindingRecord,
} from "./book-binding";

export type BoundNarratorActor = { userId: string; role: "admin" | "user" };

async function assertTrustedBinding(binding: BookRuntimeBindingRecord): Promise<void> {
	// External roots are eligible only after resolveTrustedBookRoot verifies the
	// server-owned manifest marker and exact book ID. This preserves fail-closed
	// access while allowing the native NarratorPanel to use a valid binding.
	const root = await resolveTrustedBookRoot(binding, getControlledBooksRoot(), true);
	if (!root) throw new NotFoundError("Narrator", "bound resource");
}

function ownsBinding(actor: BoundNarratorActor, binding: BookRuntimeBindingRecord): boolean {
	return ownsBookBinding(actor, binding.createdByUserId);
}

export async function actorFromUserId(userId: string): Promise<BoundNarratorActor | null> {
	const user = await db.query.users.findFirst({
		where: eq(users.id, userId),
		columns: { id: true, role: true },
	});
	return user ? { userId: user.id, role: user.role } : null;
}

export async function canAccessBoundNarratorFromUserId(userId: string | undefined, narratorId: string): Promise<boolean> {
	if (!userId) return false;
	const actor = await actorFromUserId(userId);
	if (!actor) return false;
	// Do not turn a guessed/nonexistent narrator ID into a successful WS
	// subscription. Existing unbound Runtime narrators retain their legacy
	// compatibility, while bound NovelFork narrators remain owner-scoped below.
	const narrator = await db.query.narrators.findFirst({
		where: eq(narrators.id, narratorId),
		columns: { id: true },
	});
	if (!narrator) return false;
	try {
		await assertRawNarratorAccess(actor, narratorId);
		return true;
	} catch {
		return false;
	}
}

export async function canAccessBoundPermissionFromUserId(userId: string | undefined, requestId: string): Promise<boolean> {
	if (!userId) return false;
	const actor = await actorFromUserId(userId);
	if (!actor) return false;
	// As with narrator subscriptions, unknown permission IDs must not reach the
	// resolver through an authenticated WebSocket.
	const permission = await db.query.narratorToolCalls.findFirst({
		where: eq(narratorToolCalls.id, requestId),
		columns: { id: true },
	});
	if (!permission) return false;
	try {
		await assertRawPermissionAccess(actor, requestId);
		return true;
	} catch {
		return false;
	}
}

/**
 * Fails closed for a bound narrator, but deliberately leaves ordinary Runtime
 * narrators unchanged for backwards compatibility.
 */
export async function assertRawNarratorAccess(actor: BoundNarratorActor, narratorId: string): Promise<void> {
	const binding = await bookRuntimeBindingService.getByNarratorId(narratorId);
	if (!binding) return;
	await assertTrustedBinding(binding);
	if (!ownsBinding(actor, binding)) throw new NotFoundError("Narrator", narratorId);
}

export async function assertBookNarratorAccess(
	actor: BoundNarratorActor,
	bookId: string,
	narratorId: string,
): Promise<{ binding: BookRuntimeBindingRecord; narrator: { id: string; chapterId: string | null } }> {
	const binding = await bookRuntimeBindingService.getByBookId(bookId);
	if (!binding || !ownsBinding(actor, binding)) throw new NotFoundError("Narrator", narratorId);
	await assertTrustedBinding(binding);
	const [row] = await db
		.select({ id: narrators.id, chapterId: narrators.chapterId, projectId: chapters.projectId })
		.from(narrators)
		.innerJoin(chapters, eq(narrators.chapterId, chapters.id))
		.where(
			and(
				eq(narrators.id, narratorId),
				eq(chapters.projectId, binding.runtimeProjectId),
			),
		)
		.limit(1);
	if (!row || row.projectId !== binding.runtimeProjectId || !row.chapterId) {
		throw new NotFoundError("Narrator", narratorId);
	}
	return { binding, narrator: { id: row.id, chapterId: row.chapterId } };
}

/** Permission IDs are global, so resolve the owning narrator before deciding. */
export async function assertRawPermissionAccess(actor: BoundNarratorActor, requestId: string): Promise<void> {
	const permission = await db.query.narratorToolCalls.findFirst({
		where: eq(narratorToolCalls.id, requestId),
		columns: { narratorId: true },
	});
	if (!permission?.narratorId) return;
	await assertRawNarratorAccess(actor, permission.narratorId);
}

/**
 * A product narrator is permanently read-only in P0. Raw Runtime endpoints may
 * still serve it after ownership checks, but cannot mutate its execution mode.
 */
export async function isBoundNovelNarrator(narratorId: string): Promise<boolean> {
	return Boolean(await bookRuntimeBindingService.getByNarratorId(narratorId));
}

/**
 * General session lifecycle and identity surfaces must never mutate a trusted
 * book narrator. This check deliberately resolves the server-owned binding again
 * at mutation time so a forged list item or guessed narrator id cannot bypass the
 * product gateway's book protection.
 */
export function isGeneralNarratorLifecycleMutation(
	method: string,
	path: string,
	narratorId: string,
): boolean {
	const narratorRoot = `/api/narrators/${narratorId}`;
	return (
		(method === "DELETE" && path === narratorRoot) ||
		(method === "PATCH" && ["archive", "unarchive", "title"].some((action) => path === `${narratorRoot}/${action}`)) ||
		(method === "POST" &&
			["fork", "fork-latest", "fork-messages"].some(
				(action) => path === `${narratorRoot}/${action}`,
			))
	);
}

export async function assertGeneralNarratorLifecycleAccess(
	actor: BoundNarratorActor,
	narratorId: string,
): Promise<void> {
	const binding = await bookRuntimeBindingService.getByNarratorId(narratorId);
	if (!binding) return;
	await assertTrustedBinding(binding);
	if (!ownsBinding(actor, binding)) throw new NotFoundError("Narrator", narratorId);
	throw new AppError(
		"Book-bound NovelFork narrators cannot be changed from the general session center",
		403,
		"BOOK_NARRATOR_PROTECTED",
	);
}
