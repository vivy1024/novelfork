import { randomUUID } from "node:crypto";

import { log } from "../logger.js";

export type RuntimeResourceKind = "browser" | "agent" | "bash" | "capture-pipeline" | "decision";

export type RuntimeResourceStatus =
  | "running"
  | "stopping"
  | "completed"
  | "failed"
  | "stopped"
  | "interrupted";

export type RuntimeTerminalResourceStatus = Extract<
  RuntimeResourceStatus,
  "completed" | "failed" | "stopped" | "interrupted"
>;

export type DisposeReason = "session-dispose" | "task-stop" | "shutdown" | "ttl";

export interface ResourceTerminalState {
  status: RuntimeTerminalResourceStatus;
  error?: unknown;
}

export interface OwnedRuntimeResource<T = unknown> {
  id: string;
  controlOwnerSessionId: string;
  executionSessionId: string;
  parentResourceId?: string;
  kind: RuntimeResourceKind;
  status: RuntimeResourceStatus;
  createdAt: number;
  value: T;
  dispose(reason: DisposeReason): Promise<ResourceTerminalState>;
}

export type OwnedRuntimeResourceInput<T = unknown> = Omit<
  OwnedRuntimeResource<T>,
  "id" | "createdAt" | "status"
> & Partial<Pick<OwnedRuntimeResource<T>, "id" | "createdAt" | "status">>;

export interface ResourceDisposeResult {
  id: string;
  kind: RuntimeResourceKind;
  status: RuntimeTerminalResourceStatus;
  error?: string;
}

export interface DisposeReport {
  ok: boolean;
  ownerSessionId: string;
  reason: DisposeReason;
  resources: ResourceDisposeResult[];
}

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL_STATUSES = new Set<RuntimeResourceStatus>(["completed", "failed", "stopped", "interrupted"]);

export function createRuntimeResourceId(): string {
  return randomUUID();
}

export function createOwnedRuntimeResource<T>(input: OwnedRuntimeResourceInput<T>): OwnedRuntimeResource<T> {
  return {
    ...input,
    id: input.id ?? createRuntimeResourceId(),
    status: input.status ?? "running",
    createdAt: input.createdAt ?? Date.now(),
  };
}

function isTerminalStatus(status: RuntimeResourceStatus): status is RuntimeTerminalResourceStatus {
  return TERMINAL_STATUSES.has(status);
}

function normalizeDisposeError(error: unknown): string {
  const fallback = "unserializable dispose error";

  try {
    if (error instanceof Error) {
      return error.message || error.name || "Error";
    }
    if (typeof error === "string") {
      return error || "empty string";
    }
    if (typeof error === "undefined") {
      return "undefined";
    }
    if (typeof error === "function") {
      return error.name ? `[function ${error.name}]` : "[function anonymous]";
    }
    if (typeof error === "symbol") {
      return String(error);
    }

    const serialized = JSON.stringify(error);
    if (typeof serialized === "string" && serialized.length > 0) {
      return serialized;
    }
  } catch {
    // Fall back to a fixed string for circular objects or hostile serializers.
  }

  return fallback;
}

function assertValidResource(resource: OwnedRuntimeResource<unknown>): void {
  if (!UUID_V4_PATTERN.test(resource.id)) {
    throw new Error(`Runtime resource id must be a full random UUID: ${resource.id}`);
  }
  if (!resource.controlOwnerSessionId) {
    throw new Error("Runtime resource controlOwnerSessionId is required");
  }
  if (!resource.executionSessionId) {
    throw new Error("Runtime resource executionSessionId is required");
  }
}

export class SessionRuntimeResourceRegistry {
  readonly #resources = new Map<string, OwnedRuntimeResource<unknown>>();
  readonly #disposePromises = new Map<string, Promise<ResourceDisposeResult>>();
  readonly #sessionDisposePromises = new Map<string, Promise<DisposeReport>>();
  readonly #retryableDisposeResourceIds = new Set<string>();
  readonly #disposedOwnerSessionIds = new Set<string>();

