import type {
  RuntimeHook,
  CreateHookInput,
  UpdateHookInput,
} from "../runtime-admin/hooks";
import type { McpBehavior, McpToolPermissionPatch } from "../runtime-admin/mcp";
import type {
  ProjectRoutineAction,
  ProjectRoutineStatus,
} from "../runtime-admin/routines";
import type {
  Skill,
  SkillInput,
  SkillSummary,
  SkillUpdateInput,
} from "../runtime-admin/skills";
import type { OkResponse } from "../runtime-admin/client";
import { runtimeJson, type RuntimeFetchOptions } from "./auth";

export const RUNTIME_BOOTSTRAP_PATH = "/api/novelfork/bootstrap";
export const RUNTIME_PRODUCT_BOOKS_PATH = "/api/novelfork/books";
export const RUNTIME_PRODUCT_CONTRACT_VERSION = "phase-0" as const;

export const RUNTIME_PRODUCT_FEATURE_NAMES = [
  "runtimeNarratorParity",
  "learningCenter",
  "runtimeAdminAdvanced",
  "knowledgeBase",
  "scheduledTasks",
  "groupChat",
  "globalSearch",
  "singleRuntimeEntry",
] as const;

export type RuntimeProductFeatureName =
  (typeof RUNTIME_PRODUCT_FEATURE_NAMES)[number];
export type RuntimeProductFeatures = {
  readonly [Name in RuntimeProductFeatureName]: boolean;
};

export const RUNTIME_BOOK_PROVISION_STATES = [
  "reserved",
  "core-staged",
  "filesystem-promoted",
  "runtime-bound",
  "ready",
  "failed",
  "compensation-required",
] as const;

export type RuntimeBookProvisionState =
  (typeof RUNTIME_BOOK_PROVISION_STATES)[number];

export type RuntimeWorkspaceSource = "none" | "new" | "existing";

export interface RuntimeProjectInit {
  readonly source: RuntimeWorkspaceSource;
  readonly workspaceRoot?: string;
  readonly managedByNovelFork?: boolean;
}

export interface RuntimeCreateBookInput {
  readonly title: string;
  readonly projectInit?: RuntimeProjectInit;
}

export interface RuntimeImportBookInput {
  readonly sourcePath: string;
  readonly bookId?: string;
}

