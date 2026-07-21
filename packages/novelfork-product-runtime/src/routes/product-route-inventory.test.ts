import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
	bookDomainRoutes,
	bookNarratorGatewayRoutes,
	bookWorkspaceRoutes,
	novelForkProductBooksRoutes,
} from "./books";
import { novelForkProductBookService } from "../services/book-provision";
import {
	getProductBootstrapCapabilities,
	PRODUCT_CONTRACT_VERSION,
} from "../services/product-contract";

function inventory(router: { routes: Array<{ method: string; path: string }> }): string[] {
	return router.routes.map((route) => `${route.method} ${route.path}`).sort();
}

describe("NovelFork product route inventory", () => {
	test("returns contract metadata from bootstrap without using flags as route gates", async () => {
		const listReadyBooks = novelForkProductBookService.listReadyBooks;
		const listBoundNarrators = novelForkProductBookService.listBoundNarrators;
		const originalFlag = process.env.NARRAFORK_FEATURE_RUNTIME_NARRATOR_PARITY;
		novelForkProductBookService.listReadyBooks = async () => [];
		novelForkProductBookService.listBoundNarrators = async () => [];
		process.env.NARRAFORK_FEATURE_RUNTIME_NARRATOR_PARITY = "true";
		try {
			const app = new Hono<{ Variables: { user: { sub: string; role: "admin" | "user" } } }>();
			app.use("*", async (c, next) => {
				c.set("user", { sub: "contract-user", role: "user" });
				await next();
			});
			app.route("/", novelForkProductBooksRoutes);
			const response = await app.request("/bootstrap");
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({
				contractVersion: PRODUCT_CONTRACT_VERSION,
				features: { runtimeNarratorParity: true },
				capabilities: getProductBootstrapCapabilities(),
				books: [],
				narrators: [],
			});
		} finally {
			novelForkProductBookService.listReadyBooks = listReadyBooks;
			novelForkProductBookService.listBoundNarrators = listBoundNarrators;
			if (originalFlag === undefined) delete process.env.NARRAFORK_FEATURE_RUNTIME_NARRATOR_PARITY;
			else process.env.NARRAFORK_FEATURE_RUNTIME_NARRATOR_PARITY = originalFlag;
		}
	});

	test("keeps the product bootstrap and book lifecycle surface explicit", () => {
		expect(inventory(novelForkProductBooksRoutes)).toEqual(
			[
				"DELETE /books/:bookId",
				"GET /books",
				"GET /books/:bookId/resources",
				"GET /books/:bookId/status",
				"GET /bootstrap",
				"POST /books",
				"POST /books/import",
				"POST /books/:bookId/claim",
				"POST /books/:bookId/rebind-workspace",
				"POST /books/:bookId/repair",
				"POST /books/:bookId/retry",
			].sort(),
		);
	});

	test("keeps workspace mutations constrained to chapter create and semantic resource save", () => {
		expect(inventory(bookWorkspaceRoutes)).toEqual(
			["GET /", "POST /chapters", "PUT /resources/:resourceId"].sort(),
		);
	});

	test("keeps book narrator history and creation on the trusted product gateway", () => {
		expect(inventory(bookNarratorGatewayRoutes)).toEqual(["GET /", "POST /"].sort());
	});

	test("exposes NewBookGuide completion endpoint on book domain routes", () => {
		const paths = inventory(bookDomainRoutes);
		expect(paths).toContain("POST /guided-setup");
	});
});
