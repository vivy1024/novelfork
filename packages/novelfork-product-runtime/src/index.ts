import { NOVEL_RUNTIME_CONTRIBUTION } from "@vivy1024/novelfork-novel-plugin";
import type { Context, Hono, Next } from "hono";
import {
	AppError,
	type RuntimeProductIntegration,
} from "@vivy1024/narrafork-runtime-bridge";
import {
	closeNovelRuntimeStorage,
	initializeNovelRuntimeStorage,
} from "./adapters/storage";
import {
	isNovelProductToolAllowed,
	novelRuntimeAdapter,
	syncNovelRuntimeToolVisibility,
} from "./adapters/runtime-adapter";
import {
	assertBookProductAccess,
	assertGeneralNarratorLifecycleAccess,
	assertRawNarratorAccess,
	assertRawPermissionAccess,
	bookDomainRoutes,
	bookNarratorGatewayRoutes,
	bookRuntimeCapabilitiesRoutes,
	bookWorkspaceRoutes,
	isGeneralNarratorLifecycleMutation,
	novelDomainRoutes,
	novelForkProductBooksRoutes,
	novelRuntimeBindingRoutes,
} from "./http";
import {
	canAccessBoundNarratorFromUserId,
	canAccessBoundPermissionFromUserId,
} from "./services/narrator-access";
import { migrateLegacySessions } from "./services/legacy-session-migration";
import {
	isNovelForkProductNarrator,
	resolveNovelForkNarratorCwd,
} from "./narrator-profile";
import { createNarratorAccessDeniedEvent } from "./websocket/product-ws-contract";

export {
	NOVELFORK_PRODUCT_NARRATOR_TRAIT,
	isNovelForkProductNarrator,
	resolveNovelForkNarratorCwd,
} from "./narrator-profile";

type ProductActor = { userId: string; role: "admin" | "user" };

async function resolveNovelForkTrustedPromptRoot(narratorId: string): Promise<string | null> {
	const context = await novelRuntimeAdapter.resolve(narratorId);
	const binding = context?.resourceBindings["novel.book"];
	return binding && typeof binding === "object" && "root" in binding && typeof binding.root === "string"
		? binding.root
		: null;
}

function actorFromContext(c: Context): ProductActor {
	const user = c.get("user") as { sub: string; role: "admin" | "user" };
	return { userId: user.sub, role: user.role };
}

async function guardNovelBookRoute(c: Context, next: Next): Promise<void> {
	// Runtime capability routes resolve their own canonical book/project gateway
	// and need to retain their uniform fail-closed error contract.
	if (/^\/api\/books\/[^/]+\/(?:routines|skills|hooks|mcp|rules)(?:\/|$)/u.test(c.req.path)) {
		await next();
		return;
	}
	const bookId = c.req.param("bookId");
	if (!bookId) throw new AppError("Book id is required", 400, "VALIDATION_ERROR");
	await assertBookProductAccess(actorFromContext(c), bookId);
	await next();
}

async function guardRawNarratorRoute(c: Context, next: Next): Promise<void> {
	const narratorId = c.req.param("id");
	if (!narratorId) throw new AppError("Narrator id is required", 400, "VALIDATION_ERROR");
	const actor = actorFromContext(c);
	await assertRawNarratorAccess(actor, narratorId);
	if (isGeneralNarratorLifecycleMutation(c.req.method, c.req.path, narratorId)) {
		await assertGeneralNarratorLifecycleAccess(actor, narratorId);
	}
	await next();
}

/**
 * T0 NovelFork product adapter. It runs in the same trusted process as the
 * Runtime, but stays outside the Runtime source tree so upstream syncs do not
 * overwrite product behavior.
 */
export const novelForkProductIntegration: RuntimeProductIntegration = {
	id: "novelfork",
	isProductNarrator: isNovelForkProductNarrator,
	resolveNarratorCwd: resolveNovelForkNarratorCwd,
	initialize: async () => {
		initializeNovelRuntimeStorage();
		await migrateLegacySessions();
	},
	shutdown: closeNovelRuntimeStorage,
	mountAuthenticatedGuards(app: Hono): void {
		app.use("/api/books/:bookId", guardNovelBookRoute);
		app.use("/api/books/:bookId/*", guardNovelBookRoute);
		app.use("/api/narrators/permissions/:requestId/*", async (c, next) => {
			await assertRawPermissionAccess(actorFromContext(c), c.req.param("requestId"));
			await next();
		});
		app.use("/api/narrators/:id", guardRawNarratorRoute);
		app.use("/api/narrators/:id/*", guardRawNarratorRoute);
	},
	mountAuthenticatedRoutes(app: Hono): void {
		app.route("/api/novelfork", novelForkProductBooksRoutes);
		app.route("/api/books/:bookId", bookDomainRoutes);
		app.route("/api/books/:bookId", bookRuntimeCapabilitiesRoutes);
		app.route("/api/books/:bookId/workspace", bookWorkspaceRoutes);
		app.route("/api/books/:bookId/narrators", bookNarratorGatewayRoutes);
		app.route("", novelDomainRoutes);
	},
	mountRuntimeBindingRoutes(app: Hono): void {
		app.route("/api/novel/runtime-bindings", novelRuntimeBindingRoutes);
	},
	learningContributions: () =>
		NOVEL_RUNTIME_CONTRIBUTION.learning ? [NOVEL_RUNTIME_CONTRIBUTION.learning] : [],
	narrator: {
		resolve: (narratorId) => novelRuntimeAdapter.resolve(narratorId),
		resolveContribution: (narratorId) => novelRuntimeAdapter.resolveContribution(narratorId),
		resolveToolNames: (narratorId) => novelRuntimeAdapter.resolveToolNames(narratorId),
		resolveTrustedPromptRoot: resolveNovelForkTrustedPromptRoot,
		toolDefinitions: () => novelRuntimeAdapter.toolDefinitions(),
		isToolAllowed: isNovelProductToolAllowed,
		syncToolVisibility: syncNovelRuntimeToolVisibility,
	},
	canAccessNarratorState: ({ userId, narratorId }) =>
		canAccessBoundNarratorFromUserId(userId, narratorId),
	canAccessPermission: ({ userId, requestId }) =>
		canAccessBoundPermissionFromUserId(userId, requestId),
	createNarratorAccessDeniedEvent,
};
