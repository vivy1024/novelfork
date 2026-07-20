/** Filters accepted by the Runtime query cache invalidation API used by Studio. */
export interface RuntimeQueryInvalidationFilters {
	readonly queryKey?: readonly unknown[];
}

/** Minimal Runtime query-cache surface required by the NovelFork product shell. */
export interface RuntimeQueryClient {
	invalidateQueries(filters?: RuntimeQueryInvalidationFilters): Promise<void>;
}

/**
 * Compile-time contract only. Vite and Vitest resolve this module specifier to
 * Runtime's singleton query client, preserving cache sharing with NarratorPanel.
 */
export declare const queryClient: RuntimeQueryClient;
