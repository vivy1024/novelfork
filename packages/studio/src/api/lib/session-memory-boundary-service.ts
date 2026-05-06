export const SESSION_MEMORY_CATEGORIES = ["user-preference", "project-fact", "temporary-story-draft"] as const;

export type SessionMemoryClassification = (typeof SESSION_MEMORY_CATEGORIES)[number];
export type SessionMemoryScope = "user" | "project";

export type SessionMemorySource =
  | { readonly kind: "message"; readonly messageId: string; readonly seq?: number }
  | { readonly kind: "project-resource"; readonly projectId: string; readonly path: string; readonly ref?: string };

export type SessionMemoryConfirmation =
  | { readonly mode: "explicit"; readonly confirmedBy: string }
  | { readonly mode: "implicit-stable"; readonly evidenceCount?: number };

export interface SessionMemoryCandidate {
  readonly sessionId: string;
  readonly projectId?: string;
  readonly content: string;
  readonly classification?: SessionMemoryClassification;
  readonly source: SessionMemorySource;
  readonly confirmation?: SessionMemoryConfirmation;
  readonly createdBy: "user" | "assistant" | "system";
  readonly tags?: readonly string[];
}

export interface SessionMemoryAuditEnvelope {
  readonly sessionId: string;
  readonly projectId?: string;
  readonly classification: SessionMemoryClassification;
  readonly source: SessionMemorySource;
  readonly confirmation?: SessionMemoryConfirmation;
  readonly createdBy: SessionMemoryCandidate["createdBy"];
  readonly createdAt: number;
}

export interface SessionMemoryWriteRequest {
  readonly scope: SessionMemoryScope;
  readonly projectId?: string;
  readonly content: string;
  readonly tags: readonly string[];
  readonly audit: SessionMemoryAuditEnvelope;
}

export type SessionMemoryWriterResult =
  | { readonly ok: true; readonly memoryId: string }
  | { readonly ok: false; readonly code?: string; readonly error: string };

export type SessionMemoryWriter = (request: SessionMemoryWriteRequest) => Promise<SessionMemoryWriterResult>;

export type SessionMemoryCommitResult =
  | {
    readonly ok: true;
    readonly action: "written";
    readonly memoryId: string;
    readonly scope: SessionMemoryScope;
    readonly audit: SessionMemoryAuditEnvelope;
  }
  | {
    readonly ok: true;
    readonly action: "skipped";
    readonly reason: "temporary_story_draft_not_long_term";
    readonly audit: SessionMemoryAuditEnvelope;
  }
  | {
    readonly ok: false;
    readonly status: 400 | 503;
    readonly code: "classification_required" | "explicit_confirmation_required" | "project_id_required" | "project_source_required" | "memory_writer_not_configured" | "memory_write_failed";
    readonly error: string;
    readonly recoverable?: boolean;
    readonly audit?: SessionMemoryAuditEnvelope;
  };

export interface SessionMemoryStatus {
  readonly ok: true;
  readonly sessionId: string;
  readonly status: "writable" | "readonly";
  readonly writable: boolean;
  readonly categories: readonly SessionMemoryClassification[];
  readonly reason?: "memory_writer_not_configured";
}

export interface SessionMemoryBoundaryService {
  readonly getStatus: (sessionId: string) => Promise<SessionMemoryStatus>;
  readonly commitMemory: (candidate: SessionMemoryCandidate) => Promise<SessionMemoryCommitResult>;
}

export interface CreateSessionMemoryBoundaryServiceOptions {
  readonly writer?: SessionMemoryWriter | null;
  readonly now?: () => number;
}

function errorResult(code: Extract<SessionMemoryCommitResult, { ok: false }>["code"], error: string, status: 400 | 503, audit?: SessionMemoryAuditEnvelope, recoverable?: boolean): Extract<SessionMemoryCommitResult, { ok: false }> {
  return {
    ok: false,
    status,
    code,
    error,
    ...(recoverable === undefined ? {} : { recoverable }),
    ...(audit ? { audit } : {}),
  };
}

function normalizeTags(classification: SessionMemoryClassification, tags: readonly string[] | undefined): readonly string[] {
  return Array.from(new Set(["conversation-memory", classification, ...(tags ?? []).map((tag) => tag.trim()).filter(Boolean)]));
}

function scopeFor(classification: SessionMemoryClassification): SessionMemoryScope | null {
  if (classification === "user-preference") return "user";
  if (classification === "project-fact") return "project";
  return null;
}

function hasExplicitOrStableConfirmation(confirmation: SessionMemoryConfirmation | undefined): boolean {
  if (!confirmation) return false;
  if (confirmation.mode === "explicit") return Boolean(confirmation.confirmedBy.trim());
  return confirmation.mode === "implicit-stable";
}

function isProjectResourceSource(source: SessionMemorySource, projectId: string): boolean {
  return source.kind === "project-resource" && source.projectId === projectId && Boolean(source.path.trim());
}

function buildAudit(candidate: SessionMemoryCandidate, classification: SessionMemoryClassification, createdAt: number): SessionMemoryAuditEnvelope {
  return {
    sessionId: candidate.sessionId,
    ...(candidate.projectId ? { projectId: candidate.projectId } : {}),
    classification,
    source: candidate.source,
    ...(candidate.confirmation ? { confirmation: candidate.confirmation } : {}),
    createdBy: candidate.createdBy,
    createdAt,
  };
}

export function createSessionMemoryBoundaryService(options: CreateSessionMemoryBoundaryServiceOptions = {}): SessionMemoryBoundaryService {
  const writer = options.writer ?? null;
  const now = options.now ?? (() => Date.now());

  return {
    async getStatus(sessionId: string): Promise<SessionMemoryStatus> {
      return {
        ok: true,
        sessionId,
        status: writer ? "writable" : "readonly",
        writable: Boolean(writer),
        categories: SESSION_MEMORY_CATEGORIES,
        ...(writer ? {} : { reason: "memory_writer_not_configured" as const }),
      };
    },

    async commitMemory(candidate: SessionMemoryCandidate): Promise<SessionMemoryCommitResult> {
      const classification = candidate.classification;
      if (!classification) {
        return errorResult("classification_required", "Memory classification is required", 400);
      }

      const audit = buildAudit(candidate, classification, now());

      if (classification === "temporary-story-draft") {
        return { ok: true, action: "skipped", reason: "temporary_story_draft_not_long_term", audit };
      }

      if (!hasExplicitOrStableConfirmation(candidate.confirmation)) {
        return errorResult("explicit_confirmation_required", "Memory write requires explicit confirmation or stable preference evidence", 400, audit);
      }

      const scope = scopeFor(classification);
      if (!scope) {
        return errorResult("classification_required", "Unsupported memory classification", 400, audit);
      }

      if (scope === "project") {
        if (!candidate.projectId?.trim()) {
          return errorResult("project_id_required", "Project memory requires projectId", 400, audit);
        }
        if (!isProjectResourceSource(candidate.source, candidate.projectId)) {
          return errorResult("project_source_required", "Project facts require a traceable project resource source", 400, audit);
        }
      }

      if (!writer) {
        return errorResult("memory_writer_not_configured", "Memory writer is not configured", 503, audit, true);
      }

      const writeResult = await writer({
        scope,
        ...(scope === "project" ? { projectId: candidate.projectId } : {}),
        content: candidate.content,
        tags: normalizeTags(classification, candidate.tags),
        audit,
      });

      if (!writeResult.ok) {
        return errorResult("memory_write_failed", writeResult.error, 503, audit, true);
      }

      return { ok: true, action: "written", memoryId: writeResult.memoryId, scope, audit };
    },
  };
}
