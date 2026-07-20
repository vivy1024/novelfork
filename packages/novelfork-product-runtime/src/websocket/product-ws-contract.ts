import type { NarratorServerMessage } from "@vivy1024/narrafork-runtime-bridge";

/** Client messages that the NovelFork Studio product adapter actually sends. */
type StudioNarratorClientMessageType = "subscribe" | "permission_decision" | "sync_check";

export const NOVELFORK_PRODUCT_NARRATOR_CLIENT_MESSAGE_TYPES = [
	"subscribe",
	"permission_decision",
	"sync_check",
] as const satisfies readonly StudioNarratorClientMessageType[];

export type NovelForkProductNarratorClientMessageType =
	(typeof NOVELFORK_PRODUCT_NARRATOR_CLIENT_MESSAGE_TYPES)[number];

/**
 * Runtime events with an explicit Studio rendering or recovery behavior.
 * This is intentionally a subset, not an exhaustive inventory of Runtime events.
 */
type RuntimeNarratorServerEventType = NarratorServerMessage["type"];

export const NOVELFORK_PRODUCT_NARRATOR_SERVER_EVENT_TYPES = [
	"message",
	"user_message",
	"stream_event",
	"status_change",
	"tool_output",
	"tool_completed",
	"permission_request",
	"permission_resolved",
	"catch_up",
	"sync_ok",
	"streaming_snapshot",
	"streaming_reset",
	"model_changed",
	"compacting",
	"compact_done",
	"compact_failed",
	"narrator_error",
	"error",
	"full_reload",
] as const satisfies readonly RuntimeNarratorServerEventType[];

export type NovelForkProductNarratorServerEventType =
	(typeof NOVELFORK_PRODUCT_NARRATOR_SERVER_EVENT_TYPES)[number];

/** Messages that must pass narrator authorization before touching narrator state. */
export type NarratorStateAccessGuardedClientMessageType =
	| "buffer_message"
	| "cancel_buffer"
	| "update_buffer"
	| "remove_buffer"
	| "presence_join"
	| "presence_leave"
	| "sync_check"
	| "update_timeout";

export const NARRATOR_STATE_ACCESS_GUARDED_CLIENT_MESSAGE_TYPES = [
	"buffer_message",
	"cancel_buffer",
	"update_buffer",
	"remove_buffer",
	"presence_join",
	"presence_leave",
	"sync_check",
	"update_timeout",
] as const satisfies readonly NarratorStateAccessGuardedClientMessageType[];

export const NARRATOR_ACCESS_DENIED_CODE = "NARRATOR_ACCESS_DENIED" as const;

export interface NarratorAccessDeniedEvent {
	readonly type: "error";
	readonly code: typeof NARRATOR_ACCESS_DENIED_CODE;
	readonly message: "Narrator access denied";
	readonly narratorId?: string;
}

export function createNarratorAccessDeniedEvent(narratorId?: string): NarratorAccessDeniedEvent {
	return {
		type: "error",
		code: NARRATOR_ACCESS_DENIED_CODE,
		message: "Narrator access denied",
		...(narratorId ? { narratorId } : {}),
	};
}

export interface NarratorWsStateAccessGuardOptions {
	readonly userId: string | undefined;
	readonly narratorId: string;
	readonly canAccess: (userId: string | undefined, narratorId: string) => Promise<boolean>;
	readonly onAccessDenied: (event: NarratorAccessDeniedEvent) => void;
}

/**
 * Runs the shared bound-narrator check and treats lookup failures as denial.
 * A true result deliberately preserves compatibility for existing unbound
 * Runtime narrators, as decided by canAccessBoundNarratorFromUserId.
 */
export async function guardNarratorWsStateAccess(
	options: NarratorWsStateAccessGuardOptions,
): Promise<boolean> {
	try {
		if (await options.canAccess(options.userId, options.narratorId)) return true;
	} catch {
		// Authorization lookups fail closed; callers must not touch narrator state.
	}
	options.onAccessDenied(createNarratorAccessDeniedEvent(options.narratorId));
	return false;
}
