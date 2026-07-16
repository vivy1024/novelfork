/** Transport-neutral JSON values shared by Runtime boundaries. */
export type RuntimeJsonPrimitive = string | number | boolean | null;
export type RuntimeJsonValue =
  | RuntimeJsonPrimitive
  | readonly RuntimeJsonValue[]
  | { readonly [key: string]: RuntimeJsonValue };

export type RuntimeMaybePromise<T> = T | Promise<T>;
export type RuntimeHeaders = Readonly<Record<string, string>>;

export interface RuntimeRequestIdentity {
  readonly userId?: string;
  readonly sessionId?: string;
  readonly projectId?: string;
}

export type RuntimeHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

export interface RuntimeHttpRequest {
  readonly method: RuntimeHttpMethod;
  readonly path: string;
  readonly headers: RuntimeHeaders;
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string | readonly string[]>>;
  readonly body?: RuntimeJsonValue;
  readonly identity?: RuntimeRequestIdentity;
}

export interface RuntimeHttpResponse {
  readonly status: number;
  readonly headers?: RuntimeHeaders;
  readonly body?: RuntimeJsonValue;
}

export interface RuntimeHttpContext {
  readonly requestId: string;
}

export type RuntimeHttpHandler = (
  request: RuntimeHttpRequest,
  context: RuntimeHttpContext,
) => RuntimeMaybePromise<RuntimeHttpResponse>;

export interface RuntimeHttpRoute {
  readonly id: string;
  readonly method: RuntimeHttpMethod;
  readonly path: string;
  readonly handler: RuntimeHttpHandler;
}

export interface RuntimeWebSocketMessage {
  readonly type: string;
  readonly payload?: RuntimeJsonValue;
}

export interface RuntimeWebSocketConnection {
  readonly id: string;
  readonly identity?: RuntimeRequestIdentity;
  send(message: RuntimeWebSocketMessage): RuntimeMaybePromise<void>;
  close(code?: number, reason?: string): RuntimeMaybePromise<void>;
}

export interface RuntimeWebSocketChannel {
  readonly id: string;
  readonly path: string;
  onConnect?(connection: RuntimeWebSocketConnection): RuntimeMaybePromise<void>;
  onMessage?(
    connection: RuntimeWebSocketConnection,
    message: RuntimeWebSocketMessage,
  ): RuntimeMaybePromise<void>;
  onDisconnect?(
    connection: RuntimeWebSocketConnection,
    code?: number,
    reason?: string,
  ): RuntimeMaybePromise<void>;
}

export interface RuntimeAgentMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly name?: string;
}

export interface RuntimeAgentRequest {
  readonly agentId: string;
  readonly sessionId: string;
  readonly messages: readonly RuntimeAgentMessage[];
  readonly input?: RuntimeJsonValue;
}

export interface RuntimeAgentContext {
  readonly projectId?: string;
  readonly metadata?: Readonly<Record<string, RuntimeJsonValue>>;
}

export interface RuntimeAgentResult {
  readonly messages: readonly RuntimeAgentMessage[];
  readonly output?: RuntimeJsonValue;
}

export type RuntimeAgentHandler = (
  request: RuntimeAgentRequest,
  context: RuntimeAgentContext,
) => RuntimeMaybePromise<RuntimeAgentResult>;

export interface RuntimeAgentDefinition {
  readonly id: string;
  readonly title?: string;
  readonly toolNames?: readonly string[];
  readonly run: RuntimeAgentHandler;
}

export type RuntimeToolRisk = "read" | "write" | "destructive";

export interface RuntimeToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, RuntimeJsonValue>>;
  readonly risk?: RuntimeToolRisk;
  readonly permission?: string;
}

export interface RuntimeToolContext {
  readonly sessionId: string;
  readonly projectId?: string;
  readonly identity?: RuntimeRequestIdentity;
  readonly metadata?: Readonly<Record<string, RuntimeJsonValue>>;
}

export interface RuntimeToolResult {
  readonly ok: boolean;
  readonly output?: RuntimeJsonValue;
  readonly error?: string;
}

export type RuntimeToolHandler = (
  input: Readonly<Record<string, unknown>>,
  context: RuntimeToolContext,
) => RuntimeMaybePromise<RuntimeToolResult>;

export interface RuntimeToolContribution {
  readonly definition: RuntimeToolDefinition;
  readonly handler: RuntimeToolHandler;
}

export interface RuntimeSessionRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly agentId?: string;
  readonly projectId?: string;
  readonly metadata?: Readonly<Record<string, RuntimeJsonValue>>;
}

export interface RuntimeSessionStore {
  get(sessionId: string): RuntimeMaybePromise<RuntimeSessionRecord | undefined>;
  save(session: RuntimeSessionRecord): RuntimeMaybePromise<void>;
  delete(sessionId: string): RuntimeMaybePromise<boolean>;
}

export interface RuntimeSessionContribution {
  readonly id: string;
  readonly store: RuntimeSessionStore;
}

export interface RuntimePermissionRequest {
  readonly permission: string;
  readonly action: string;
  readonly resource?: string;
  readonly identity?: RuntimeRequestIdentity;
  readonly context?: Readonly<Record<string, RuntimeJsonValue>>;
}

export type RuntimePermissionEffect = "allow" | "deny" | "prompt";

export interface RuntimePermissionDecision {
  readonly effect: RuntimePermissionEffect;
  readonly reason?: string;
}

export interface RuntimePermissionService {
  evaluate(request: RuntimePermissionRequest): RuntimeMaybePromise<RuntimePermissionDecision>;
}

export interface RuntimePermissionContribution {
  readonly id: string;
  readonly service: RuntimePermissionService;
}

/** A capability bundle registered with one Runtime host instance. */
export interface RuntimeContribution {
  readonly id: string;
  readonly version?: string;
  readonly httpRoutes?: readonly RuntimeHttpRoute[];
  readonly webSocketChannels?: readonly RuntimeWebSocketChannel[];
  readonly agents?: readonly RuntimeAgentDefinition[];
  readonly tools?: readonly RuntimeToolContribution[];
  readonly sessions?: readonly RuntimeSessionContribution[];
  readonly permissions?: readonly RuntimePermissionContribution[];
}

export interface NovelBookRuntimeBinding {
  readonly bookId: string;
  readonly root: string;
  readonly metadata?: Readonly<Record<string, RuntimeJsonValue>>;
}

export interface NovelRuntimeBindingContext {
  readonly projectId: string;
  readonly sessionId?: string;
  readonly identity?: RuntimeRequestIdentity;
}

export type NovelRuntimeBindingResolver = (
  context: NovelRuntimeBindingContext,
) => RuntimeMaybePromise<NovelBookRuntimeBinding | undefined>;

/** Novel-specific extension point without depending on the novel implementation package. */
export interface NovelRuntimeContribution extends RuntimeContribution {
  readonly projectType: "novel";
  readonly resolveBookBinding?: NovelRuntimeBindingResolver;
}

/** Per-instance registry implemented by a private Runtime package. */
export interface RuntimeHost {
  registerContribution(contribution: RuntimeContribution): void;
  unregisterContribution(contributionId: string): boolean;
  hasContribution(contributionId: string): boolean;
  getContribution<TContribution extends RuntimeContribution = RuntimeContribution>(
    contributionId: string,
  ): TContribution | undefined;
  listContributions<TContribution extends RuntimeContribution = RuntimeContribution>(): readonly TContribution[];
}

export interface RuntimeHostOptions {
  readonly contributions?: readonly RuntimeContribution[];
}

export type RuntimeHostFactory = (options?: RuntimeHostOptions) => RuntimeHost;
