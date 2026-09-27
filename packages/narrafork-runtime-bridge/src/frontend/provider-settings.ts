/** Stable Studio-facing contract for the Runtime-owned Provider settings surface. */
export interface EmbeddedProviderSettingsHostProps {
	readonly loadingFallback?: unknown;
	/** Host-resolved color scheme: the embedded page follows the host's light/dark switch. */
	readonly colorScheme?: "light" | "dark";
}

/**
 * Compile-time contract only. Vite and Vitest resolve this module specifier to
 * the Runtime-owned implementation; Studio must not duplicate Provider logic.
 */
export declare const EmbeddedProviderSettingsHost: (
	props?: EmbeddedProviderSettingsHostProps,
) => any;
