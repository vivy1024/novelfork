import {
	type ContributedToolPermissionPolicy,
	type RuntimeToolRisk,
	type SessionPermissionMode,
	type ToolContext,
	type ToolDefinition,
	type ToolResult,
	type ToolVisibility,
	type ResolvedRuntimeContributions,
	type RuntimeResolveContext,
} from "@vivy1024/narrafork-runtime-bridge";
import {
	RuntimePluginHost,
	type PortableJsonValue,
	type RuntimeResolveContext as PluginRuntimeResolveContext,
	type RuntimeResourceBinding as PluginRuntimeResourceBinding,
	type RuntimeToolContribution,
	type ToolExecutionContext as PluginToolExecutionContext,
} from "@vivy1024/novelfork-core/plugins";
import {
	NOVEL_RUNTIME_CONTRIBUTION,
	getNovelToolPermissionPolicy,
} from "@vivy1024/novelfork-novel-plugin";
import { z } from "zod/v4";

const FORBIDDEN_MODEL_FIELDS = new Set([
  "bookId",
  "sessionId",
  "bookRoot",
  "skipContextGate",
  "writePreflight",
]);

function findForbiddenModelField(value: unknown, path = "$input"): string | null {
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index += 1) {
			const nested = findForbiddenModelField(value[index], `${path}[${index}]`);
			if (nested) return nested;
		}
		return null;
	}
	if (!value || typeof value !== "object") return null;
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		const childPath = `${path}.${key}`;
		if (FORBIDDEN_MODEL_FIELDS.has(key)) return childPath;
		const nested = findForbiddenModelField(child, childPath);
		if (nested) return nested;
	}
	return null;
}

/**
 * Clone JSON Schema objects into closed-world input schemas for model-originated values.
 *
 * 只收紧声明了 properties 的对象。自由载荷对象（scene.spec 的 cockpitSnapshot /
 * loreBrief / memoryContext / writePreflight、memory.update 的 patch 等）没有字段清单，
 * 收紧后会把工具自己产出、由模型原样回传的真实数据全部判非法。宿主字段走私仍由
 * containsHostControlledField 递归拦截。
 */
function closeSchemaObjects(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(closeSchemaObjects);
	if (!value || typeof value !== "object") return value;
	const source = value as Record<string, unknown>;
	const normalized: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(source)) {
		normalized[key] = closeSchemaObjects(child);
	}
	const declaresProperties = Boolean(
		source.properties && typeof source.properties === "object" && !Array.isArray(source.properties),
	);
	if (source.type === "object" && declaresProperties) normalized.additionalProperties = false;
	return normalized;
}

function isPortableJsonValue(value: unknown, ancestors = new WeakSet<object>()): value is PortableJsonValue {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (!value || typeof value !== "object") return false;
	if (ancestors.has(value)) return false;
	ancestors.add(value);
	try {
		return Array.isArray(value)
			? value.every((entry) => isPortableJsonValue(entry, ancestors))
			: Object.values(value).every((entry) => isPortableJsonValue(entry, ancestors));
	} finally {
		ancestors.delete(value);
	}
}

/** Convert the Runtime bridge's broad binding payload into the portable plugin contract. */
function toPluginRuntimeResolveContext(
	context: RuntimeResolveContext,
): PluginRuntimeResolveContext | null {
	const resourceBindings: Record<string, PluginRuntimeResourceBinding> = {};
	for (const [id, binding] of Object.entries(context.resourceBindings)) {
		if (
			!binding ||
			typeof binding !== "object" ||
			Array.isArray(binding) ||
			typeof binding.kind !== "string" ||
			typeof binding.root !== "string" ||
			!isPortableJsonValue(binding)
		) {
			return null;
		}
		resourceBindings[id] = binding as PluginRuntimeResourceBinding;
	}
	return {
		runtimeProjectId: context.runtimeProjectId,
		projectRoot: context.projectRoot,
		projectType: context.projectType,
		enabledPluginIds: context.enabledPluginIds,
		...(context.sessionId ? { sessionId: context.sessionId } : {}),
		resourceBindings,
	};
}

