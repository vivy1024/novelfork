import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Hono } from "hono";

// Runtime 自己的 hono 副本（版本与产品侧不同）：用它作父应用才复现生产里的错误转交形状。
const runtimeRequire = createRequire(resolve(import.meta.dir, "../../../narrafork-runtime-private/package.json"));
const { Hono: RuntimeHono } = runtimeRequire("hono") as { Hono: typeof Hono };

type AppErrorCtor = typeof import("@vivy1024/narrafork-runtime-bridge").AppError;
type NovelCore = typeof import("@vivy1024/novelfork-core");

let AppError: AppErrorCtor;
let novelDomainRoutes: typeof import("./domain").novelDomainRoutes;
let createBundledPluginRoutes: typeof import("./bundled-plugins").createBundledPluginRoutes;
let decryptSecret: typeof import("../../../novel-plugin/src/engine/secret-box").decryptSecret;
let resolveNovelRuntimeStoragePath: typeof import("../adapters/storage").resolveNovelRuntimeStoragePath;
let core: NovelCore;
let originalNarraforkHome: string | undefined;
let originalAllowMultiple: string | undefined;
let originalNovelforkHome: string | undefined;

// S1.5 red tests, run through the real mounted domain routes (domain.ts), not the bare
// embedding router, so a missing admin guard at the mount point is what gets caught.
//
// The global storage is a process singleton. To keep the real product database untouched,
// the test switches it to a throwaway database and restores the original path afterward.

const EMBEDDING_KV = "settings:embedding";
const ADMIN = { sub: "s15-admin", role: "admin" as const };
const USER = { sub: "s15-user", role: "user" as const };

function appFor(user: typeof ADMIN | typeof USER) {
	const app = new Hono();
	app.use("*", async (c, next) => {
		c.set("user" as never, user as never);
		await next();
	});
	app.route("", novelDomainRoutes);
	app.onError((error, c) =>
		error instanceof AppError
			? c.json({ code: error.code, error: error.message }, error.statusCode as never)
			: c.json({ error: String(error) }, 500),
	);
	return app;
}

