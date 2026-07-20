/**
 * NovelFork product HTTP integration boundary for the complete NarraFork Runtime.
 * Runtime app.ts mounts these routes and guards without owning novel-domain logic.
 */

export {
	assertBookProductAccess,
	bookDomainRoutes,
	bookNarratorGatewayRoutes,
	bookWorkspaceRoutes,
	novelForkProductBooksRoutes,
} from "./routes/books";
export { novelDomainRoutes } from "./routes/domain";
export { novelRuntimeBindingRoutes } from "./routes/runtime-bindings";
export { createBookRuntimeCapabilitiesRoutes } from "./routes/runtime-capabilities";
export { bookRuntimeCapabilitiesRoutes } from "./routes/runtime-capabilities-default";
export {
	assertGeneralNarratorLifecycleAccess,
	assertRawNarratorAccess,
	assertRawPermissionAccess,
	isBoundNovelNarrator,
	isGeneralNarratorLifecycleMutation,
} from "./services/narrator-access";