export interface NovelBindingDiagnosis {
	readonly status: "unbound" | "trusted" | "untrusted";
	readonly reason?: string;
	readonly explanation?: string;
	readonly binding?: { readonly bookId: string; readonly bookRoot: string };
}

export interface NovelRuntimeBindingResolver {
	resolveForNarrator(narratorId: string): Promise<RuntimeResolveContext | null>;
	/**
	 * Optional. When present, a failed contribution resolution can tell an
	 * author-facing broken binding apart from a narrator that was never bound.
	 */
	diagnoseForNarrator?(narratorId: string): Promise<NovelBindingDiagnosis>;
}

/** Reports a broken book binding once per narrator+reason, so it cannot spam a turn loop. */
export interface NovelBindingDiagnosticSink {
	(event: {
		readonly narratorId: string;
		readonly reason: string;
		readonly explanation: string;
		readonly bookId?: string;
		readonly bookRoot?: string;
	}): void;
}

function defaultBindingDiagnosticSink(event: {
	narratorId: string;
	reason: string;
	explanation: string;
	bookId?: string;
	bookRoot?: string;
}): void {
	// Lazy import keeps the product adapter usable in unit tests that never boot
	// the Runtime logger.
	void import("@vivy1024/narrafork-runtime-bridge")
		.then(({ logger }) => {
			logger.error("Novel domain tools unavailable: book binding is not trusted", event);
		})
		.catch(() => {
			// A missing logger must never break tool resolution.
		});
}

const RUNTIME_TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

type RuntimeToolNameAlias = Readonly<{
	canonical: string;
	wire: string;
}>;

export function toRuntimeToolName(canonicalName: string): string {
	return canonicalName.replace(/\./g, "_");
}

function createRuntimeToolNameAliases(): Readonly<{
	aliases: readonly RuntimeToolNameAlias[];
	canonicalToWire: ReadonlyMap<string, string>;
	wireToCanonical: ReadonlyMap<string, string>;
}> {
	const aliases: RuntimeToolNameAlias[] = [];
	const canonicalToWire = new Map<string, string>();
	const wireToCanonical = new Map<string, string>();

	for (const tool of NOVEL_RUNTIME_CONTRIBUTION.tools ?? []) {
		const canonical = tool.definition.name;
		const wire = toRuntimeToolName(canonical);
		if (!RUNTIME_TOOL_NAME_PATTERN.test(wire)) {
			throw new Error(`小说工具名不符合 Runtime provider 约束：${canonical} -> ${wire}`);
		}
		const previousCanonical = wireToCanonical.get(wire);
		if (previousCanonical && previousCanonical !== canonical) {
			throw new Error(`小说工具名归一化冲突：${previousCanonical} 与 ${canonical} 都映射到 ${wire}`);
		}
		canonicalToWire.set(canonical, wire);
		wireToCanonical.set(wire, canonical);
		aliases.push({ canonical, wire });
	}

	return {
		aliases: aliases.sort((left, right) => right.canonical.length - left.canonical.length),
		canonicalToWire,
		wireToCanonical,
	};
}

function toRuntimeRisk(risk: string | undefined): RuntimeToolRisk {
	if (risk === "read" || risk === "draft-write" || risk === "confirmed-write" || risk === "destructive") return risk;
	// An incomplete or future contribution must not silently become a read tool.
	return "confirmed-write";
}

function errorResult(
	error: string,
	summary: string,
	toolName: string,
	metadata: Record<string, unknown> = {},
): ToolResult {
	return {
		output: JSON.stringify({ ok: false, error, summary }),
		isError: true,
		metadata: {
			runtimePluginId: NOVEL_RUNTIME_CONTRIBUTION.id,
			toolName,
			...metadata,
		},
	};
}