async function putEmbedding(app: ReturnType<typeof appFor>, body: Record<string, unknown>) {
	return app.request("/api/embedding", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

function storedKv(key: string): string | null {
	const row = core
		.getStorageDatabase()
		.sqlite.prepare(`SELECT "value" FROM "kv_store" WHERE "key" = ?`)
		.get(key) as { value: string } | undefined;
	return row?.value ?? null;
}

/** 库里的 apiKey 自 T-10 起是 {enc,iv,tag,ct} 密文：解密后再比对，空字符串表示没有 key。 */
async function storedApiKey(): Promise<string | null> {
	const raw = storedKv(EMBEDDING_KV);
	if (raw === null) return null;
	const apiKey = (JSON.parse(raw) as { apiKey?: unknown }).apiKey ?? "";
	return apiKey === "" ? "" : decryptSecret(apiKey);
}

function send(app: { request: Hono["request"] }, method: string, path: string, body?: unknown) {
	return app.request(path, {
		method,
		...(body === undefined
			? {}
			: { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
	});
}

type Explained = {
	code?: string;
	explanation?: { whatHappened?: string; whyItMatters?: string; suggestedAction?: string };
};

async function expectAdminDenied(response: Response) {
	expect(response.status).toBe(403);
	const body = (await response.json()) as Explained;
	expect(body.code).toBe("ADMIN_REQUIRED");
	expect(body.explanation?.whatHappened).toBeTruthy();
	expect(body.explanation?.whyItMatters).toBeTruthy();
	expect(body.explanation?.suggestedAction).toBeTruthy();
}

let originalDbPath = "";
let scratchDir = "";

beforeAll(async () => {
	scratchDir = await mkdtemp(join(tmpdir(), "novelfork-s15-embedding-"));
	originalNarraforkHome = process.env.NARRAFORK_HOME;
	originalAllowMultiple = process.env.NARRAFORK_ALLOW_MULTIPLE;
	originalNovelforkHome = process.env.NOVELFORK_HOME;
	process.env.NARRAFORK_HOME = join(scratchDir, "runtime");
	process.env.NARRAFORK_ALLOW_MULTIPLE = "1";
	// writing-skills 的作者目录由 NOVELFORK_HOME 决定；必须同样指向 scratch，守卫回归时才不会写入真实目录。
	process.env.NOVELFORK_HOME = join(scratchDir, "novelfork-home");
	core = await import("@vivy1024/novelfork-core");
	({ AppError } = await import("@vivy1024/narrafork-runtime-bridge"));
	({ novelDomainRoutes } = await import("./domain"));
	({ createBundledPluginRoutes } = await import("./bundled-plugins"));
	({ decryptSecret } = await import("../../../novel-plugin/src/engine/secret-box"));
	({ resolveNovelRuntimeStoragePath } = await import("../adapters/storage"));
	originalDbPath = resolveNovelRuntimeStoragePath();
	const storage = core.initializeStorageDatabase({ databasePath: join(scratchDir, "novelfork.db") });
	core.runStorageMigrations(storage);
});

afterAll(async () => {
	core.closeStorageDatabase();
	// Restore the original global database so other tests in this process are unaffected.
	core.initializeStorageDatabase({ databasePath: originalDbPath });
	if (originalNarraforkHome === undefined) delete process.env.NARRAFORK_HOME;
	else process.env.NARRAFORK_HOME = originalNarraforkHome;
	if (originalAllowMultiple === undefined) delete process.env.NARRAFORK_ALLOW_MULTIPLE;
	else process.env.NARRAFORK_ALLOW_MULTIPLE = originalAllowMultiple;
	if (originalNovelforkHome === undefined) delete process.env.NOVELFORK_HOME;
	else process.env.NOVELFORK_HOME = originalNovelforkHome;
	// On Windows an open SQLite handle can still hold the scratch directory (EBUSY);
	// the OS temp dir reclaims it later, so a failed sweep is only a warning here.
	try {
		await rm(scratchDir, { recursive: true, force: true, maxRetries: 2 });
	} catch (error) {
		if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EBUSY") return;
		throw error;
	}
});

describe("S1.5 global writing-skills writes are admin-only", () => {
	test("a non-admin cannot create, update or delete a global writing skill", async () => {
		const user = appFor(USER);
		const put = await user.request("/api/writing-skills/s15-probe", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ content: "---\nname: s15\n---\nbody" }),
		});
		const post = await user.request("/api/writing-skills/import", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ slug: "s15-probe", content: "---\nname: s15\n---\nbody" }),
		});
		const del = await user.request("/api/writing-skills/s15-probe", { method: "DELETE" });
		const fork = await user.request("/api/writing-skills/s15-probe/fork", { method: "POST" });
		expect(put.status).toBe(403);
		expect(post.status).toBe(403);
		expect(del.status).toBe(403);
		expect(fork.status).toBe(403);
	});

	test("PATCH is covered too, while GET stays readable for everyone", async () => {
		await expectAdminDenied(await send(appFor(USER), "PATCH", "/api/writing-skills/s15-probe", { content: "x" }));
		const list = await send(appFor(USER), "GET", "/api/writing-skills");
		expect(list.status).toBe(200);
	});
});

describe("S1.5 global embedding settings are admin-only and key-safe", () => {
	test("a non-admin cannot change the global embedding settings", async () => {
		const response = await putEmbedding(appFor(USER), {
			baseUrl: "https://attacker.example/v1",
			model: "m",
			dim: 8,
			apiKey: "sk-user-attempt",
		});
		expect(response.status).toBe(403);
		expect(await storedApiKey()).not.toBe("sk-user-attempt");
	});

	test("a non-admin cannot probe the embedding provider either (POST /api/embedding/test)", async () => {
		await expectAdminDenied(await send(appFor(USER), "POST", "/api/embedding/test"));
		await expectAdminDenied(await send(appFor(USER), "PATCH", "/api/embedding", { model: "m" }));
	});

	test("a non-admin can still read the masked embedding settings", async () => {
		const response = await send(appFor(USER), "GET", "/api/embedding");
		expect(response.status).toBe(200);
	});

	test("changing the base URL without a new key does not carry the old key to the new endpoint", async () => {
		const admin = appFor(ADMIN);
		const first = await putEmbedding(admin, {
			baseUrl: "https://first.example/v1",
			model: "m",
			dim: 8,
			apiKey: "sk-first-secret",
		});
		expect(first.status).toBe(200);

		const second = await putEmbedding(admin, { baseUrl: "https://second.example/v1" });
		expect(second.status).toBe(200);

		// The old key must not be reused against the new endpoint.
		expect(await storedApiKey()).toBe("");
	});

	test("changing only the model keeps the key for the same endpoint", async () => {
		const admin = appFor(ADMIN);
		const first = await putEmbedding(admin, {
			baseUrl: "https://keep.example/v1",
			model: "m1",
			dim: 8,
			apiKey: "sk-keep-me",
		});
		expect(first.status).toBe(200);

		const changed = await putEmbedding(admin, { model: "m2" });
		expect(changed.status).toBe(200);
		expect(await storedApiKey()).toBe("sk-keep-me");
	});

	test("saving the same endpoint again without a key keeps the key", async () => {
		const admin = appFor(ADMIN);
		const first = await putEmbedding(admin, {
			baseUrl: "https://same.example/v1",
			model: "m",
			dim: 8,
			apiKey: "sk-same-endpoint",
		});
		expect(first.status).toBe(200);

		const again = await putEmbedding(admin, { baseUrl: "https://same.example/v1/" });
		expect(again.status).toBe(200);
		expect(await storedApiKey()).toBe("sk-same-endpoint");
	});
});

