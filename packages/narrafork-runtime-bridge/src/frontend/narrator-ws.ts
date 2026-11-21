/** Filters for a passive listener on Runtime's existing narrator connection. */
export interface NarratorWsListenerOptions {
	narratorIds?: string[];
	types?: string[];
}

/** Opaque to consumers; pass it back to removeListener. */
export interface NarratorWsListenerHandle {
	/** @internal */ readonly _id: number;
}

export interface NarratorWsManagerContract {
	addListener(
		options: NarratorWsListenerOptions,
		callback: (data: Record<string, unknown>) => void,
	): NarratorWsListenerHandle;
	removeListener(handle: NarratorWsListenerHandle): void;
}

/** Compile-time contract; Vite and Vitest use the same singleton as NarratorDock. */
export declare const narratorWSManager: NarratorWsManagerContract;