/**
 * Private Runtime trust boundary for portable NovelFork contributions.
 *
 * Tool input is always parsed from the contribution's JSON Schema before a
 * handler runs. Resource bindings and session identity come exclusively from
 * the trusted narrator binding resolver, never from model tool input.
 */
export class NovelRuntimeHostAdapter {
	readonly host = new RuntimePluginHost();
	private readonly validators = new WeakMap<object, z.ZodType>();
	private readonly reportedBindingFailures = new Set<string>();
	private readonly toolNameAliases = createRuntimeToolNameAliases();

	constructor(
		private readonly bindings: NovelRuntimeBindingResolver,
		private readonly diagnosticSink: NovelBindingDiagnosticSink = defaultBindingDiagnosticSink,
	) {
		this.host.register(NOVEL_RUNTIME_CONTRIBUTION);
	}

	async resolve(narratorId: string): Promise<RuntimeResolveContext | null> {
		return this.bindings.resolveForNarrator(narratorId);
	}

	async resolveContribution(narratorId: string): Promise<ResolvedRuntimeContributions | null> {
		const context = await this.resolve(narratorId);
		const pluginContext = context ? toPluginRuntimeResolveContext(context) : null;
		const resolved = pluginContext ? this.host.resolve(pluginContext) : null;
		// An empty contribution is what strips every novel domain tool from the
		// session. Report the author-facing cause instead of failing silently.
		if (!resolved) {
			await this.reportUnresolvedBinding(narratorId);
			return null;
		}

		// Runtime later validates the final provider-facing name with
		// /^[A-Za-z0-9_-]{1,64}$/, so the product boundary must expose wire names
		// here rather than letting dotted catalog names disappear at the last step.
		return {
			...resolved,
			tools: resolved.tools.map((tool) => ({
				...tool,
				definition: {
					...tool.definition,
					name: this.toWireToolName(tool.definition.name),
				},
			})),
			promptExtensions: resolved.promptExtensions.map((extension) => ({
				...extension,
				content: this.toModelFacingText(extension.content),
			})),
		};
	}

	/**
	 * Author-facing answer to "why does this book narrator have no novel tools?".
	 * Returns `unbound` for narrators that were never bound to a book.
	 */
	async diagnoseBinding(narratorId: string): Promise<NovelBindingDiagnosis> {
		if (!this.bindings.diagnoseForNarrator) {
			const context = await this.resolve(narratorId).catch(() => null);
			return { status: context ? "trusted" : "unbound" };
		}
		return this.bindings.diagnoseForNarrator(narratorId);
	}

	private async reportUnresolvedBinding(narratorId: string): Promise<void> {
		if (!this.bindings.diagnoseForNarrator) return;
		const diagnosis = await this.bindings.diagnoseForNarrator(narratorId).catch(() => null);
		// "unbound" is a normal standalone narrator, not a defect worth reporting.
		if (!diagnosis || diagnosis.status !== "untrusted") return;
		const reason = diagnosis.reason ?? "unknown";
		const key = `${narratorId}:${reason}`;
		if (this.reportedBindingFailures.has(key)) return;
		this.reportedBindingFailures.add(key);
		this.diagnosticSink({
			narratorId,
			reason,
			explanation: diagnosis.explanation ?? "书籍绑定未通过可信性校验，本会话不会加载小说领域工具。",
			...(diagnosis.binding ? { bookId: diagnosis.binding.bookId, bookRoot: diagnosis.binding.bookRoot } : {}),
		});
	}

	async resolveToolNames(narratorId: string): Promise<string[]> {
		const resolved = await this.resolveContribution(narratorId);
		return resolved ? resolved.tools.map((tool) => tool.definition.name) : [];
	}

