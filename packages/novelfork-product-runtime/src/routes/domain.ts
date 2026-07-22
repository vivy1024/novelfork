import { dirname, join } from "node:path";
import { Hono } from "hono";
import {
	getStorageDatabase,
	loadRuntimeStateSnapshot,
	resolveBookStorageDir,
	StateManager,
} from "@vivy1024/novelfork-core";
import {
	createComplianceRouter,
	createJingweiRouter,
	createNarrativeMemoryRouter,
	createOverviewRouter,
	createWritingResourceRouter,
	createWritingToolsRouter,
	type RouterContext,
} from "@vivy1024/novelfork-novel-plugin/routes";
import { getControlledBooksRoot } from "../services/book-binding";

/**
 * Novel-domain HTTP surface hosted by the NarraFork Runtime process.
 *
 * Authentication and book ownership are enforced by app.ts before this router
 * runs. The domain implementations remain owned by novel-plugin; this module
 * follows the server-side NovelFork repository binding only after that ACL guard.
 */
export const novelDomainRoutes = new Hono();

/**
 * Prefer the product binding's absolute book root (external workspaces included).
 * Fall back to the controlled books layout used by older local books.
 */
export function resolveDomainBookRoot(bookId: string): string {
	const normalized = bookId.trim();
	if (!normalized) return resolveBookStorageDir(dirname(getControlledBooksRoot()), bookId);
	try {
		const storage = getStorageDatabase();
		const row = storage.sqlite
			.prepare(`SELECT book_root FROM book_runtime_bindings WHERE book_id = ?`)
			.get(normalized) as { book_root?: string } | undefined;
		if (row?.book_root?.trim()) return row.book_root.trim();
	} catch {
		// Storage may not be initialized in pure unit contexts.
	}
	return resolveBookStorageDir(dirname(getControlledBooksRoot()), normalized);
}

class ProductBookStateManager extends StateManager {
	bookDir(bookId: string): string {
		return resolveDomainBookRoot(bookId);
	}
}

function createProductRouterContext(): RouterContext {
	const root = dirname(getControlledBooksRoot());
	const state = new ProductBookStateManager(root);
	return {
		state,
		root,
		broadcast: () => undefined,
		buildPipelineConfig: async () => {
			throw new Error("AI pipeline is not available from this product HTTP adapter");
		},
		getSessionLlm: async () => undefined,
		getRuntimeModelStatus: async () => ({ hasUsableModel: false }),
	};
}

// novel-plugin intentionally owns its own Hono dependency. Both versions expose
// the same runtime router contract, but their private TypeScript fields differ.
function asRuntimeRouter(router: unknown): Hono {
	return router as Hono;
}

const productRouterContext = createProductRouterContext();

novelDomainRoutes.route(
	"",
	asRuntimeRouter(
		createWritingResourceRouter({
			resolveBookDir: resolveDomainBookRoot,
		}),
	),
);
novelDomainRoutes.route(
	"",
	asRuntimeRouter(
		createNarrativeMemoryRouter({
			resolveBookRoot: resolveDomainBookRoot,
		}),
	),
);
novelDomainRoutes.route("", asRuntimeRouter(createOverviewRouter()));
novelDomainRoutes.route("", asRuntimeRouter(createJingweiRouter()));
// Workbench tool panels (arcs/health/progress/pov/…) previously existed only on
// the retired Studio server. Mount them on the product Runtime surface.
novelDomainRoutes.route("", asRuntimeRouter(createWritingToolsRouter(productRouterContext)));
novelDomainRoutes.route("", asRuntimeRouter(createComplianceRouter(productRouterContext)));

// Runtime state panel: knowledge / timeline / resource ledger from story/state.
novelDomainRoutes.get("/api/books/:bookId/state", async (c) => {
	const bookId = c.req.param("bookId");
	const bookDir = resolveDomainBookRoot(bookId);
	try {
		const snapshot = await loadRuntimeStateSnapshot(bookDir);
		return c.json({
			knowledge: snapshot.knowledge ?? { events: [] },
			timeline: snapshot.timeline ?? { entries: [] },
			resourceLedger: snapshot.resourceLedger ?? { resources: [] },
		});
	} catch {
		// External/new books may not have story/state yet — return empty panels.
		return c.json({
			knowledge: { events: [] },
			timeline: { entries: [] },
			resourceLedger: { resources: [] },
		});
	}
});

// Collaboration panel used legacy Studio /api/git/* routes. Prefer product book
// workspace root for commit history binding; worktrees remain best-effort empty
// until a Runtime-native worktree list is exposed for book projects.
novelDomainRoutes.get("/api/books/:bookId/collaboration-context", async (c) => {
	const bookId = c.req.param("bookId");
	const bookRoot = resolveDomainBookRoot(bookId);
	return c.json({
		repositoryPath: bookRoot,
		// Runtime chapter worktrees live under .narrafork-worktrees on the book root
		// when present; surface the directory path for the panel without requiring
		// the retired Studio git API.
		worktreeRoot: join(bookRoot, ".narrafork-worktrees"),
	});
});
