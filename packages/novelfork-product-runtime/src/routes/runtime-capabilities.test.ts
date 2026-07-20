import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let applyProjectMcpOverridePatch: typeof import("./runtime-capabilities").applyProjectMcpOverridePatch;
let parseProjectMcpOverrides: typeof import("./runtime-capabilities").parseProjectMcpOverrides;
let originalNarraforkHome: string | undefined;

beforeAll(async () => {
	originalNarraforkHome = process.env.NARRAFORK_HOME;
	process.env.NARRAFORK_HOME = mkdtempSync(join(tmpdir(), "novelfork-product-runtime-test-"));
	({ applyProjectMcpOverridePatch, parseProjectMcpOverrides } = await import("./runtime-capabilities"));
});

afterAll(() => {
	if (originalNarraforkHome === undefined) delete process.env.NARRAFORK_HOME;
	else process.env.NARRAFORK_HOME = originalNarraforkHome;
});

describe("project MCP override inheritance", () => {
	test("clears server and tool overrides instead of persisting empty inheritance values", () => {
		let settings: Record<string, unknown> = {
			routines: { disabledRoutines: ["review"] },
		};

		settings = applyProjectMcpOverridePatch(settings, "memory", {
			defaultBehavior: "ask",
			toolPermissionPatch: { toolName: "recall", behavior: "deny" },
		});
		expect(parseProjectMcpOverrides(settings)).toEqual([{
			serverId: "memory",
			defaultBehavior: "ask",
			toolPermissions: [{ toolName: "recall", behavior: "deny" }],
		}]);

		settings = applyProjectMcpOverridePatch(settings, "memory", {
			toolPermissionPatch: { toolName: "recall", behavior: null },
		});
		expect(parseProjectMcpOverrides(settings)).toEqual([{
			serverId: "memory",
			defaultBehavior: "ask",
		}]);

		settings = applyProjectMcpOverridePatch(settings, "memory", { defaultBehavior: null });
		expect(parseProjectMcpOverrides(settings)).toEqual([]);
		expect(settings).toEqual({ routines: { disabledRoutines: ["review"] } });
	});
});
