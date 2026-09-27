/** Host-owned follow-up from a product tool-result card. */
export interface RuntimeToolResultAction {
	readonly type: string;
	readonly toolName: string;
	readonly input: Readonly<Record<string, unknown>>;
}

/** Public input for a host-provided Runtime tool-result renderer. */
export interface RuntimeToolResultRendererInput {
	readonly toolName: string;
	readonly renderer: string;
	readonly result: unknown;
	readonly onAction?: (
		action: RuntimeToolResultAction,
	) => Promise<unknown> | unknown;
}

/** Optional presentation hook supplied by a product shell. */
export type RuntimeToolResultRenderer = (
	input: RuntimeToolResultRendererInput,
) => unknown;

/** Stable Studio-facing contract for the Runtime-owned narrator dock. */
export interface EmbeddedNarratorDockHostProps {
	readonly narratorId: string;
	readonly highlightMessageId?: string;
	readonly onForkFromMessage?: (messageUuid: string) => void;
	readonly compact?: boolean;
	readonly toolResultRenderer?: RuntimeToolResultRenderer;
	/** Host-resolved color scheme: the embedded panel follows the host's light/dark switch. */
	readonly colorScheme?: "light" | "dark";
}

/**
 * Compile-time contract only. Vite and Vitest resolve this module specifier to
 * the Runtime-owned implementation so NovelFork never ships a copied panel.
 */
export declare const EmbeddedNarratorDockHost: (
	props: EmbeddedNarratorDockHostProps,
) => any;
