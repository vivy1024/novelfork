import { dirname } from "node:path";
import { Hono } from "hono";
import { resolveBookStorageDir } from "@vivy1024/novelfork-core";
import {
	createJingweiRouter,
	createNarrativeMemoryRouter,
	createOverviewRouter,
	createWritingResourceRouter,
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

function resolveDomainBookRoot(bookId: string): string {
	return resolveBookStorageDir(dirname(getControlledBooksRoot()), bookId);
}

// novel-plugin intentionally owns its own Hono dependency. Both versions expose
// the same runtime router contract, but their private TypeScript fields differ.
function asRuntimeRouter(router: unknown): Hono {
	return router as Hono;
}

novelDomainRoutes.route(
	"",
	asRuntimeRouter(createWritingResourceRouter({
		resolveBookDir: resolveDomainBookRoot,
	})),
);
novelDomainRoutes.route("", asRuntimeRouter(createNarrativeMemoryRouter()));
novelDomainRoutes.route("", asRuntimeRouter(createOverviewRouter()));
novelDomainRoutes.route("", asRuntimeRouter(createJingweiRouter()));