describe("T-04 global Zhuque settings are admin-only", () => {
	test("a non-admin cannot change the Zhuque endpoint or key, and nothing is stored", async () => {
		const response = await send(appFor(USER), "PUT", "/api/settings/zhuque", {
			apiKey: "k-user",
			endpoint: "https://8.8.8.8/scan",
		});
		await expectAdminDenied(response);
		expect(storedKv("settings:zhuque")).toBeNull();
	});

	test("an admin can still save it (public IP literal, so no DNS is needed)", async () => {
		const response = await send(appFor(ADMIN), "PUT", "/api/settings/zhuque", {
			apiKey: "k-admin",
			endpoint: "https://8.8.8.8/scan",
		});
		expect(response.status).toBe(200);
		expect(storedKv("settings:zhuque")).not.toBeNull();
	});

	test("even an admin cannot point it at a local file", async () => {
		const response = await send(appFor(ADMIN), "PUT", "/api/settings/zhuque", {
			apiKey: "k-admin",
			endpoint: "file:///etc/passwd",
		});
		expect(response.status).toBe(400);
		expect((await response.json()) as Explained).toMatchObject({ code: "ZHUQUE_ENDPOINT_REJECTED" });
	});
});

describe("T-04 global compliance dictionaries are admin-only", () => {
	test("a non-admin cannot import into or clear the shared dictionary", async () => {
		await expectAdminDenied(
			await send(appFor(USER), "POST", "/api/compliance/dictionaries/import", { words: ["测试敏感词"] }),
		);
		await expectAdminDenied(await send(appFor(USER), "DELETE", "/api/compliance/dictionaries/imported"));
		await expectAdminDenied(await send(appFor(USER), "PATCH", "/api/compliance/dictionaries", {}));
	});

	test("an admin can still import, and everyone can still read the dictionary list", async () => {
		const imported = await send(appFor(ADMIN), "POST", "/api/compliance/dictionaries/import", {
			words: ["测试敏感词"],
		});
		expect(imported.status).toBe(200);
		const listed = await send(appFor(USER), "GET", "/api/compliance/dictionaries");
		expect(listed.status).toBe(200);
		const cleared = await send(appFor(ADMIN), "DELETE", "/api/compliance/dictionaries/imported");
		expect(cleared.status).toBe(200);
	});

	test("book-scoped compliance checks are not caught by the global-write guard", async () => {
		const response = await send(appFor(USER), "POST", "/api/books/s15-book/compliance/sensitive-scan", {
			platform: "qidian",
		});
		expect(response.status).not.toBe(403);
	});
});