  register<T>(resource: OwnedRuntimeResource<T>): void {
    const normalizedResource = resource as OwnedRuntimeResource<unknown>;
    assertValidResource(normalizedResource);
    if (this.#disposedOwnerSessionIds.has(normalizedResource.controlOwnerSessionId)) {
      throw new Error(`session-runtime-disposed: owner session is disposed or disposing: ${normalizedResource.controlOwnerSessionId}`);
    }
    if (this.#resources.has(resource.id)) {
      throw new Error(`Runtime resource already registered: ${resource.id}`);
    }
    this.#assertParentOwnerInvariant(normalizedResource);
    this.#makeIdentityFieldsReadonly(normalizedResource);
    this.#resources.set(resource.id, normalizedResource);
  }

  getOwned<T>(ownerSessionId: string, kind: RuntimeResourceKind, id: string): OwnedRuntimeResource<T> | null {
    const resource = this.#resources.get(id);
    if (!resource || resource.controlOwnerSessionId !== ownerSessionId || resource.kind !== kind) {
      return null;
    }
    return resource as OwnedRuntimeResource<T>;
  }

  listOwned<T>(ownerSessionId: string, kind?: RuntimeResourceKind): OwnedRuntimeResource<T>[] {
    return Array.from(this.#resources.values()).filter((resource) => {
      if (resource.controlOwnerSessionId !== ownerSessionId) {
        return false;
      }
      return kind ? resource.kind === kind : true;
    }) as OwnedRuntimeResource<T>[];
  }

  transition(id: string, expected: RuntimeResourceStatus[], next: RuntimeResourceStatus): boolean {
    const resource = this.#resources.get(id);
    if (!resource || isTerminalStatus(resource.status) || !expected.includes(resource.status)) {
      return false;
    }
    resource.status = next;
    return true;
  }

  /** Remove a just-registered resource when a later setup step fails. */
  rollbackRegistration(ownerSessionId: string, id: string): boolean {
    const resource = this.#resources.get(id);
    if (!resource || resource.controlOwnerSessionId !== ownerSessionId) {
      return false;
    }
    const hasChildren = Array.from(this.#resources.values()).some((candidate) => candidate.parentResourceId === id);
    if (hasChildren || (this.#disposePromises.has(id) && !isTerminalStatus(resource.status))) {
      return false;
    }
    this.#disposePromises.delete(id);
    return this.#resources.delete(id);
  }

  #makeIdentityFieldsReadonly(resource: OwnedRuntimeResource<unknown>): void {
    for (const field of ["id", "controlOwnerSessionId", "executionSessionId", "parentResourceId", "kind", "createdAt"] as const) {
      Object.defineProperty(resource, field, {
        value: resource[field],
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
  }

  async disposeResourceTree(ownerSessionId: string, rootResourceId: string, reason: DisposeReason): Promise<DisposeReport> {
    const resources = this.#collectResourceTree(ownerSessionId, rootResourceId);
    return this.#disposeResources(ownerSessionId, resources, reason);
  }

  async disposeResourceDescendants(ownerSessionId: string, rootResourceId: string, reason: DisposeReason): Promise<DisposeReport> {
    const resources = this.#collectResourceTree(ownerSessionId, rootResourceId)
      .filter((resource) => resource.id !== rootResourceId);
    return this.#disposeResources(ownerSessionId, resources, reason);
  }

  async disposeExecutionSession(ownerSessionId: string, executionSessionId: string, reason: DisposeReason): Promise<DisposeReport> {
    const selected = new Map<string, OwnedRuntimeResource<unknown>>();
    for (const resource of this.#resources.values()) {
      if (resource.controlOwnerSessionId !== ownerSessionId || resource.executionSessionId !== executionSessionId) {
        continue;
      }
      for (const descendant of this.#collectResourceTree(ownerSessionId, resource.id)) {
        selected.set(descendant.id, descendant);
      }
    }
    return this.#disposeResources(
      ownerSessionId,
      this.#sortResourcesForDisposal([...selected.values()]),
      reason,
    );
  }

  disposeSession(ownerSessionId: string, reason: DisposeReason): Promise<DisposeReport> {
    const existing = this.#sessionDisposePromises.get(ownerSessionId);
    if (existing) {
      return existing;
    }

    this.#disposedOwnerSessionIds.add(ownerSessionId);
    const attempt = this.#disposeResources(ownerSessionId, this.#collectOwnerResources(ownerSessionId), reason);
    let disposePromise!: Promise<DisposeReport>;
    disposePromise = attempt.finally(() => {
      if (this.#sessionDisposePromises.get(ownerSessionId) === disposePromise) {
        this.#sessionDisposePromises.delete(ownerSessionId);
      }
    });
    this.#sessionDisposePromises.set(ownerSessionId, disposePromise);
    return disposePromise;
  }

  /** Process-shutdown seam: disposes all owner trees without exposing resources globally. */
  async disposeAll(reason: DisposeReason): Promise<DisposeReport[]> {
    const ownerSessionIds = [...new Set(Array.from(this.#resources.values(), (resource) => resource.controlOwnerSessionId))];
    const reports: DisposeReport[] = [];
    for (const ownerSessionId of ownerSessionIds) {
      reports.push(await this.disposeSession(ownerSessionId, reason));
    }
    return reports;
  }

  /**
   * Explicit fallback sweep for anomalously old live resources. Normal stop,
   * session deletion, and shutdown use their dedicated disposal paths instead.
   */
  async disposeExpiredResources(maxAgeMs: number, now = Date.now()): Promise<DisposeReport[]> {
    if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
      throw new Error(`Runtime resource maxAgeMs must be a non-negative finite number: ${maxAgeMs}`);
    }

    const cutoff = now - maxAgeMs;
    const expiredOwnerSessionIds = [...new Set(
      Array.from(this.#resources.values())
        .filter((resource) => !isTerminalStatus(resource.status) && resource.createdAt <= cutoff)
        .map((resource) => resource.controlOwnerSessionId),
    )];
    const reports: DisposeReport[] = [];
    for (const ownerSessionId of expiredOwnerSessionIds) {
      const expiredRoots = this.#collectOwnerResources(ownerSessionId)
        .filter((resource) => !isTerminalStatus(resource.status) && resource.createdAt <= cutoff);
      const selected = new Map<string, OwnedRuntimeResource<unknown>>();
      for (const root of expiredRoots) {
        for (const resource of this.#collectResourceTree(ownerSessionId, root.id)) {
          selected.set(resource.id, resource);
        }
      }
      reports.push(await this.#disposeResources(
        ownerSessionId,
        this.#sortResourcesForDisposal([...selected.values()]),
        "ttl",
      ));
    }
    return reports;
  }

  #collectOwnerResources(ownerSessionId: string): OwnedRuntimeResource<unknown>[] {
    const resources = Array.from(this.#resources.values()).filter((resource) => resource.controlOwnerSessionId === ownerSessionId);
    return this.#sortResourcesForDisposal(resources);
  }

  #collectResourceTree(ownerSessionId: string, rootResourceId: string): OwnedRuntimeResource<unknown>[] {
    const root = this.#resources.get(rootResourceId);
    if (!root || root.controlOwnerSessionId !== ownerSessionId) {
      return [];
    }

    const selectedIds = new Set<string>([root.id]);
    const childExecutionSessions = new Set<string>();
    this.#addChildExecutionSession(root, childExecutionSessions);

    let changed = true;
    while (changed) {
      changed = false;
      for (const resource of this.#resources.values()) {
        if (resource.controlOwnerSessionId !== ownerSessionId || selectedIds.has(resource.id)) {
          continue;
        }
        if (
          (resource.parentResourceId && selectedIds.has(resource.parentResourceId))
          || childExecutionSessions.has(resource.executionSessionId)
        ) {
          selectedIds.add(resource.id);
          this.#addChildExecutionSession(resource, childExecutionSessions);
          changed = true;
        }
      }
    }

    const selected = Array.from(this.#resources.values()).filter((resource) => selectedIds.has(resource.id));
    return this.#sortResourcesForDisposal(selected, new Set([root.id]));
  }

  #sortResourcesForDisposal(
    resources: OwnedRuntimeResource<unknown>[],
    rootResourceIds = new Set<string>(),
  ): OwnedRuntimeResource<unknown>[] {
    const selected = [...resources];
    const selectedIds = new Set(selected.map((resource) => resource.id));
    const depthMemo = new Map<string, number>();
    const parentMemo = new Map<string, string | null>();
    const indexById = new Map(selected.map((resource, index) => [resource.id, index]));
    const executionSessionControllers = new Map<string, OwnedRuntimeResource<unknown>>();

    for (const resource of selected) {
      if (resource.kind === "agent" && resource.controlOwnerSessionId !== resource.executionSessionId) {
        executionSessionControllers.set(resource.executionSessionId, resource);
      }
    }

    const parentOf = (resource: OwnedRuntimeResource<unknown>): string | null => {
      if (parentMemo.has(resource.id)) {
        return parentMemo.get(resource.id) ?? null;
      }
      if (rootResourceIds.has(resource.id)) {
        parentMemo.set(resource.id, null);
        return null;
      }
      if (resource.parentResourceId && selectedIds.has(resource.parentResourceId)) {
        parentMemo.set(resource.id, resource.parentResourceId);
        return resource.parentResourceId;
      }
      const controller = executionSessionControllers.get(resource.executionSessionId);
      const parentId = controller && controller.id !== resource.id ? controller.id : null;
      parentMemo.set(resource.id, parentId);
      return parentId;
    };

    const depthOf = (resource: OwnedRuntimeResource<unknown>, seen = new Set<string>()): number => {
      if (depthMemo.has(resource.id)) {
        return depthMemo.get(resource.id) ?? 0;
      }
      const parentId = parentOf(resource);
      if (!parentId || seen.has(parentId)) {
        depthMemo.set(resource.id, 0);
        return 0;
      }
      const parent = selected.find((candidate) => candidate.id === parentId);
      const depth = parent ? depthOf(parent, new Set([...seen, resource.id])) + 1 : 0;
      depthMemo.set(resource.id, depth);
      return depth;
    };

    return selected.sort((left, right) => {
      const depthDelta = depthOf(right) - depthOf(left);
      if (depthDelta !== 0) {
        return depthDelta;
      }
      return (indexById.get(left.id) ?? 0) - (indexById.get(right.id) ?? 0);
    });
  }

  #addChildExecutionSession(resource: OwnedRuntimeResource<unknown>, childExecutionSessions: Set<string>): void {
    if (resource.controlOwnerSessionId !== resource.executionSessionId) {
      childExecutionSessions.add(resource.executionSessionId);
    }
  }

  #assertParentOwnerInvariant(resource: OwnedRuntimeResource<unknown>): void {
    if (resource.parentResourceId) {
      const parent = this.#resources.get(resource.parentResourceId);
      if (parent && parent.controlOwnerSessionId !== resource.controlOwnerSessionId) {
        throw new Error(
          `Runtime resource parentResourceId ${parent.id} belongs to control owner ${parent.controlOwnerSessionId}, but resource ${resource.id} is owned by ${resource.controlOwnerSessionId}`,
        );
      }
    }

    for (const child of this.#resources.values()) {
      if (child.parentResourceId === resource.id && child.controlOwnerSessionId !== resource.controlOwnerSessionId) {
        throw new Error(
          `Runtime resource ${resource.id} would become parent of resource ${child.id} owned by ${child.controlOwnerSessionId}, but parent is owned by ${resource.controlOwnerSessionId}`,
        );
      }
    }
  }

  async #disposeResources(
    ownerSessionId: string,
    resources: OwnedRuntimeResource<unknown>[],
    reason: DisposeReason,
  ): Promise<DisposeReport> {
    const results: ResourceDisposeResult[] = [];
    for (const resource of resources) {
      results.push(await this.#disposeOne(resource, reason));
    }
    const ok = !results.some((result) => result.status === "failed" || result.error !== undefined);
    return {
      ok,
      ownerSessionId,
      reason,
      resources: results,
    };
  }

  async #disposeOne(resource: OwnedRuntimeResource<unknown>, reason: DisposeReason): Promise<ResourceDisposeResult> {
    const existing = this.#disposePromises.get(resource.id);
    if (existing) {
      return existing;
    }

    const retryable = this.#retryableDisposeResourceIds.has(resource.id);
    if (isTerminalStatus(resource.status) && !retryable) {
      return {
        id: resource.id,
        kind: resource.kind,
        status: resource.status,
      };
    }

    if (retryable || resource.status === "running") {
      resource.status = "stopping";
    }

    const disposePromise = (async (): Promise<ResourceDisposeResult> => {
      try {
        const terminal = await resource.dispose(reason);
        const current = this.#resources.get(resource.id);
        if (current && !isTerminalStatus(current.status)) {
          current.status = terminal.status;
        }
        const status = current && isTerminalStatus(current.status) ? current.status : terminal.status;
        const hasError = Object.prototype.hasOwnProperty.call(terminal, "error");
        const error = hasError ? normalizeDisposeError(terminal.error) : undefined;
        if (error === undefined) {
          this.#retryableDisposeResourceIds.delete(resource.id);
          this.#logResourceSettlement(resource, reason, status);
          return { id: resource.id, kind: resource.kind, status };
        }
        this.#retryableDisposeResourceIds.add(resource.id);
        this.#logResourceSettlement(resource, reason, status, error);
        return { id: resource.id, kind: resource.kind, status, error };
      } catch (error) {
        const current = this.#resources.get(resource.id);
        if (current && !isTerminalStatus(current.status)) {
          current.status = "failed";
        }
        this.#retryableDisposeResourceIds.add(resource.id);
        const normalizedError = normalizeDisposeError(error);
        this.#logResourceSettlement(resource, reason, "failed", normalizedError);
        return {
          id: resource.id,
          kind: resource.kind,
          status: "failed",
          error: normalizedError,
        };
      }
    })();

    let trackedPromise!: Promise<ResourceDisposeResult>;
    trackedPromise = disposePromise.finally(() => {
      if (this.#disposePromises.get(resource.id) === trackedPromise) {
        this.#disposePromises.delete(resource.id);
      }
    });
    this.#disposePromises.set(resource.id, trackedPromise);
    return trackedPromise;
  }

  #logResourceSettlement(
    resource: OwnedRuntimeResource<unknown>,
    disposeReason: DisposeReason,
    completionReason: RuntimeTerminalResourceStatus,
    error?: string,
  ): void {
    const fields = {
      sessionId: resource.controlOwnerSessionId,
      resourceKind: resource.kind,
      resourceId: resource.id,
      completionReason,
      disposeReason,
      ...(error ? { error } : {}),
    };
    if (error) log.error("Runtime resource settled", fields);
    else log.info("Runtime resource settled", fields);
  }
}

const processSessionRuntimeResourceRegistry = new SessionRuntimeResourceRegistry();

/** Shared process-level registry; all public lookup paths remain owner-aware. */
export function getSessionRuntimeResourceRegistry(): SessionRuntimeResourceRegistry {
  return processSessionRuntimeResourceRegistry;
}
