import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type {
	RuntimeProductHostServices,
	RuntimeProductTextGenerationOptions,
	RuntimeProductTextGenerationRequest,
	RuntimeProductTextModelRole,
} from "@vivy1024/narrafork-runtime-bridge";
import { createProductTextGenerationResolver, novelDomainRoutes } from "./domain";

type ResolverContext = Parameters<ReturnType<typeof createProductTextGenerationResolver>>[0];

function contextFor(user: unknown): ResolverContext {
	return { get: (key: string) => (key === "user" ? user : undefined) } as unknown as ResolverContext;
}

function fakeServices(available: boolean) {
	const statusRoles: Array<RuntimeProductTextModelRole | undefined> = [];
	const calls: Array<{ request: RuntimeProductTextGenerationRequest; options: RuntimeProductTextGenerationOptions }> = [];
	const services: RuntimeProductHostServices = {
		async getTextGenerationStatus(modelRole) {
			statusRoles.push(modelRole);
			return available
				? { available: true, modelRole: "default", provider: "anthropic", model: "main" }
				: { available: false, modelRole: "default", code: "MODEL_NOT_CONFIGURED", message: "No default model" };
		},
		async generateText(request, options) {
			calls.push({ request, options });
			return { text: "生成", model: "anthropic:main" };
		},
	};
	return { services, statusRoles, calls };
}

describe("product text generation resolver", () => {
	test("binds generation to the authenticated user and the Runtime default model", async () => {
		const { services, statusRoles, calls } = fakeServices(true);
		const resolve = createProductTextGenerationResolver(services);

		const generation = await resolve(contextFor({ sub: "user-1", role: "user" }));
		expect(generation).toMatchObject({ available: true, model: "anthropic:main" });
		if (!generation.available) throw new Error("expected available generation");
		const result = await generation.generateText({
			messages: [{ role: "user", content: "续写" }],
			temperature: 0.7,
			maxTokens: 1024,
		});

		expect(result).toEqual({ text: "生成", model: "anthropic:main" });
		expect(statusRoles).toEqual(["default"]);
		expect(calls).toEqual([
			{
				request: { messages: [{ role: "user", content: "续写" }], temperature: 0.7, maxTokens: 1024, modelRole: "default" },
				options: { userId: "user-1" },
			},
		]);
	});

	test("refuses requests without an authenticated user before asking the Runtime", async () => {
		const { services, statusRoles } = fakeServices(true);
		const resolve = createProductTextGenerationResolver(services);

		expect(await resolve(contextFor(undefined))).toMatchObject({ available: false, code: "UNAUTHENTICATED" });
		expect(await resolve(contextFor({ sub: "  " }))).toMatchObject({ available: false, code: "UNAUTHENTICATED" });
		expect(statusRoles).toEqual([]);
	});

	test("explains an unconfigured default model in author-facing words", async () => {
		const { services, calls } = fakeServices(false);
		const generation = await createProductTextGenerationResolver(services)(contextFor({ sub: "user-1" }));

		expect(generation).toEqual({
			available: false,
			code: "MODEL_NOT_CONFIGURED",
			message: "Runtime 还没有设置默认模型。",
			suggestedAction: "在设置里配置 AI 供应商并选定默认模型后重试。",
		});
		expect(calls).toEqual([]);
	});

	test("the real Runtime reports a fresh install without a default model through the bridge", async () => {
		const generation = await createProductTextGenerationResolver()(contextFor({ sub: "user-1" }));
		expect(generation).toMatchObject({ available: false, code: "MODEL_NOT_CONFIGURED" });
	});

	test("an authenticated writing-mode request falls back to a prompt preview with an explanation", async () => {
		const app = new Hono();
		app.use(async (c, next) => {
			c.set("user" as never, { sub: "user-1", role: "user" } as never);
			await next();
		});
		app.route("", novelDomainRoutes);

		const response = await app.request("/api/books/book-a/inline-write", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ mode: "continuation", selectedText: "她停在门前。" }),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			mode: "prompt-preview",
			reason: "model-unavailable",
			modelUnavailableCode: "MODEL_NOT_CONFIGURED",
			explanation: { what: "Runtime 还没有设置默认模型。", next: expect.any(String) },
		});
	});
});
