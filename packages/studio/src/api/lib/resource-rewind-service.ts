import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ToolConfirmationDecision, ToolConfirmationRequest } from "../../shared/agent-native-workspace.js";
import { createResourceCheckpointService, type ResourceCheckpoint, type ResourceCheckpointSnapshot } from "./resource-checkpoint-service.js";

export interface ResourceRewindServiceOptions {
  readonly bookDir: (bookId: string) => string;
  readonly now?: () => string;
  readonly createId?: () => string;
}

export interface ResourceRewindPreviewInput {
  readonly bookId: string;
  readonly checkpointId: string;
}

export interface ResourceRewindApplyInput extends ResourceRewindPreviewInput {
  readonly expectedCurrentHashes?: Readonly<Record<string, string>>;
  readonly confirmationDecision?: ToolConfirmationDecision;
}

export interface ResourceRewindPreviewResource {
  readonly kind: string;
  readonly id: string;
  readonly path: string;
  readonly snapshotRef: string;
  readonly snapshotHash: string;
  readonly currentHash: string | null;
  readonly currentExists: boolean;
  readonly snapshotExists: boolean;
  readonly changed: boolean;
  readonly risk: "confirmed-write" | "destructive";
  readonly diff: {
    readonly before: string;
    readonly after: string | null;
  };
}

export interface ResourceRewindPreview {
  readonly checkpointId: string;
  readonly checkpoint: ResourceCheckpoint;
  readonly resources: readonly ResourceRewindPreviewResource[];
}

export interface ResourceRewindAuditEntry {
  readonly id: string;
  readonly checkpointId: string;
  readonly decision: "approved" | "rejected";
  readonly decidedAt: string;
  readonly sessionId: string;
  readonly confirmationId: string;
  readonly reason?: string;
  readonly safetyCheckpointId?: string;
  readonly restoredResources?: readonly string[];
}

export type ResourceRewindPreviewResult =
  | { readonly ok: true; readonly preview: ResourceRewindPreview }
  | { readonly ok: false; readonly error: "checkpoint-not-found" | "checkpoint-invalid"; readonly checkpointId: string };

export type ResourceRewindApplyResult =
  | { readonly ok: true; readonly status: "pending-confirmation"; readonly confirmation: ToolConfirmationRequest }
  | { readonly ok: true; readonly status: "rejected"; readonly audit: ResourceRewindAuditEntry }
  | { readonly ok: true; readonly status: "applied"; readonly checkpointId: string; readonly safetyCheckpointId: string; readonly restoredResources: readonly Pick<ResourceRewindPreviewResource, "kind" | "id" | "path">[]; readonly audit: ResourceRewindAuditEntry }
  | { readonly ok: false; readonly error: "checkpoint-not-found" | "checkpoint-invalid"; readonly checkpointId: string }
  | { readonly ok: false; readonly error: "rewind-snapshot-missing" | "rewind-resource-moved"; readonly resource: string }
  | { readonly ok: false; readonly error: "rewind-conflict"; readonly resource: string; readonly expectedHash: string; readonly currentHash: string | null };

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function normalizeResourcePath(path: string): string | null {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((part) => part === ".." || part === "")) return null;
  return normalized;
}

function confirmationFor(checkpointId: string): ToolConfirmationRequest {
  return {
    id: `rewind:${checkpointId}`,
    toolName: "resource.rewind",
    target: `checkpoint:${checkpointId}`,
    risk: "destructive",
    summary: `恢复 checkpoint ${checkpointId} 中记录的正式资源。`,
    options: ["approve", "reject"],
  };
}

function normalizeCheckpoint(value: unknown, checkpointId: string): ResourceCheckpoint | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.id !== checkpointId || typeof record.bookId !== "string" || typeof record.sessionId !== "string" || typeof record.createdAt !== "string" || !Array.isArray(record.resources)) {
    return null;
  }
  const resources = record.resources.flatMap((resource): ResourceCheckpointSnapshot[] => {
    if (typeof resource !== "object" || resource === null) return [];
    const item = resource as Record<string, unknown>;
    if (typeof item.kind !== "string" || typeof item.id !== "string" || typeof item.path !== "string" || typeof item.beforeHash !== "string" || typeof item.snapshotRef !== "string") return [];
    return [{ kind: item.kind, id: item.id, path: item.path, beforeHash: item.beforeHash, snapshotRef: item.snapshotRef }];
  });
  return {
    id: checkpointId,
    bookId: record.bookId,
    sessionId: record.sessionId,
    ...(typeof record.messageId === "string" ? { messageId: record.messageId } : {}),
    ...(typeof record.toolUseId === "string" ? { toolUseId: record.toolUseId } : {}),
    ...(typeof record.reason === "string" ? { reason: record.reason } : {}),
    createdAt: record.createdAt,
    resources,
  };
}

async function readText(path: string): Promise<{ readonly exists: true; readonly content: string } | { readonly exists: false; readonly content: null }> {
  try {
    return { exists: true, content: await readFile(path, "utf-8") };
  } catch {
    return { exists: false, content: null };
  }
}

async function readAuditLog(path: string): Promise<ResourceRewindAuditEntry[]> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf-8")) as unknown;
    return Array.isArray(parsed) ? parsed as ResourceRewindAuditEntry[] : [];
  } catch {
    return [];
  }
}

