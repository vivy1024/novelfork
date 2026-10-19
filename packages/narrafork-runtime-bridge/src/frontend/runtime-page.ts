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
	/**
	 * Product settings merged into the native settings page: extra sidebar groups, the
	 * product's own appearance section and about body. Only the settings page reads it.
	 */
	readonly hostExtension?: EmbeddedSettingsExtension;
}

/** Minimal structural shape of the product settings extension (no Runtime types leak out). */
export interface EmbeddedSettingsExtension {
	readonly groups?: ReadonlyArray<{
		readonly id: string;
		readonly label: string;
		readonly pages: ReadonlyArray<{
			readonly id: string;
			readonly label: string;
			readonly Icon: unknown;
			readonly Component: unknown;
			readonly adminOnly?: boolean;
		}>;
	}>;
	readonly AppearanceSection?: unknown;
	readonly hidePluginThemes?: boolean;
	readonly About?: unknown;
	/** 套路页：插件贡献、可供自定义子代理勾选的额外工具名。 */
	readonly subagentTools?: ReadonlyArray<string>;
}

/**
 * Compile-time contract only. Vite and Vitest resolve this module specifier to
 * the Runtime-owned implementation; Studio must not duplicate Runtime pages.
 */
export declare const EmbeddedRuntimePageHost: (props: EmbeddedRuntimePageHostProps) => any;