	async promptExtensions(narratorId: string): Promise<readonly string[]> {
		const resolved = await this.resolveContribution(narratorId);
		return resolved ? resolved.promptExtensions.map((extension) => extension.content) : [];
	}

	private toWireToolName(canonicalName: string): string {
		return this.toolNameAliases.canonicalToWire.get(canonicalName) ?? canonicalName;
	}

	private toCanonicalToolName(wireName: string): string {
		return this.toolNameAliases.wireToCanonical.get(wireName) ?? wireName;
	}

	private toModelFacingText(text: string): string {
		let translated = text;
		for (const { canonical, wire } of this.toolNameAliases.aliases) {
			translated = translated.replaceAll(canonical, wire);
		}
		return translated;
	}

	toolDefinitions(): ToolDefinition[] {
		return (NOVEL_RUNTIME_CONTRIBUTION.tools ?? []).map((tool) => this.toToolDefinition(tool));
	}

	getToolPermissionPolicy(toolName: string): ContributedToolPermissionPolicy | null {
		const policy = getNovelToolPermissionPolicy(this.toCanonicalToolName(toolName));
		if (!policy) return null;
		return {
			risk: policy.risk,
			enabledForModes: policy.enabledForModes,
			visibility: policy.visibility,
			...(policy.resolveRisk ? { resolveRisk: policy.resolveRisk } : {}),
		};
	}

	isToolAllowed(
		toolName: string,
		enabledOptionalToolNames: ReadonlySet<string>,
		context?: Readonly<{ permissionMode?: SessionPermissionMode | string; isAdvancedEnabled?: boolean }>,
	): boolean {
		const policy = this.getToolPermissionPolicy(toolName);
		if (!policy) return true;

		if (context?.permissionMode) {
			const mode = context.permissionMode as SessionPermissionMode;
			if (policy.enabledForModes.length > 0 && !policy.enabledForModes.includes(mode)) {
				return false;
			}
		}

		if (policy.visibility === "advanced") {
			const canonicalToolName = this.toCanonicalToolName(toolName);
			return context?.isAdvancedEnabled === true
				|| enabledOptionalToolNames.has(toolName)
				|| enabledOptionalToolNames.has(canonicalToolName);
		}
		return true;
	}

	syncToolVisibility(
		enabledToolNames: Set<string>,
		resolvedToolNames: readonly string[],
		context?: Readonly<{ isAdvancedEnabled?: boolean; permissionMode?: SessionPermissionMode | string }>,
	): void {
		const explicitlyEnabled = new Set(
			[...enabledToolNames].map((name) => this.toWireToolName(name)),
		);
		const registeredNames = new Set([
			...this.toolNameAliases.canonicalToWire.keys(),
			...this.toolNameAliases.canonicalToWire.values(),
		]);
		for (const name of registeredNames) enabledToolNames.delete(name);
		for (const name of resolvedToolNames) {
			const policy = this.getToolPermissionPolicy(name);
			if (!policy) continue;
			if (policy.visibility === "author" || explicitlyEnabled.has(name)) {
				enabledToolNames.add(name);
			}
		}
	}

