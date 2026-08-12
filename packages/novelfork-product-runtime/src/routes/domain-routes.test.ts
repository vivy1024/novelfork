import { describe, expect, test } from "bun:test";
import { novelDomainRoutes, resolveDomainBookRoot } from "./domain";

function inventory(router: { routes: Array<{ method: string; path: string }> }): string[] {
	return router.routes.map((route) => `${route.method} ${route.path}`).sort();
}

describe("novel domain product routes", () => {
	test("mounts workbench writing-tools and state endpoints", () => {
		const paths = inventory(novelDomainRoutes);
		// Writing tools
		expect(paths).toContain("GET /api/books/:bookId/arcs");
		expect(paths).toContain("GET /api/books/:bookId/health");
		expect(paths).not.toContain("GET /api/progress");
		expect(paths).not.toContain("PUT /api/progress/config");
		// Narrative-memory config and current ledger use the product book binding.
		expect(paths).toContain("GET /api/books/:bookId/narrative-memory/config");
		expect(paths).toContain("PUT /api/books/:bookId/narrative-memory/config");
		expect(paths).toContain("GET /api/books/:bookId/narrative-memory/current");
		// Runtime state panel
		expect(paths).toContain("GET /api/books/:bookId/state");
		// Collaboration context for external book binding
		expect(paths).toContain("GET /api/books/:bookId/collaboration-context");
		// Compliance panel
		expect(paths.some((p) => p.includes("/compliance/"))).toBe(true);
		expect(paths).toContain("POST /api/filter/scan");
	});

	test("resolveDomainBookRoot falls back when storage is unavailable", () => {
		// Without initialized storage the helper must not throw.
		const root = resolveDomainBookRoot("nonexistent-book-xyz");
		expect(typeof root).toBe("string");
		expect(root.length).toBeGreaterThan(0);
	});
});
