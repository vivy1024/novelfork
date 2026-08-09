import { NOVEL_RUNTIME_CONTRIBUTION } from "@vivy1024/novelfork-novel-plugin";
import type { ToolDefinition, ToolResult } from "@vivy1024/narrafork-runtime-bridge";
import { bookRuntimeBindingService } from "../services/book-binding";
import {
	type NovelBindingDiagnosticSink,
	type NovelRuntimeBindingResolver,
	NovelRuntimeHostAdapter,
	toRuntimeToolName,
} from "./runtime-host-adapter";

export type {
	NovelBindingDiagnosis,
	NovelBindingDiagnosticSink,
	NovelRuntimeBindingResolver,
} from "./runtime-host-adapter";

export const NOVEL_RUNTIME_TOOL_NAMES = new Set(
	(NOVEL_RUNTIME_CONTRIBUTION.tools ?? []).map((tool) => toRuntimeToolName(tool.definition.name)),
);

/**
 * @deprecated Product narrators no longer hard-allowlist tools. Kept for
 * callers that still import the constant; prefer Runtime-native toolFilter.
 */
export const NOVEL_PRODUCT_CORE_TOOL_NAMES: ReadonlySet<string> = new Set(["AskUserQuestion"]);

/**
 * Product narrators no longer apply a second hard allowlist on top of Runtime.
 * Visibility matches native NarraFork:
 * - core tools (Bash/Read/Write/Edit/…) are available by default
 * - optional tools stay gated by session `_enabledOptionalTools` (routines / `/load`)
 * - session details can still disable tools via custom-traits disabled-tools
 *
 * `enabledOptionalToolNames` is kept for SPI compatibility; the Runtime
 * toolFilter applies the optional-tool gate after this check returns true.
 */
export function isNovelProductToolAllowed(
	toolName: string,
	enabledOptionalToolNames: ReadonlySet<string>,
	context?: Readonly<{ permissionMode?: import("@vivy1024/narrafork-runtime-bridge").SessionPermissionMode | string; isAdvancedEnabled?: boolean }>,
): boolean {
	return novelRuntimeAdapter.hostAdapter.isToolAllowed(toolName, enabledOptionalToolNames, context);
}

/** Keep existing optional-tool visibility synchronization compatible. */
export function syncNovelRuntimeToolVisibility(
	enabledToolNames: Set<string>,
	resolvedToolNames: readonly string[],
	context?: Readonly<{ isAdvancedEnabled?: boolean; permissionMode?: import("@vivy1024/narrafork-runtime-bridge").SessionPermissionMode | string }>,
): void {
	novelRuntimeAdapter.hostAdapter.syncToolVisibility(enabledToolNames, resolvedToolNames, context);
}

/**
 * Compatibility facade for callers that imported the original adapter.
 * Trusted execution and validation live in NovelRuntimeHostAdapter.
 */
export class NovelRuntimeAdapter {
	readonly hostAdapter: NovelRuntimeHostAdapter;

	constructor(
		bindings: NovelRuntimeBindingResolver = bookRuntimeBindingService,
		diagnosticSink?: NovelBindingDiagnosticSink,
	) {
		this.hostAdapter = diagnosticSink
			? new NovelRuntimeHostAdapter(bindings, diagnosticSink)
			: new NovelRuntimeHostAdapter(bindings);
	}

	diagnoseBinding(narratorId: string) {
		return this.hostAdapter.diagnoseBinding(narratorId);
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
