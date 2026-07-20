import { NOVEL_RUNTIME_CONTRIBUTION } from "@vivy1024/novelfork-novel-plugin";
import type { ToolDefinition, ToolResult } from "@vivy1024/narrafork-runtime-bridge";
import { bookRuntimeBindingService } from "../services/book-binding";
import {
	type NovelRuntimeBindingResolver,
	NovelRuntimeHostAdapter,
} from "./runtime-host-adapter";

export type { NovelRuntimeBindingResolver } from "./runtime-host-adapter";

export const NOVEL_RUNTIME_TOOL_NAMES = new Set(
	(NOVEL_RUNTIME_CONTRIBUTION.tools ?? []).map((tool) => tool.definition.name),
);

/**
 * The only generic Runtime capability a product novelist may request. Every
 * other model-visible operation must be a trusted NovelFork contribution.
 */
export const NOVEL_PRODUCT_CORE_TOOL_NAMES: ReadonlySet<string> = new Set(["AskUserQuestion"]);

/**
 * Server-side product allowlist. A product narrator always receives the trusted
 * novel contribution and AskUserQuestion. Generic optional tools remain hidden
 * by default, but a project-level routine may deliberately opt one in; the
 * session has already resolved that override into `enabledOptionalToolNames`.
 *
 * Core generic file tools are never added to this set, so they remain excluded
 * unless a separately registered optional routine explicitly exposes them.
 */
export function isNovelProductToolAllowed(
	toolName: string,
	enabledOptionalToolNames: ReadonlySet<string>,
): boolean {
	return (
		NOVEL_PRODUCT_CORE_TOOL_NAMES.has(toolName) ||
		enabledOptionalToolNames.has(toolName)
	);
}

/** Keep existing optional-tool visibility synchronization compatible. */
export function syncNovelRuntimeToolVisibility(
	enabledToolNames: Set<string>,
	resolvedToolNames: readonly string[],
): void {
	for (const toolName of NOVEL_RUNTIME_TOOL_NAMES) enabledToolNames.delete(toolName);
	for (const toolName of resolvedToolNames) enabledToolNames.add(toolName);
}

/**
 * Compatibility facade for callers that imported the original adapter.
 * Trusted execution and validation live in NovelRuntimeHostAdapter.
 */
export class NovelRuntimeAdapter {
	readonly hostAdapter: NovelRuntimeHostAdapter;

	constructor(bindings: NovelRuntimeBindingResolver = bookRuntimeBindingService) {
		this.hostAdapter = new NovelRuntimeHostAdapter(bindings);
	}

	get host() {
		return this.hostAdapter.host;
	}

	resolve(narratorId: string) {
		return this.hostAdapter.resolve(narratorId);
	}

	resolveContribution(narratorId: string) {
		return this.hostAdapter.resolveContribution(narratorId);
	}

	resolveToolNames(narratorId: string) {
		return this.hostAdapter.resolveToolNames(narratorId);
	}

	promptExtensions(narratorId: string) {
		return this.hostAdapter.promptExtensions(narratorId);
	}

	toolDefinitions(): ToolDefinition[] {
		return this.hostAdapter.toolDefinitions();
	}

	execute(
		toolName: string,
		input: Readonly<Record<string, unknown>>,
		narratorId: string,
	): Promise<ToolResult> {
		return this.hostAdapter.execute(toolName, input, narratorId);
	}
}

/** One host per server process instance; no global host from Studio is reused. */
export const novelRuntimeAdapter = new NovelRuntimeAdapter();
