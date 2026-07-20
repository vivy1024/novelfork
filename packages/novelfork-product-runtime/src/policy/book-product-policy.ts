export type BookOwnershipActor = { userId: string; role: "admin" | "user" };

/** Shared ownership rule used by REST, product gateway, and WebSocket guards. */
export function ownsBookBinding(
	actor: BookOwnershipActor,
	bindingOwnerUserId: string | null,
): boolean {
	return actor.role === "admin" || bindingOwnerUserId === actor.userId;
}

/**
 * Fail-closed subscription filter. The supplied verifier owns the database/token
 * lookup; this pure function ensures unauthorized guessed IDs never reach the
 * subscription or catch-up phases.
 */
export async function filterAuthorizedNarratorIds(
	narratorIds: readonly string[],
	isAuthorized: (narratorId: string) => Promise<boolean>,
): Promise<{ allowed: string[]; denied: string[] }> {
	const allowed: string[] = [];
	const denied: string[] = [];
	for (const narratorId of narratorIds) {
		if (await isAuthorized(narratorId)) allowed.push(narratorId);
		else denied.push(narratorId);
	}
	return { allowed, denied };
}
