/** Stable Studio-facing contract for the Runtime-owned Provider settings surface. */
export interface EmbeddedProviderSettingsHostProps {
	readonly loadingFallback?: unknown;
}

/**
 * Compile-time contract only. Vite and Vitest resolve this module specifier to
 * the Runtime-owned implementation; Studio must not duplicate Provider logic.
 */
export declare const EmbeddedProviderSettingsHost: (
	props?: EmbeddedProviderSettingsHostProps,
) => any;
