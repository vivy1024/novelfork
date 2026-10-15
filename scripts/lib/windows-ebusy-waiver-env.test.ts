import { describe, expect, test } from "bun:test";
import { assertPinnedBunVersion, buildIsolatedTestEnvironment } from "./windows-ebusy-waiver-runner.ts";

const REAL_HOME = "C:/Users/17655";
const scratch = "C:/Temp/nf-waiver-run1-abc";

describe("豁免执行器的测试环境隔离", () => {
	test("points every NovelFork and NarraFork data path at the isolated scratch directory", () => {
		const env = buildIsolatedTestEnvironment({
			inherited: {
				NOVELFORK_HOME: `${REAL_HOME}/.novelfork`,
				NOVELFORK_PROJECT_ROOT: `${REAL_HOME}/.novelfork/project`,
				NOVELFORK_BOOKS_ROOT: `${REAL_HOME}/books`,
				NOVELFORK_STORAGE_DB_PATH: `${REAL_HOME}/novelfork.db`,
				NOVELFORK_SESSION_STORE_DIR: `${REAL_HOME}/sessions`,
			},
			scratch,
		});
		expect(env.NOVELFORK_HOME).toBe(`${scratch}/novelfork-home`);
		expect(env.NOVELFORK_PROJECT_ROOT).toBe(`${scratch}/project`);
		expect(env.NOVELFORK_BOOKS_ROOT).toBe(`${scratch}/project/books`);
		expect(env.NOVELFORK_STORAGE_DB_PATH).toBe(`${scratch}/project/novelfork.db`);
		expect(env.NOVELFORK_SESSION_STORE_DIR).toBe(`${scratch}/project/sessions`);
	});

	test("leaves NARRAFORK_HOME to the preload and keeps the real home out of every working path", () => {
		const env = buildIsolatedTestEnvironment({
			inherited: {
				NARRAFORK_HOME: `${REAL_HOME}/.narrafork`,
				NARRAFORK_ALLOW_MULTIPLE: "1",
				HOME: REAL_HOME,
				USERPROFILE: REAL_HOME,
			},
			scratch,
		});
		expect(env.NARRAFORK_HOME).toBeUndefined();
		expect(env.NARRAFORK_ALLOW_MULTIPLE).toBeUndefined();
		const guardOnly = new Set(["NARRAFORK_ORIGINAL_HOME", "NARRAFORK_TEST_REAL_HOME"]);
		for (const [name, value] of Object.entries(env)) {
			if (guardOnly.has(name)) continue;
			expect(String(value ?? "")).not.toContain(REAL_HOME);
		}
	});

	test("removes every external database connection setting and forces sqlite", () => {
		const env = buildIsolatedTestEnvironment({
			inherited: {
				NF_DATABASE_URL: "postgres://prod.example/real",
				DATABASE_URL: "postgres://prod.example/real",
				NF_READ_BACKEND: "postgres",
				NF_WRITE_BACKEND: "postgres",
			},
			scratch,
		});
		expect(env.NF_DATABASE_URL).toBeUndefined();
		expect(env.DATABASE_URL).toBeUndefined();
		expect(env.NF_READ_BACKEND).toBeUndefined();
		expect(env.NF_WRITE_BACKEND).toBeUndefined();
		expect(env.NF_DATABASE_BACKEND).toBe("sqlite");
	});

	test("routes TEMP, TMP and TMPDIR into the scratch directory", () => {
		const env = buildIsolatedTestEnvironment({ inherited: { TEMP: REAL_HOME }, scratch });
		expect(env.TEMP).toBe(scratch);
		expect(env.TMP).toBe(scratch);
		expect(env.TMPDIR).toBe(scratch);
	});

	test("preserves the real home for the preload guard, the same way the official runner does", () => {
		const env = buildIsolatedTestEnvironment({
			inherited: { USERPROFILE: REAL_HOME, HOME: REAL_HOME },
			scratch,
		});
		expect(env.NARRAFORK_ORIGINAL_HOME).toBe(REAL_HOME);
		expect(env.NARRAFORK_TEST_REAL_HOME).toBe(REAL_HOME);
	});

	test("points migrations at the runtime-migrations directory and disables Windows temp sweep failures", () => {
		const env = buildIsolatedTestEnvironment({
			inherited: {},
			scratch,
			migrationsDir: "D:/repo/packages/narrafork-runtime-private/runtime-migrations",
		});
		expect(env.NARRAFORK_MIGRATIONS_DIR).toBe("D:/repo/packages/narrafork-runtime-private/runtime-migrations");
		expect(env.NARRAFORK_DEFER_WINDOWS_TEMP_CLEANUP).toBe("1");
	});

	test("pins Git to LF so fixture bytes do not depend on the developer's autocrlf", () => {
		const env = buildIsolatedTestEnvironment({ inherited: {}, scratch });
		expect(env.GIT_CONFIG_COUNT).toBe("1");
		expect(env.GIT_CONFIG_KEY_0).toBe("core.autocrlf");
		expect(env.GIT_CONFIG_VALUE_0).toBe("false");
	});

	test("refuses a Bun executable whose version is not the pinned runtime version", async () => {
		await expect(assertPinnedBunVersion("1.3.13")).rejects.toThrow("1.4.2");
	});

	test("accepts the pinned runtime version", async () => {
		await expect(assertPinnedBunVersion("1.4.2")).resolves.toBeUndefined();
	});
});