	async execute(
		toolName: string,
		input: Readonly<Record<string, unknown>>,
		execution: string | Pick<ToolContext, "narratorId" | "provider" | "model" | "generateText" | "emitOutput">,
	): Promise<ToolResult> {
		const narratorId = typeof execution === "string" ? execution : execution.narratorId;
		const canonicalToolName = this.toCanonicalToolName(toolName);
		const context = await this.resolve(narratorId);
		const pluginContext = context ? toPluginRuntimeResolveContext(context) : null;
		if (!context || !pluginContext) {
			return errorResult("missing-resource-binding", "缺少可信书籍绑定。", toolName, {
				runtimeCanonicalToolName: canonicalToolName,
			});
		}

		const resolved = this.host.resolve(pluginContext);
		const tool = resolved.tools.find((candidate) => candidate.definition.name === canonicalToolName);
		if (!tool) {
			return errorResult("runtime-tool-not-visible", "当前可信绑定下工具不可见。", toolName, {
				runtimeProjectId: context.runtimeProjectId,
				runtimeCanonicalToolName: canonicalToolName,
			});
		}

		const parsed = this.parseModelInput(tool, input, toolName);
		if (!parsed.success) {
			return errorResult("invalid-tool-input", parsed.summary, toolName, {
				runtimeProjectId: context.runtimeProjectId,
			});
		}

		const runtimeRisk = toRuntimeRisk(tool.definition.risk);
		const runtimeMetadata = {
			runtimeProjectId: context.runtimeProjectId,
			runtimeCanonicalToolName: canonicalToolName,
			runtimeRisk,
			...(tool.definition.renderer ? { runtimeRenderer: tool.definition.renderer } : {}),
		};
		try {
			const hostExecution = typeof execution === "string" ? undefined : execution;
			const toolContext: PluginToolExecutionContext = {
				...pluginContext,
				sessionId: narratorId,
				...(hostExecution?.provider && hostExecution.model
					? { model: { provider: hostExecution.provider, id: hostExecution.model } }
					: {}),
				...(hostExecution?.generateText ? { generateText: hostExecution.generateText } : {}),
				...(hostExecution?.emitOutput ? { emitOutput: hostExecution.emitOutput } : {}),
			};
			const result = await tool.handler(parsed.data, toolContext);
			return {
				output: JSON.stringify(result),
				isError: !result.ok,
				title: result.summary,
				metadata: {
					runtimePluginId: NOVEL_RUNTIME_CONTRIBUTION.id,
					toolName,
					...runtimeMetadata,
				},
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return errorResult("runtime-tool-error", message, toolName, runtimeMetadata);
		}
	}

	private toToolDefinition(tool: RuntimeToolContribution): ToolDefinition {
		const { definition } = tool;
		const wireToolName = this.toWireToolName(definition.name);
		const contributedPermission = this.getToolPermissionPolicy(definition.name);
		return {
			name: wireToolName,
			description: this.toModelFacingText(definition.description),
			parameters: this.validatorFor(definition.inputSchema),
			rawJsonSchema: definition.inputSchema as Record<string, unknown>,
			execute: (args, ctx) => this.execute(wireToolName, args, ctx),
			metadata: {
				runtimePluginId: NOVEL_RUNTIME_CONTRIBUTION.id,
				runtimeCanonicalToolName: definition.name,
				runtimeRisk: toRuntimeRisk(definition.risk),
				...(contributedPermission ? { contributedPermission } : {}),
				...(definition.renderer ? { runtimeRenderer: definition.renderer } : {}),
			},
		};
	}

	private parseModelInput(
		tool: RuntimeToolContribution,
		input: Readonly<Record<string, unknown>>,
		toolName: string,
	): { success: true; data: Record<string, unknown> } | { success: false; summary: string } {
		const forbiddenPath = findForbiddenModelField(input);
		if (forbiddenPath) {
			return { success: false, summary: `工具参数不得包含宿主字段：${forbiddenPath}。` };
		}

		try {
			const parsed = this.validatorFor(tool.definition.inputSchema).safeParse(input);
			if (parsed.success) return { success: true, data: parsed.data as Record<string, unknown> };
			return { success: false, summary: `工具参数无效：${parsed.error.message}` };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { success: false, summary: `工具参数 schema 无效：${message}` };
		}
	}

	private validatorFor(inputSchema: object): z.ZodType {
		const existing = this.validators.get(inputSchema);
		if (existing) return existing;
		// Contributions may omit additionalProperties. The private host always
		// treats every model-originated object as closed-world to prevent host-field
		// or typo smuggling through nested input structures.
		const validator = z.fromJSONSchema(closeSchemaObjects(inputSchema) as never);
		this.validators.set(inputSchema, validator);
		return validator;
	}
}
