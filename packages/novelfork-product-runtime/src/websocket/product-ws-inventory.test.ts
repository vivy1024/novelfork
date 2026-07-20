import { describe, expect, test } from "bun:test";
import {
	NARRATOR_STATE_ACCESS_GUARDED_CLIENT_MESSAGE_TYPES,
	NOVELFORK_PRODUCT_NARRATOR_CLIENT_MESSAGE_TYPES,
	NOVELFORK_PRODUCT_NARRATOR_SERVER_EVENT_TYPES,
} from "./product-ws-contract";

describe("NovelFork product Narrator WebSocket inventory", () => {
	test("declares only the client messages sent by the Studio product adapter", () => {
		expect(NOVELFORK_PRODUCT_NARRATOR_CLIENT_MESSAGE_TYPES).toEqual([
			"subscribe",
			"permission_decision",
			"sync_check",
		]);
		expect(NOVELFORK_PRODUCT_NARRATOR_CLIENT_MESSAGE_TYPES).not.toContain("merge_decision");
		expect(NOVELFORK_PRODUCT_NARRATOR_CLIENT_MESSAGE_TYPES).not.toContain("subscribe_stats");
	});

	test("declares the Studio-rendered server subset without claiming Runtime parity", () => {
		expect(NOVELFORK_PRODUCT_NARRATOR_SERVER_EVENT_TYPES).toEqual([
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
		]);
		for (const unrenderedRuntimeEvent of ["tool_started", "presence_update", "queue_status"]) {
			expect(NOVELFORK_PRODUCT_NARRATOR_SERVER_EVENT_TYPES).not.toContain(
				unrenderedRuntimeEvent as never,
			);
		}
	});

	test("keeps every narrator-state operation behind the shared access guard", () => {
		expect(NARRATOR_STATE_ACCESS_GUARDED_CLIENT_MESSAGE_TYPES).toEqual([
			"buffer_message",
			"cancel_buffer",
			"update_buffer",
			"remove_buffer",
			"presence_join",
			"presence_leave",
			"sync_check",
			"update_timeout",
		]);
		expect(NARRATOR_STATE_ACCESS_GUARDED_CLIENT_MESSAGE_TYPES).not.toContain(
			"unsubscribe" as never,
		);
	});
});
