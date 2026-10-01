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
		// 关系图谱：按实体 id 查询实体索引
		expect(paths).toContain("GET /api/books/:bookId/narrative-memory/entity-graph/entities");
		expect(paths).toContain("GET /api/books/:bookId/narrative-memory/entity-graph/network");
		expect(paths).toContain("GET /api/books/:bookId/narrative-memory/entity-graph/relations");
		expect(paths).toContain("GET /api/books/:bookId/narrative-memory/entity-graph/pair");
		expect(paths).toContain("GET /api/books/:bookId/narrative-memory/entity-graph/path");
		expect(paths).toContain("POST /api/books/:bookId/narrative-memory/entity-index/rebuild");
		// Runtime state panel
		expect(paths).toContain("GET /api/books/:bookId/state");
		// Collaboration context for external book binding
		expect(paths).toContain("GET /api/books/:bookId/collaboration-context");
		// 「待确认」聚合（只读）：声线/文风规则/伏笔/待审事件/事实与改稿段一次聚齐
		expect(paths).toContain("GET /api/books/:bookId/pending-review");
		// Compliance panel
		expect(paths.some((p) => p.includes("/compliance/"))).toBe(true);
		expect(paths).toContain("POST /api/filter/scan");
		expect(paths).toContain("GET /api/market/ranks");
		expect(paths).toContain("POST /api/books/:bookId/style/distillations/preview");
		expect(paths).toContain("POST /api/books/:bookId/style/distillations/jobs");
		expect(paths).toContain("GET /api/books/:bookId/style/distillations/jobs/:jobId");
		expect(paths).toContain("POST /api/market/ranks/custom");
		expect(paths).toContain("POST /api/market/ranks/probe");
		expect(paths).toContain("DELETE /api/market/ranks/custom/:key");
		expect(paths).toContain("GET /api/market/scan-prefs");
		expect(paths).toContain("PUT /api/market/scan-prefs");
		expect(paths).toContain("GET /api/market/lexicon");
		expect(paths).toContain("PUT /api/market/lexicon");
		expect(paths).toContain("GET /api/market/snapshots");
		expect(paths).toContain("POST /api/market/scan");
		expect(paths).toContain("GET /api/embedding");
		expect(paths).toContain("PUT /api/embedding");
		expect(paths).toContain("POST /api/embedding/test");
	});

	test("resolveDomainBookRoot falls back when storage is unavailable", () => {
		// Without initialized storage the helper must not throw.
		const root = resolveDomainBookRoot("nonexistent-book-xyz");
		expect(typeof root).toBe("string");
		expect(root.length).toBeGreaterThan(0);
	});
});
