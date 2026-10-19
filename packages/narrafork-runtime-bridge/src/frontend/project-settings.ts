/** Stable Studio-facing contract for embedding the native Runtime project settings surface. */
export interface EmbeddedProjectSettingsHostProps {
	/** Runtime project id the settings belong to (one book binds exactly one project). */
	readonly projectId: string;
	readonly loadingFallback?: unknown;
	/** Host-resolved color scheme: the embedded surface follows the host's light/dark switch. */
	readonly colorScheme?: "light" | "dark";
}

/**
 * Compile-time contract only. Vite and Vitest resolve this module specifier to
 * the Runtime-owned implementation; Studio must not duplicate Runtime pages.
 *
 * The surface covers what Runtime actually owns per project — project skills and the
 * project's routine/tool positions. MCP permissions, hooks and prompt/rule files have no
 * project-level Runtime surface, so a product-side copy of them would be a second
 * implementation of Runtime state; see the Runtime host component for the same note.
 */
export declare const EmbeddedProjectSettingsHost: (props: EmbeddedProjectSettingsHostProps) => any;
