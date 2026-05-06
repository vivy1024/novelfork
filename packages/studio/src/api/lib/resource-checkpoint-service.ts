import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type CheckpointResourceKind =
  | "chapter"
  | "story"
  | "truth"
  | "jingwei"
  | "narrative-line"
  | "candidate"
  | "draft"
  | "prompt-preview";

export interface ResourceCheckpointTarget {
  readonly kind: CheckpointResourceKind | string;
  readonly id: string;
  readonly path: string;
  readonly required?: boolean;
}

export interface ResourceCheckpointSnapshot {
  readonly kind: string;
  readonly id: string;
  readonly path: string;
  readonly beforeHash: string;
  readonly snapshotRef: string;
}

export interface ResourceCheckpoint {
  readonly id: string;
  readonly bookId: string;
  readonly sessionId: string;
  readonly messageId?: string;
  readonly toolUseId?: string;
  readonly reason?: string;
  readonly createdAt: string;
  readonly resources: readonly ResourceCheckpointSnapshot[];
}

export interface CreateResourceCheckpointInput {
  readonly bookId: string;
  readonly sessionId: string;
  readonly messageId?: string;
  readonly toolUseId?: string;
  readonly reason?: string;
  readonly resources: readonly ResourceCheckpointTarget[];
}

export type ResourceCheckpointResult =
  | { readonly ok: true; readonly checkpoint: ResourceCheckpoint }
  | { readonly ok: false; readonly error: "checkpoint-resource-missing"; readonly resource: string }
  | { readonly ok: false; readonly error: "checkpoint-invalid-path"; readonly resource: string };

export interface ResourceCheckpointServiceOptions {
  readonly bookDir: (bookId: string) => string;
  readonly now?: () => string;
  readonly createId?: () => string;
}

const NON_FORMAL_RESOURCE_KINDS = new Set(["candidate", "draft", "prompt-preview"]);

function sha256(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function normalizeResourcePath(path: string): string | null {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((part) => part === ".." || part === "")) return null;
  return normalized;
}

function snapshotFileName(path: string): string {
  return path.replace(/[^a-zA-Z0-9._-]+/g, "__");
}

async function readExistingIndex(indexPath: string): Promise<unknown[]> {
  try {
    const parsed = JSON.parse(await readFile(indexPath, "utf-8")) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function shouldCreateFormalResourceCheckpoint(resource: Pick<ResourceCheckpointTarget, "kind" | "path">): boolean {
  return !NON_FORMAL_RESOURCE_KINDS.has(resource.kind);
}

export function createResourceCheckpointService(options: ResourceCheckpointServiceOptions) {
  return {
    async createCheckpoint(input: CreateResourceCheckpointInput): Promise<ResourceCheckpointResult> {
      const id = options.createId?.() ?? `checkpoint-${randomUUID()}`;
      const createdAt = options.now?.() ?? new Date().toISOString();
      const bookDir = options.bookDir(input.bookId);
      const checkpointRoot = join(bookDir, ".novelfork", "checkpoints", id);
      const resourcesDir = join(checkpointRoot, "resources");
      const snapshots: ResourceCheckpointSnapshot[] = [];

      for (const resource of input.resources.filter(shouldCreateFormalResourceCheckpoint)) {
        const normalizedPath = normalizeResourcePath(resource.path);
        if (!normalizedPath) return { ok: false, error: "checkpoint-invalid-path", resource: resource.path };
        let content = "";
        try {
          content = await readFile(join(bookDir, normalizedPath), "utf-8");
        } catch {
          if (resource.required) {
            return { ok: false, error: "checkpoint-resource-missing", resource: normalizedPath };
          }
        }
        const fileName = snapshotFileName(normalizedPath);
        const snapshotRef = `.novelfork/checkpoints/${id}/resources/${fileName}`;
        snapshots.push({
          kind: resource.kind,
          id: resource.id,
          path: normalizedPath,
          beforeHash: sha256(content),
          snapshotRef,
        });
      }

      const checkpoint: ResourceCheckpoint = {
        id,
        bookId: input.bookId,
        sessionId: input.sessionId,
        ...(input.messageId ? { messageId: input.messageId } : {}),
        ...(input.toolUseId ? { toolUseId: input.toolUseId } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
        createdAt,
        resources: snapshots,
      };

      await mkdir(resourcesDir, { recursive: true });
      for (const snapshot of snapshots) {
        const original = await readFile(join(bookDir, snapshot.path), "utf-8").catch(() => "");
        await writeFile(join(bookDir, snapshot.snapshotRef), original, "utf-8");
      }
      await writeFile(join(checkpointRoot, "checkpoint.json"), `${JSON.stringify(checkpoint, null, 2)}\n`, "utf-8");

      const indexPath = join(bookDir, ".novelfork", "checkpoints", "index.json");
      const index = await readExistingIndex(indexPath);
      await writeFile(indexPath, `${JSON.stringify([...index, { id, createdAt, sessionId: input.sessionId, reason: input.reason ?? null, resourceCount: snapshots.length }], null, 2)}\n`, "utf-8");

      return { ok: true, checkpoint };
    },
  };
}