describe("T-04 global market writes are admin-only", () => {
	const writes: Array<[string, string, unknown?]> = [
		["POST", "/api/market/ranks/custom", { platform: "qidian", key: "s15", name: "s15", url: "https://www.qidian.com/rank" }],
		["DELETE", "/api/market/ranks/custom/s15"],
		["POST", "/api/market/ranks/probe", { platform: "qidian", url: "https://www.qidian.com/rank" }],
		["PUT", "/api/market/scan-prefs", { platform: "qidian" }],
		["PUT", "/api/market/lexicon", { words: [] }],
		["PATCH", "/api/market/lexicon", { words: [] }],
		["POST", "/api/market/scan", { platform: "qidian" }],
		["POST", "/api/market/sample-public-chapters", { fanqieBookId: "1" }],
	];

	for (const [method, path, body] of writes) {
		test(`a non-admin gets 403 for ${method} ${path}`, async () => {
			await expectAdminDenied(await send(appFor(USER), method, path, body));
		});
	}

	test("an admin can still write, and everyone can still read", async () => {
		const saved = await send(appFor(ADMIN), "PUT", "/api/market/lexicon", {});
		expect(saved.status).toBe(200);
		expect((await send(appFor(USER), "GET", "/api/market/lexicon")).status).toBe(200);
		expect((await send(appFor(USER), "GET", "/api/market/ranks")).status).toBe(200);
		expect((await send(appFor(USER), "GET", "/api/market/scan-prefs")).status).toBe(200);
	});
});

describe("T-04 bundled narrator-team install is admin-only", () => {
	class FakeManager {
		installs = 0;
		status: unknown = undefined;
		async install() {
			this.installs += 1;
			this.status = { runtimeState: "inactive" };
			return this.status;
		}
		async enable() {
			return {};
		}
		async activate() {
			this.status = { runtimeState: "active" };
			return {};
		}
		async getStatus() {
			return this.status;
		}
	}

	function bundledAppFor(user: typeof ADMIN | typeof USER, manager: FakeManager) {
		const app = new Hono();
		app.use("*", async (c, next) => {
			c.set("user" as never, user as never);
			await next();
		});
		app.route("/api/plugins/bundled", createBundledPluginRoutes({ getManager: async () => manager }));
		return app;
	}

	test("a non-admin cannot install the bundled plugin, and nothing is installed", async () => {
		const manager = new FakeManager();
		const response = await bundledAppFor(USER, manager).request("/api/plugins/bundled/narrator-team/install", {
			method: "POST",
		});
		await expectAdminDenied(response);
		expect(manager.installs).toBe(0);
	});

	test("an admin can still install it, and anyone can read its status", async () => {
		const manager = new FakeManager();
		const installed = await bundledAppFor(ADMIN, manager).request("/api/plugins/bundled/narrator-team/install", {
			method: "POST",
		});
		expect(installed.status).toBe(201);
		expect(manager.installs).toBe(1);
		const status = await bundledAppFor(USER, manager).request("/api/plugins/bundled/narrator-team/status");
		expect(status.status).toBe(200);
	});
});

describe("product sub-apps hand their errors back to the Runtime parent as JSON", () => {
	function runtimeParent(user: typeof ADMIN | typeof USER) {
		const parent = new RuntimeHono();
		parent.use("*", async (c, next) => {
			(c as unknown as { set: (key: string, value: unknown) => void }).set("user", user);
			await next();
		});
		parent.onError((err, c) => {
			const e = err as Error & { statusCode?: number; code?: string };
			return c.json({ code: e.code ?? "INTERNAL" }, (e.statusCode ?? 500) as 503);
		});
		return parent;
	}

	test("bundled plugin routes: a manager failure reaches the parent onError instead of a plain-text 500", async () => {
		const unavailable = Object.assign(new Error("plugin manager down"), { statusCode: 503, code: "PLUGIN_MANAGER_UNAVAILABLE" });
		const parent = runtimeParent(USER);
		parent.route(
			"/api/plugins/bundled",
			createBundledPluginRoutes({
				getManager: async () => {
					throw unavailable;
				},
			}),
		);

		const response = await parent.request("/api/plugins/bundled/narrator-team/status");

		expect(response.status).toBe(503);
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(await response.json()).toEqual({ code: "PLUGIN_MANAGER_UNAVAILABLE" });
	});

	test("domain routes: the router forwards its errors to the parent rather than swallowing them", () => {
		const handler = (novelDomainRoutes as unknown as { errorHandler: (error: Error, c: unknown) => unknown }).errorHandler;
		expect(() => handler(new Error("forwarded"), {})).toThrow("forwarded");
	});

	test("domain routes under the Runtime parent still answer the admin guard with JSON", async () => {
		const parent = runtimeParent(USER);
		parent.route("", novelDomainRoutes);

		const response = await parent.request("/api/market/lexicon", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: "{}",
		});

		expect(response.status).toBe(403);
		expect(response.headers.get("content-type")).toContain("application/json");
	});
});