export function createResourceRewindService(options: ResourceRewindServiceOptions) {
  async function loadCheckpoint(bookId: string, checkpointId: string): Promise<ResourceCheckpoint | null> {
    const manifestPath = join(options.bookDir(bookId), ".novelfork", "checkpoints", checkpointId, "checkpoint.json");
    try {
      return normalizeCheckpoint(JSON.parse(await readFile(manifestPath, "utf-8")) as unknown, checkpointId);
    } catch {
      return null;
    }
  }

  async function appendAudit(bookId: string, entry: ResourceRewindAuditEntry): Promise<void> {
    const auditPath = join(options.bookDir(bookId), ".novelfork", "checkpoints", "rewind-audit.json");
    const current = await readAuditLog(auditPath);
    await writeFile(auditPath, `${JSON.stringify([...current, entry], null, 2)}\n`, "utf-8");
  }

  return {
    async previewRewind(input: ResourceRewindPreviewInput): Promise<ResourceRewindPreviewResult> {
      const checkpoint = await loadCheckpoint(input.bookId, input.checkpointId);
      if (!checkpoint) return { ok: false, error: "checkpoint-not-found", checkpointId: input.checkpointId };
      const bookDir = options.bookDir(input.bookId);
      const resources: ResourceRewindPreviewResource[] = [];

      for (const resource of checkpoint.resources) {
        const resourcePath = normalizeResourcePath(resource.path);
        const snapshotPath = normalizeResourcePath(resource.snapshotRef);
        if (!resourcePath || !snapshotPath) return { ok: false, error: "checkpoint-invalid", checkpointId: input.checkpointId };
        const snapshot = await readText(join(bookDir, snapshotPath));
        const current = await readText(join(bookDir, resourcePath));
        const snapshotContent = snapshot.content ?? "";
        const currentHash = current.exists && current.content !== null ? sha256(current.content) : null;
        resources.push({
          kind: resource.kind,
          id: resource.id,
          path: resourcePath,
          snapshotRef: snapshotPath,
          snapshotHash: sha256(snapshotContent),
          currentHash,
          currentExists: current.exists,
          snapshotExists: snapshot.exists,
          changed: currentHash !== sha256(snapshotContent),
          risk: current.exists ? "confirmed-write" : "destructive",
          diff: { before: snapshotContent, after: current.content },
        });
      }

      return { ok: true, preview: { checkpointId: input.checkpointId, checkpoint, resources } };
    },

    async applyRewind(input: ResourceRewindApplyInput): Promise<ResourceRewindApplyResult> {
      if (!input.confirmationDecision) {
        return { ok: true, status: "pending-confirmation", confirmation: confirmationFor(input.checkpointId) };
      }

      const decidedAt = input.confirmationDecision.decidedAt;
      const sessionId = input.confirmationDecision.sessionId;
      const auditBase = {
        id: options.createId?.() ?? `rewind-audit-${randomUUID()}`,
        checkpointId: input.checkpointId,
        decidedAt,
        sessionId,
        confirmationId: input.confirmationDecision.confirmationId,
      };

      if (input.confirmationDecision.decision === "rejected") {
        const audit: ResourceRewindAuditEntry = {
          ...auditBase,
          decision: "rejected",
          ...(input.confirmationDecision.reason ? { reason: input.confirmationDecision.reason } : {}),
        };
        await appendAudit(input.bookId, audit);
        return { ok: true, status: "rejected", audit };
      }

      const preview = await this.previewRewind(input);
      if (!preview.ok) return preview;
      const bookDir = options.bookDir(input.bookId);
      for (const resource of preview.preview.resources) {
        if (!resource.snapshotExists) return { ok: false, error: "rewind-snapshot-missing", resource: resource.path };
        if (!resource.currentExists) return { ok: false, error: "rewind-resource-moved", resource: resource.path };
        const expected = input.expectedCurrentHashes?.[resource.path];
        if (expected && expected !== resource.currentHash) return { ok: false, error: "rewind-conflict", resource: resource.path, expectedHash: expected, currentHash: resource.currentHash };
      }

      const checkpointService = createResourceCheckpointService({
        bookDir: options.bookDir,
        now: options.now,
        createId: options.createId,
      });
      const safety = await checkpointService.createCheckpoint({
        bookId: input.bookId,
        sessionId,
        toolUseId: input.confirmationDecision.confirmationId,
        reason: "rewind-apply",
        resources: preview.preview.resources.map((resource) => ({ kind: resource.kind, id: resource.id, path: resource.path, required: true })),
      });
      if (!safety.ok) return { ok: false, error: "rewind-resource-moved", resource: safety.resource };

      for (const resource of preview.preview.resources) {
        const target = join(bookDir, resource.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, resource.diff.before, "utf-8");
      }

      const restoredResources = preview.preview.resources.map((resource) => ({ kind: resource.kind, id: resource.id, path: resource.path }));
      const audit: ResourceRewindAuditEntry = {
        ...auditBase,
        decision: "approved",
        safetyCheckpointId: safety.checkpoint.id,
        restoredResources: restoredResources.map((resource) => resource.path),
      };
      await appendAudit(input.bookId, audit);
      return { ok: true, status: "applied", checkpointId: input.checkpointId, safetyCheckpointId: safety.checkpoint.id, restoredResources, audit };
    },
  };
}
