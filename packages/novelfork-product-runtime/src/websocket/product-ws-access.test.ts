import { describe, expect, mock, test } from "bun:test";
import {
	guardNarratorWsStateAccess,
	NARRATOR_ACCESS_DENIED_CODE,
	type NarratorAccessDeniedEvent,
} from "./product-ws-contract";

describe("NovelFork product Narrator WebSocket access guard", () => {
	test("preserves access granted to an existing unbound Runtime narrator", async () => {
		const canAccess = mock(async () => true);
		const denied: NarratorAccessDeniedEvent[] = [];

		const allowed = await guardNarratorWsStateAccess({
			userId: "runtime-user",
			narratorId: "ordinary-runtime-narrator",
			canAccess,
			onAccessDenied: (event) => denied.push(event),
		});

		expect(allowed).toBe(true);
		expect(canAccess).toHaveBeenCalledWith("runtime-user", "ordinary-runtime-narrator");
		expect(denied).toEqual([]);
	});

	test("denies an unauthorized bound narrator with the generic product error", async () => {
		const denied: NarratorAccessDeniedEvent[] = [];

		const allowed = await guardNarratorWsStateAccess({
			userId: "other-user",
			narratorId: "bound-narrator",
			canAccess: async () => false,
			onAccessDenied: (event) => denied.push(event),
		});

		expect(allowed).toBe(false);
		expect(denied).toEqual([
			{
				type: "error",
				code: NARRATOR_ACCESS_DENIED_CODE,
				message: "Narrator access denied",
				narratorId: "bound-narrator",
			},
		]);
	});

	test("fails closed when the access lookup throws", async () => {
		const denied: NarratorAccessDeniedEvent[] = [];
		let touchedNarratorState = false;

		const allowed = await guardNarratorWsStateAccess({
			userId: "runtime-user",
			narratorId: "bound-narrator",
			canAccess: async () => {
				throw new Error("database unavailable");
			},
			onAccessDenied: (event) => denied.push(event),
		});
		if (allowed) touchedNarratorState = true;

		expect(allowed).toBe(false);
		expect(touchedNarratorState).toBe(false);
		expect(denied[0]?.code).toBe(NARRATOR_ACCESS_DENIED_CODE);
	});
});
