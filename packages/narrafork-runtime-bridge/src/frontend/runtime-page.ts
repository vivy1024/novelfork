/** Stable Studio-facing contract for embedding one native Runtime page. */
export interface EmbeddedRuntimePageHostProps {
	/** Runtime path to show, with search and hash (e.g. "/knowledge/abc?tab=links"). */
	readonly path: string;
	/** Whether the page may navigate to this pathname itself; anything else goes to the host. */
	readonly isEmbeddedPath: (pathname: string) => boolean;
	/** The page navigated within its scope; hosts mirror this into their own URL. */
	readonly onPathChange?: (path: string) => void;
	/** The page tried to leave its scope (a narrator link, the chat page…); the host decides. */
	readonly onNavigateOutside?: (path: string) => void;
	readonly loadingFallback?: unknown;
	/** Host-resolved color scheme: the embedded page follows the host's light/dark switch. */
	readonly colorScheme?: "light" | "dark";
}

/**
 * Compile-time contract only. Vite and Vitest resolve this module specifier to
 * the Runtime-owned implementation; Studio must not duplicate Runtime pages.
 */
export declare const EmbeddedRuntimePageHost: (props: EmbeddedRuntimePageHostProps) => any;
