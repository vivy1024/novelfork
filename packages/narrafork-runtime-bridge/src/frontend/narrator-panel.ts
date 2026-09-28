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

/** A file the narrator panel is about to open in its own file panel. */
export interface RuntimeFileOpenRequest {
	readonly filePath: string;
	readonly deviceId: string;
	/** True when the panel would show a tool edit's diff rather than the plain file. */
	readonly toolEdit: boolean;
}

/** Return true when the host opened the file itself; the Runtime file panel then stays closed. */
export type RuntimeFileOpenInterceptor = (request: RuntimeFileOpenRequest) => boolean;

/** Stable Studio-facing contract for the Runtime-owned narrator dock. */
export interface EmbeddedNarratorDockHostProps {
	readonly narratorId: string;
	readonly highlightMessageId?: string;
	readonly onForkFromMessage?: (messageUuid: string) => void;
	readonly compact?: boolean;
	readonly toolResultRenderer?: RuntimeToolResultRenderer;
	/** Lets the host open some files (e.g. chapters) in its own editor. */
	readonly onOpenFile?: RuntimeFileOpenInterceptor;
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
