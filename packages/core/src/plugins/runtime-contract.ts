/**
 * Runtime plugin contracts — the vocabulary a Runtime host and its plugins share.
 *
 * `RuntimePluginHost` is the host-side registry; these types describe what
 * plugins provide (`RuntimePluginContribution`), what the host resolves per
 * session (`ResolvedRuntimeContributions`), and the shape of tool execution.
 *
 * All values cross the runtime/plugin boundary, so we stick to portable JSON
 * on the wire (see `PortableJsonValue`) — class instances cannot be passed.
 */

/** A JSON primitive: the leaf of every portable value. */
export type PortableJsonPrimitive = string | number | boolean | null;

/** Any value that survives a JSON round-trip. */
export type PortableJsonValue =
  | PortableJsonPrimitive
  | readonly PortableJsonValue[]
  | { readonly [key: string]: PortableJsonValue };

/** A JSON-Schema subset handed to providers; core treats it as opaque. */
export type PortableJsonSchema = Record<string, unknown>;

/** Localized display text keyed by locale. */
export type RuntimeLearningLocalizedText = Readonly<Record<string, string>>;

/** One message in a text-generation request (system/user/assistant). */
export interface RuntimeTextGenerationMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

/** The request handed to a Runtime text generator. */
export interface RuntimeTextGenerationRequest {
  readonly messages: readonly RuntimeTextGenerationMessage[];
  readonly temperature?: number;
  readonly maxTokens?: number;
}

/** What the generator returns. */
export type RuntimeTextGenerationResult = { readonly text: string };

/** A text-generation callable the host may inject for capable tools. */
export type RuntimeTextGenerator = (
  input: RuntimeTextGenerationRequest,
) => Promise<RuntimeTextGenerationResult>;

/** Risk tier the host assigns to a contributed tool. */
export type RuntimeToolRisk =
  | "read"
  | "draft-write"
  | "confirmed-write"
  | "destructive";

/** Declarative metadata about a contributed tool. */
export interface RuntimeToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: PortableJsonSchema;
  readonly scope?: string;
  readonly risk?: RuntimeToolRisk | string;
  readonly enabledForModes?: readonly string[];
  readonly visibility?: "author" | "advanced";
  readonly renderer?: string;
}

/** A book-like resource a Runtime session is bound to. */
export interface RuntimeResourceBinding {
  readonly kind: string;
  readonly root: string;
  readonly [key: string]: unknown;
}

/** What the host knows about a session at resolve time. */
export interface RuntimeResolveContext {
  readonly runtimeProjectId: string;
  readonly projectRoot: string;
  readonly projectType: string;
  readonly enabledPluginIds: readonly string[];
  readonly resourceBindings: Readonly<Record<string, RuntimeResourceBinding>>;
  readonly sessionId?: string;
}

/**
 * A loaded skill evidence row: strictly from Runtime Skill tool calls in the
 * current session. Never derived from file presence in a project directory.
 */
export interface RuntimeLoadedSkill {
  readonly name: string;
  readonly loadedAt: string;
  readonly contentHash?: string;
}

/** Context handed to a tool handler at execution time. */
export interface ToolExecutionContext extends RuntimeResolveContext {
  /** Skill evidence: skills actually invoked via the native Runtime Skill tool. */
  readonly loadedSkills?: readonly RuntimeLoadedSkill[];
  /** Model routing for text-generation-capable tools. */
  readonly model?: { readonly provider: string; readonly id: string };
  readonly generateText?: RuntimeTextGenerator;
  readonly emitOutput?: (line: string) => void;
}

/** What a tool handler resolves to. */
export interface RuntimeToolResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly summary?: string;
  readonly title?: string;
  readonly data?: unknown;
}

/** A single tool handler callable. */
export type RuntimeToolHandler = (
  input: Readonly<Record<string, unknown>>,
  context: ToolExecutionContext,
) => Promise<RuntimeToolResult> | RuntimeToolResult;

/** One tool contribution: definition + handler. */
export interface RuntimeToolContribution {
  readonly definition: RuntimeToolDefinition;
  readonly handler: RuntimeToolHandler;
}

/** A route contribution: id + method + path + handler. */
export interface RuntimeRouteContribution {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly handler: (input: unknown) => unknown;
}

/** A page contribution surfaced in Studio. */
export interface RuntimePageContribution {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly componentKey: string;
}

/** A preset for a narrator agent. */
export interface RuntimeAgentPresetContribution {
  readonly id: string;
  readonly name: string;
  readonly tools: readonly string[];
  readonly systemPromptSuffix?: string;
}

/** A prompt extension appended to a narrator prompt at runtime. */
export interface RuntimePromptExtension {
  readonly id: string;
  readonly content: string;
  readonly position?: "before" | "after";
  readonly order?: number;
  readonly agentId?: string;
}

/** A learning category shown on the /learn page. */
export interface RuntimeLearningCategoryContribution {
  readonly id: string;
  readonly label: RuntimeLearningLocalizedText;
  readonly description?: RuntimeLearningLocalizedText;
}

/** A learning action card (jump-to-route). */
export interface RuntimeLearningActionContribution {
  readonly label: RuntimeLearningLocalizedText;
  readonly description?: RuntimeLearningLocalizedText;
  readonly href?: string;
}

/** A learning doc (markdown-backed tutorial). */
export interface RuntimeLearningDocumentContribution {
  readonly id: string;
  readonly category: string;
  readonly title: RuntimeLearningLocalizedText;
  readonly summary: RuntimeLearningLocalizedText;
  readonly sections?: readonly {
    readonly title: RuntimeLearningLocalizedText;
    readonly body: RuntimeLearningLocalizedText;
  }[];
  readonly workflow?: readonly unknown[];
  readonly bestPractices?: readonly RuntimeLearningLocalizedText[];
  readonly pitfalls?: readonly RuntimeLearningLocalizedText[];
  readonly agentHints?: readonly RuntimeLearningLocalizedText[];
  readonly tags?: readonly string[];
  readonly actions?: readonly RuntimeLearningActionContribution[];
}

/** Learning content surfaced on /learn. */
export interface RuntimeLearningContribution {
  readonly categories: readonly RuntimeLearningCategoryContribution[];
  readonly docs: readonly RuntimeLearningDocumentContribution[];
}

/** The full contribution object a plugin registers with the host. */
export interface RuntimePluginContribution {
  readonly id: string;
  readonly projectTypes?: readonly string[];
  readonly tools?: readonly RuntimeToolContribution[];
  readonly routes?: readonly RuntimeRouteContribution[];
  readonly pages?: readonly RuntimePageContribution[];
  readonly agentPresets?: readonly RuntimeAgentPresetContribution[];
  readonly promptExtensions?: readonly RuntimePromptExtension[];
  readonly learning?: RuntimeLearningContribution;
}

/** What the host answers when a narrator session resolves its contributions. */
export interface ResolvedRuntimeContributions {
  readonly tools: readonly RuntimeToolContribution[];
  readonly routes: readonly RuntimeRouteContribution[];
  readonly pages: readonly RuntimePageContribution[];
  readonly agentPresets: readonly RuntimeAgentPresetContribution[];
  readonly promptExtensions: readonly RuntimePromptExtension[];
  readonly learning: readonly RuntimeLearningContribution[];
}