/** Durable product-bootstrap operation returned by create, import, status, and retry. */
export interface RuntimeBookProvisionOperation {
  readonly id: string;
  readonly bookId: string;
  readonly state: RuntimeBookProvisionState;
  readonly runtimeProjectId?: string | null;
  readonly runtimeChapterId?: string | null;
  readonly narratorId?: string | null;
  readonly error?: string | null;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export function isRuntimeBookProvisionTerminal(
  state: RuntimeBookProvisionState,
): boolean {
  return (
    state === "ready" || state === "failed" || state === "compensation-required"
  );
}

export interface RuntimeBookSummary {
  readonly id: string;
  readonly title: string;
  readonly status?: string;
  readonly totalChapters?: number;
  readonly totalWords?: number;
  readonly updatedAt?: string;
  readonly capabilities: RuntimeEntityCapabilities;
}

export interface RuntimeNarratorSummary {
  readonly id: string;
  readonly bookId: string;
  readonly title: string;
  readonly model?: string | null;
  readonly reasoningEffort?: string | null;
  readonly permissionMode?: string | null;
  readonly planMode?: boolean;
  readonly cwd?: string | null;
  readonly status?: string;
  readonly messageCount?: number;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly lastMessageAt?: string | null;
  readonly errorMessage?: string | null;
  readonly capabilities: RuntimeEntityCapabilities;
}

export interface RuntimeCreateNarratorInput {
  readonly title: string;
}

export interface RuntimeModelStatus {
  readonly setupRequired: boolean;
  readonly label?: string;
}

/** P0 only consumes declared capabilities; missing write flags always fail closed. */
export interface RuntimeEntityCapabilities {
  readonly read: boolean;
  readonly create?: boolean;
  readonly update?: boolean;
  readonly delete?: boolean;
  readonly send?: boolean;
  readonly interrupt?: boolean;
}

export interface RuntimeProductCapabilities {
  readonly books: RuntimeEntityCapabilities;
  readonly narrators: RuntimeEntityCapabilities;
  readonly workspace: RuntimeEntityCapabilities;
}

export interface RuntimeBootstrap {
  /** Null means the server did not provide the one contract version this client understands. */
  readonly contractVersion: typeof RUNTIME_PRODUCT_CONTRACT_VERSION | null;
  /** Descriptive server metadata only; these flags must not drive product UI. */
  readonly features: RuntimeProductFeatures;
  readonly books: readonly RuntimeBookSummary[];
  readonly narrators: readonly RuntimeNarratorSummary[];
  readonly model: RuntimeModelStatus;
  readonly capabilities: RuntimeProductCapabilities;
}

export interface RuntimeWorkspaceResource {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly content?: string | null;
  readonly path?: string;
  readonly metadata?: Record<string, unknown>;
  readonly capabilities: RuntimeEntityCapabilities;
  readonly children?: readonly RuntimeWorkspaceResource[];
}

export interface RuntimeWorkspaceSnapshot {
  readonly book: RuntimeBookSummary;
  readonly resources: readonly RuntimeWorkspaceResource[];
  readonly capabilities: RuntimeEntityCapabilities;
}

export interface RuntimeWorkspaceResourceMutation {
  readonly resource: RuntimeWorkspaceResource;
}

export interface RuntimeWorkspaceChapterCreateInput {
  readonly title?: string;
}

export interface RuntimeBookPromptCandidate {
  readonly path: string;
  readonly exists: boolean;
}

export interface RuntimeBookPromptResult {
  readonly content: string | null;
  readonly filePath: string | null;
  readonly candidates: readonly RuntimeBookPromptCandidate[];
}

export interface RuntimeBookMcpServerOverride {
  readonly serverId: string;
  readonly defaultBehavior?: McpBehavior;
  readonly toolPermissions?: readonly {
    readonly toolName: string;
    readonly behavior: McpBehavior;
    readonly enabled?: boolean;
  }[];
}

export interface RuntimeBookMcpOverridesResult {
  readonly serverOverrides: readonly RuntimeBookMcpServerOverride[];
}

export interface RuntimeBookMcpOverridePatch {
  readonly defaultBehavior?: McpBehavior | null;
  readonly toolPermissionPatch?: McpToolPermissionPatch;
}

/** Book skill locations are product-level labels, never filesystem guarantees. */
export type RuntimeBookSkillSummary = Omit<SkillSummary, "location"> & {
  readonly location?: "book";
};

export type RuntimeBookSkill = Omit<Skill, "location"> & {
  readonly location?: "book";
};

export type RuntimeBookSkillInput = SkillInput;
export type RuntimeBookSkillUpdateInput = SkillUpdateInput;
export type RuntimeBookHook = Omit<RuntimeHook, "projectId">;
export type RuntimeBookHookCreateInput = CreateHookInput extends infer Input
  ? Input extends unknown
    ? Omit<Input, "projectId">
    : never
  : never;
export type RuntimeBookHookUpdateInput = UpdateHookInput;

export interface RuntimeProductClientOptions {
  readonly fetch?: RuntimeFetchOptions;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function mapProductFeatures(value: unknown): RuntimeProductFeatures {
  const record = asRecord(value);
  return Object.fromEntries(
    RUNTIME_PRODUCT_FEATURE_NAMES.map((name) => [
      name,
      asBoolean(record?.[name]) ?? false,
    ]),
  ) as unknown as RuntimeProductFeatures;
}

function mapEntityCapabilities(value: unknown): RuntimeEntityCapabilities {
  const record = asRecord(value);
  return {
    // Runtime capabilities are an authorization contract. A missing read grant
    // must never turn a newly introduced entity into an implicitly readable one.
    read: asBoolean(record?.read) ?? false,
    ...(asBoolean(record?.create) !== undefined
      ? { create: asBoolean(record?.create) }
      : {}),
    ...(asBoolean(record?.update) !== undefined
      ? { update: asBoolean(record?.update) }
      : {}),
    ...(asBoolean(record?.delete) !== undefined
      ? { delete: asBoolean(record?.delete) }
      : {}),
    ...(asBoolean(record?.send) !== undefined
      ? { send: asBoolean(record?.send) }
      : {}),
    ...(asBoolean(record?.interrupt) !== undefined
      ? { interrupt: asBoolean(record?.interrupt) }
      : {}),
  };
}

function mapBook(value: unknown): RuntimeBookSummary | null {
  const record = asRecord(value);
  const id = asString(record?.id);
  const title = asString(record?.title);
  if (!id || !title) return null;
  return {
    id,
    title,
    ...(asString(record?.status) ? { status: asString(record?.status) } : {}),
    ...(typeof record?.totalChapters === "number"
      ? { totalChapters: record.totalChapters }
      : {}),
    ...(typeof record?.totalWords === "number"
      ? { totalWords: record.totalWords }
      : {}),
    ...(asString(record?.updatedAt)
      ? { updatedAt: asString(record?.updatedAt) }
      : {}),
    capabilities: mapEntityCapabilities(record?.capabilities),
  };
}

function mapNarrator(value: unknown): RuntimeNarratorSummary | null {
  const record = asRecord(value);
  const id = asString(record?.id);
  const bookId = asString(record?.bookId);
  const title = asString(record?.title);
  if (!id || !bookId || !title) return null;
  const nullableString = (field: string): string | null | undefined => {
    const candidate = record?.[field];
    return candidate === null ? null : asString(candidate);
  };
  return {
    id,
    bookId,
    title,
    ...(nullableString("model") !== undefined
      ? { model: nullableString("model") }
      : {}),
    ...(nullableString("reasoningEffort") !== undefined
      ? { reasoningEffort: nullableString("reasoningEffort") }
      : {}),
    ...(nullableString("permissionMode") !== undefined
      ? { permissionMode: nullableString("permissionMode") }
      : {}),
    ...(typeof record?.planMode === "boolean"
      ? { planMode: record.planMode }
      : {}),
    ...(nullableString("cwd") !== undefined
      ? { cwd: nullableString("cwd") }
      : {}),
    ...(asString(record?.status) ? { status: asString(record?.status) } : {}),
    ...(typeof record?.messageCount === "number"
      ? { messageCount: record.messageCount }
      : {}),
    ...(asString(record?.createdAt)
      ? { createdAt: asString(record?.createdAt) }
      : {}),
    ...(asString(record?.updatedAt)
      ? { updatedAt: asString(record?.updatedAt) }
      : {}),
    ...(nullableString("lastMessageAt") !== undefined
      ? { lastMessageAt: nullableString("lastMessageAt") }
      : {}),
    ...(nullableString("errorMessage") !== undefined
      ? { errorMessage: nullableString("errorMessage") }
      : {}),
    capabilities: mapEntityCapabilities(record?.capabilities),
  };
}

function mapNarratorResponse(value: unknown): RuntimeNarratorSummary {
  const record = asRecord(value);
  const narrator = mapNarrator(record?.narrator ?? value);
  if (!narrator) throw new Error("Runtime narrator response is invalid");
  return narrator;
}

function mapWorkspaceResource(value: unknown): RuntimeWorkspaceResource | null {
  const record = asRecord(value);
  const id = asString(record?.id);
  const kind = asString(record?.kind);
  const title = asString(record?.title);
  if (!id || !kind || !title) return null;

  const children = Array.isArray(record?.children)
    ? record.children
        .map(mapWorkspaceResource)
        .filter((child): child is RuntimeWorkspaceResource => child !== null)
    : undefined;
  const metadata = asRecord(record?.metadata);
  return {
    id,
    kind,
    title,
    ...(typeof record?.content === "string" || record?.content === null
      ? { content: record.content }
      : {}),
    ...(asString(record?.path) ? { path: asString(record?.path) } : {}),
    ...(metadata ? { metadata } : {}),
    capabilities: mapEntityCapabilities(record?.capabilities),
    ...(children ? { children } : {}),
  };
}

export function mapRuntimeWorkspaceSnapshot(
  value: unknown,
): RuntimeWorkspaceSnapshot {
  const root = asRecord(value);
  if (!root) throw new Error("Runtime workspace response must be an object");
  const book = mapBook(root.book);
  if (!book || !Array.isArray(root.resources))
    throw new Error("Runtime workspace response is invalid");
  return {
    book,
    resources: root.resources
      .map(mapWorkspaceResource)
      .filter(
        (resource): resource is RuntimeWorkspaceResource => resource !== null,
      ),
    capabilities: mapEntityCapabilities(root.capabilities),
  };
}

export function mapRuntimeWorkspaceResourceMutation(
  value: unknown,
): RuntimeWorkspaceResourceMutation {
  const root = asRecord(value);
  if (!root)
    throw new Error("Runtime workspace mutation response must be an object");
  const resource = mapWorkspaceResource(root.resource);
  if (!resource)
    throw new Error("Runtime workspace mutation resource is invalid");
  return { resource };
}

function mapBookProvisionOperation(
  value: unknown,
): RuntimeBookProvisionOperation {
  const operation = asRecord(value);
  const id = asString(operation?.id);
  const bookId = asString(operation?.bookId);
  const state = asString(operation?.state);
  if (
    !id ||
    !bookId ||
    !state ||
    !RUNTIME_BOOK_PROVISION_STATES.includes(state as RuntimeBookProvisionState)
  ) {
    throw new Error("Runtime book provision operation is invalid");
  }
  const nullableString = (field: string): string | null | undefined => {
    const candidate = operation?.[field];
    return candidate === null ? null : asString(candidate);
  };
  return {
    id,
    bookId,
    state: state as RuntimeBookProvisionState,
    ...(nullableString("runtimeProjectId") !== undefined
      ? { runtimeProjectId: nullableString("runtimeProjectId") }
      : {}),
    ...(nullableString("runtimeChapterId") !== undefined
      ? { runtimeChapterId: nullableString("runtimeChapterId") }
      : {}),
    ...(nullableString("narratorId") !== undefined
      ? { narratorId: nullableString("narratorId") }
      : {}),
    ...(nullableString("error") !== undefined
      ? { error: nullableString("error") }
      : {}),
    ...(asString(operation?.createdAt)
      ? { createdAt: asString(operation?.createdAt) }
      : {}),
    ...(asString(operation?.updatedAt)
      ? { updatedAt: asString(operation?.updatedAt) }
      : {}),
  };
}

/**
 * Maps the explicit Runtime bootstrap contract. It rejects malformed primary
 * records and deliberately defaults missing mutation capabilities to disabled.
 */
export function mapRuntimeBootstrap(value: unknown): RuntimeBootstrap {
  const root = asRecord(value);
  if (!root) throw new Error("Runtime bootstrap response must be an object");
  const booksRaw = Array.isArray(root.books) ? root.books : [];
  const narratorsRaw = Array.isArray(root.narrators) ? root.narrators : [];
  const model = asRecord(root.model);
  const capabilities = asRecord(root.capabilities);

  const modelContract = model ?? asRecord(root.modelReadiness);
  const contractVersion =
    root.contractVersion === RUNTIME_PRODUCT_CONTRACT_VERSION
      ? RUNTIME_PRODUCT_CONTRACT_VERSION
      : null;
  return {
    contractVersion,
    // Do not trust flags from a missing or newer contract: they are descriptive
    // metadata, and an incompatible schema must leave every value disabled.
    features: mapProductFeatures(contractVersion ? root.features : null),
    books: booksRaw
      .map(mapBook)
      .filter((book): book is RuntimeBookSummary => book !== null),
    narrators: narratorsRaw
      .map(mapNarrator)
      .filter(
        (narrator): narrator is RuntimeNarratorSummary => narrator !== null,
      ),
    model: {
      setupRequired:
        asBoolean(modelContract?.setupRequired) ??
        asString(modelContract?.status) !== "ready",
      ...(asString(modelContract?.label)
        ? { label: asString(modelContract?.label) }
        : {}),
    },
    capabilities: {
      books: mapEntityCapabilities(capabilities?.books),
      narrators: mapEntityCapabilities(capabilities?.narrators),
      workspace: mapEntityCapabilities(capabilities?.workspace),
    },
  };
}

export function buildBookScopedNarratorPath(
  bookId: string,
  narratorId?: string,
  ...segments: readonly string[]
): string {
  const encodedBookId = encodeURIComponent(bookId);
  const path = ["/api/books", encodedBookId, "narrators"];
  if (narratorId) path.push(encodeURIComponent(narratorId));
  path.push(...segments.map((segment) => encodeURIComponent(segment)));
  return path.join("/");
}

export function buildBookWorkspacePath(bookId: string): string {
  return `/api/books/${encodeURIComponent(bookId)}/workspace`;
}

export function buildWorkspaceChapterPath(bookId: string): string {
  return `${buildBookWorkspacePath(bookId)}/chapters`;
}

export function buildWorkspaceResourcePath(
  bookId: string,
  resourceId: string,
): string {
  return `${buildBookWorkspacePath(bookId)}/resources/${encodeURIComponent(resourceId)}`;
}

export function buildBookProductPath(
  bookId: string,
  ...segments: readonly string[]
): string {
  return ["/api/books", bookId, ...segments]
    .map((segment, index) =>
      index === 0 ? segment : encodeURIComponent(segment),
    )
    .join("/");
}

function withoutProjectId<Input extends object>(
  input: Input,
): Omit<Input, "projectId"> {
  const body = { ...input } as Record<string, unknown>;
  delete body.projectId;
  return body as Omit<Input, "projectId">;
}

function unwrapNarrators(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  return Array.isArray(record?.narrators) ? record.narrators : [];
}

/**
 * Native Runtime adapter. Narrator methods intentionally never construct or
 * request the legacy `/api/narrators/:id` surface: every narrator identity is
 * always bound to its book in the URL.
 */
export function createRuntimeProductClient(
  options: RuntimeProductClientOptions = {},
) {
  const fetchOptions = options.fetch;
  return {
    getBootstrap: async (): Promise<RuntimeBootstrap> =>
      mapRuntimeBootstrap(
        await runtimeJson<unknown>(RUNTIME_BOOTSTRAP_PATH, {}, fetchOptions),
      ),
    createBook: async (
      input: RuntimeCreateBookInput,
      idempotencyKey: string,
    ): Promise<RuntimeBookProvisionOperation> => {
      const title = input.title.trim();
      const key = idempotencyKey.trim();
      if (!title) throw new Error("作品标题不能为空");
      if (!key) throw new Error("创建作品需要 Idempotency-Key");
      const projectInit = input.projectInit;
      if (projectInit?.source === "existing" && !projectInit.workspaceRoot?.trim()) {
        throw new Error("已有 workspace 需要选择目录");
      }
      return mapBookProvisionOperation(
        await runtimeJson<unknown>(
          RUNTIME_PRODUCT_BOOKS_PATH,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "Idempotency-Key": key,
            },
            body: JSON.stringify({ title, ...(projectInit ? { projectInit } : {}) }),
          },
          fetchOptions,
        ),
      );
    },
    importBook: async (
      input: RuntimeImportBookInput,
      idempotencyKey: string,
    ): Promise<RuntimeBookProvisionOperation> => {
      const sourcePath = input.sourcePath.trim();
      const key = idempotencyKey.trim();
      if (!sourcePath) throw new Error("请选择作品目录");
      if (!key) throw new Error("导入作品需要 Idempotency-Key");
      return mapBookProvisionOperation(
        await runtimeJson<unknown>(
          `${RUNTIME_PRODUCT_BOOKS_PATH}/import`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "Idempotency-Key": key,
            },
            body: JSON.stringify({
              sourcePath,
              ...(input.bookId?.trim() ? { bookId: input.bookId.trim() } : {}),
            }),
          },
          fetchOptions,
        ),
      );
    },
    deleteBook: async (bookId: string, deleteWorkspace = false): Promise<OkResponse> => {
      const normalizedBookId = bookId.trim();
      if (!normalizedBookId) throw new Error("删除作品需要 bookId");
      return runtimeJson<OkResponse>(
        `${RUNTIME_PRODUCT_BOOKS_PATH}/${encodeURIComponent(normalizedBookId)}${deleteWorkspace ? "?deleteWorkspace=true" : ""}`,
        { method: "DELETE" },
        fetchOptions,
      );
    },
    getBookStatus: async (
      bookId: string,
    ): Promise<RuntimeBookProvisionOperation> =>
      mapBookProvisionOperation(
        await runtimeJson<unknown>(
          `${RUNTIME_PRODUCT_BOOKS_PATH}/${encodeURIComponent(bookId)}/status`,
          {},
          fetchOptions,
        ),
      ),
    retryBookProvision: async (
      bookId: string,
    ): Promise<RuntimeBookProvisionOperation> =>
      mapBookProvisionOperation(
        await runtimeJson<unknown>(
          `${RUNTIME_PRODUCT_BOOKS_PATH}/${encodeURIComponent(bookId)}/retry`,
          { method: "POST" },
          fetchOptions,
        ),
      ),
    claimLegacyBook: async (
      bookId: string,
    ): Promise<RuntimeBookProvisionOperation> => {
      const normalizedBookId = bookId.trim();
      if (!normalizedBookId) throw new Error("接管旧作品需要 bookId");
      return mapBookProvisionOperation(
        await runtimeJson<unknown>(
          `${RUNTIME_PRODUCT_BOOKS_PATH}/${encodeURIComponent(normalizedBookId)}/claim`,
          { method: "POST" },
          fetchOptions,
        ),
      );
    },
    repairBookBinding: async (
      bookId: string,
    ): Promise<RuntimeBookProvisionOperation> => {
      const normalizedBookId = bookId.trim();
      if (!normalizedBookId) throw new Error("修复作品绑定需要 bookId");
      return mapBookProvisionOperation(
        await runtimeJson<unknown>(
          `${RUNTIME_PRODUCT_BOOKS_PATH}/${encodeURIComponent(normalizedBookId)}/repair`,
          { method: "POST" },
          fetchOptions,
        ),
      );
    },
    listBookRoutines: (
      bookId: string,
    ): Promise<{ readonly routines: readonly ProjectRoutineStatus[] }> =>
      runtimeJson(buildBookProductPath(bookId, "routines"), {}, fetchOptions),
    toggleBookRoutine: (
      bookId: string,
      routineId: string,
      action: ProjectRoutineAction,
    ): Promise<OkResponse> =>
      runtimeJson(
        buildBookProductPath(bookId, "routines", routineId),
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        },
        fetchOptions,
      ),
    listBookRules: (bookId: string): Promise<RuntimeBookPromptResult> =>
      runtimeJson(buildBookProductPath(bookId, "rules"), {}, fetchOptions),
    putBookRules: (
      bookId: string,
      content: string,
      filePath?: string,
    ): Promise<{ readonly ok: true; readonly filePath: string }> =>
      runtimeJson(
        buildBookProductPath(bookId, "rules"),
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            content,
            ...(filePath !== undefined ? { filePath } : {}),
          }),
        },
        fetchOptions,
      ),
    listBookMcpOverrides: (
      bookId: string,
    ): Promise<RuntimeBookMcpOverridesResult> =>
      runtimeJson(buildBookProductPath(bookId, "mcp"), {}, fetchOptions),
    putBookMcpOverride: (
      bookId: string,
      serverId: string,
      patch: RuntimeBookMcpOverridePatch,
    ): Promise<RuntimeBookMcpOverridesResult> =>
      runtimeJson(
        buildBookProductPath(bookId, "mcp", "servers", serverId),
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        },
        fetchOptions,
      ),
    listBookSkills: (
      bookId: string,
    ): Promise<readonly RuntimeBookSkillSummary[]> =>
      runtimeJson(buildBookProductPath(bookId, "skills"), {}, fetchOptions),
    getBookSkill: (bookId: string, name: string): Promise<RuntimeBookSkill> =>
      runtimeJson(
        buildBookProductPath(bookId, "skills", name),
        {},
        fetchOptions,
      ),
    createBookSkill: (
      bookId: string,
      input: RuntimeBookSkillInput,
    ): Promise<RuntimeBookSkill> =>
      runtimeJson(
        buildBookProductPath(bookId, "skills"),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(withoutProjectId(input)),
        },
        fetchOptions,
      ),
    updateBookSkill: (
      bookId: string,
      currentName: string,
      input: RuntimeBookSkillUpdateInput,
    ): Promise<RuntimeBookSkill> =>
      runtimeJson(
        buildBookProductPath(bookId, "skills", currentName),
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(withoutProjectId(input)),
        },
        fetchOptions,
      ),
    deleteBookSkill: (bookId: string, name: string): Promise<OkResponse> =>
      runtimeJson(
        buildBookProductPath(bookId, "skills", name),
        { method: "DELETE" },
        fetchOptions,
      ),
    listBookHooks: (bookId: string): Promise<readonly RuntimeBookHook[]> =>
      runtimeJson(buildBookProductPath(bookId, "hooks"), {}, fetchOptions),
    createBookHook: (
      bookId: string,
      input: RuntimeBookHookCreateInput,
    ): Promise<RuntimeBookHook> =>
      runtimeJson(
        buildBookProductPath(bookId, "hooks"),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(withoutProjectId(input)),
        },
        fetchOptions,
      ),
    updateBookHook: (
      bookId: string,
      hookId: string,
      input: RuntimeBookHookUpdateInput,
    ): Promise<RuntimeBookHook> =>
      runtimeJson(
        buildBookProductPath(bookId, "hooks", hookId),
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(withoutProjectId(input)),
        },
        fetchOptions,
      ),
    deleteBookHook: (bookId: string, hookId: string): Promise<OkResponse> =>
      runtimeJson(
        buildBookProductPath(bookId, "hooks", hookId),
        { method: "DELETE" },
        fetchOptions,
      ),
    listNarrators: async (
      bookId: string,
    ): Promise<readonly RuntimeNarratorSummary[]> =>
      unwrapNarrators(
        await runtimeJson<unknown>(
          buildBookScopedNarratorPath(bookId),
          {},
          fetchOptions,
        ),
      )
        .map(mapNarrator)
        .filter(
          (narrator): narrator is RuntimeNarratorSummary => narrator !== null,
        ),
    createNarrator: async (
      bookId: string,
      input: RuntimeCreateNarratorInput,
    ): Promise<RuntimeNarratorSummary> => {
      const title = input.title.trim();
      if (!title || title.length > 200) {
        throw new Error("叙述者标题必须为 1 到 200 个字符");
      }
      return mapNarratorResponse(
        await runtimeJson<unknown>(
          buildBookScopedNarratorPath(bookId),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title }),
          },
          fetchOptions,
        ),
      );
    },
    getWorkspace: async (bookId: string): Promise<RuntimeWorkspaceSnapshot> =>
      mapRuntimeWorkspaceSnapshot(
        await runtimeJson<unknown>(
          buildBookWorkspacePath(bookId),
          {},
          fetchOptions,
        ),
      ),
    createWorkspaceChapter: async (
      bookId: string,
      input: RuntimeWorkspaceChapterCreateInput = {},
    ): Promise<RuntimeWorkspaceResourceMutation> => {
      const title = input.title?.trim();
      if (input.title !== undefined && (!title || title.length > 200)) {
        throw new Error("章节标题必须为 1 到 200 个字符");
      }
      return mapRuntimeWorkspaceResourceMutation(
        await runtimeJson<unknown>(
          buildWorkspaceChapterPath(bookId),
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(title ? { title } : {}),
          },
          fetchOptions,
        ),
      );
    },
    saveWorkspaceResource: async (
      bookId: string,
      resourceId: string,
      content: string,
    ): Promise<RuntimeWorkspaceResourceMutation> => {
      if (typeof content !== "string" || content.length > 2_000_000) {
        throw new Error("章节正文必须为长度不超过 2000000 的字符串");
      }
      return mapRuntimeWorkspaceResourceMutation(
        await runtimeJson<unknown>(
          buildWorkspaceResourcePath(bookId, resourceId),
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ content }),
          },
          fetchOptions,
        ),
      );
    },
  };
}

export type RuntimeProductClient = ReturnType<
  typeof createRuntimeProductClient
>;
