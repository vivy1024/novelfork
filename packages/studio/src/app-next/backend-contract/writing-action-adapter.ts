import type { ToolConfirmationDecision, ToolConfirmationRequest } from "../../shared/agent-native-workspace";
import { normalizeCapability, type BackendCapability } from "./capability-status";
import type { ContractResult } from "./contract-client";
import type { createSessionClient } from "./session-client";
import type { createWritingActionClient } from "./writing-action-client";

export type WritingActionClient = ReturnType<typeof createWritingActionClient>;
export type SessionDomainClient = ReturnType<typeof createSessionClient>;

export interface WritingActionDescriptor {
  id: string;
  label: string;
  entry: string;
  outputBoundary: "chapter-artifact" | "async-start" | "prompt-preview" | "analysis" | "gate";
  writesFormalChapter: boolean;
  capability: BackendCapability;
  chain?: readonly string[];
}

export type NormalizedWritingActionResult =
  | WritingPromptPreviewResult
  | WritingGeneratedResult
  | WritingAsyncStartedResult
  | WritingGateBlockedResult
  | WritingConfirmationRequiredResult
  | WritingUnsupportedResult
  | WritingAnalysisResult;

interface BaseNormalizedWritingActionResult {
  formalChapterWrite: false;
  raw?: unknown;
  capability?: BackendCapability;
}

export interface WritingPromptPreviewResult extends BaseNormalizedWritingActionResult {
  kind: "prompt-preview";
  promptPreview: string | null;
  nextStep: "copy-or-explicit-apply";
}

export interface WritingGeneratedResult extends BaseNormalizedWritingActionResult {
  kind: "generated";
  generatedContent: string;
  nextStep: "explicit-apply-required";
}

export interface WritingAsyncStartedResult extends BaseNormalizedWritingActionResult {
  kind: "async-started";
  status: string;
  nextStep: "wait-for-events-or-refresh";
}

export interface WritingGateBlockedResult extends BaseNormalizedWritingActionResult {
  kind: "gate-blocked";
  gate: unknown;
  error?: unknown;
  nextStep: "show-gate";
}

export interface WritingConfirmationRequiredResult extends BaseNormalizedWritingActionResult {
  kind: "confirmation-required";
  confirmations: readonly ToolConfirmationRequest[];
  nextStep: "show-confirmation";
}

export interface WritingUnsupportedResult extends BaseNormalizedWritingActionResult {
  kind: "unsupported";
  error: unknown;
  nextStep: "show-provider-or-tool-error";
}

export interface WritingAnalysisResult extends BaseNormalizedWritingActionResult {
  kind: "analysis";
  analysis: unknown;
  nextStep: "show-analysis";
}

const DESCRIPTORS: readonly WritingActionDescriptor[] = [
  {
    id: "session-native.write-next",
    label: "Session-native 写下一章",
    entry: "cockpit.snapshot → pgi.ask → AskUserQuestion → pipeline.write",
    outputBoundary: "chapter-artifact",
    writesFormalChapter: true,
    chain: ["cockpit.snapshot", "pgi.ask", "AskUserQuestion", "pipeline.write"],
    capability: normalizeCapability({ id: "session-native.write-next", status: "current" }),
  },
  {
    id: "ai.write-next.async",
    label: "异步写下一章",
    entry: "POST /api/books/:id/write-next",
    outputBoundary: "async-start",
    writesFormalChapter: false,
    capability: normalizeCapability({ id: "ai.write-next", status: "current", metadata: { async: true } }),
  },
  {
    id: "writing-modes.preview",
    label: "Writing modes 预览",
    entry: "POST /api/books/:bookId/inline-write",
    outputBoundary: "prompt-preview",
    writesFormalChapter: false,
    capability: normalizeCapability({ id: "writing-modes.preview", status: "prompt-preview" }),
  },
  {
    id: "hooks.generate",
    label: "生成伏笔建议",
    entry: "POST /api/books/:bookId/hooks/generate",
    outputBoundary: "gate",
    writesFormalChapter: false,
    capability: normalizeCapability({ id: "hooks.generate", status: "current" }),
  },
  {
    id: "hooks.apply",
    label: "应用伏笔到 pending_hooks.md",
    entry: "POST /api/books/:bookId/hooks/apply",
    outputBoundary: "analysis",
    writesFormalChapter: false,
    capability: normalizeCapability({ id: "hooks.apply", status: "current", metadata: { file: "pending_hooks.md" } }),
  },
  {
    id: "ai.audit",
    label: "连续性审校",
    entry: "POST /api/books/:id/audit/:chapter",
    outputBoundary: "analysis",
    writesFormalChapter: false,
    capability: normalizeCapability({ id: "ai.audit", status: "current" }),
  },
  {
    id: "ai.detect",
    label: "AI 味检测",
    entry: "POST /api/books/:id/detect/:chapter",
    outputBoundary: "analysis",
    writesFormalChapter: false,
    capability: normalizeCapability({ id: "ai.detect", status: "current" }),
  },
];

export function listWritingActionDescriptors(): readonly WritingActionDescriptor[] {
  return DESCRIPTORS;
}

export interface CreateWritingActionAdapterInput {
  writing: WritingActionClient;
  sessions: SessionDomainClient;
}

export function createWritingActionAdapter(input: CreateWritingActionAdapterInput) {
  return {
    previewWritingMode: async (bookId: string, payload: unknown) => normalizeWritingActionResult(await input.writing.previewWritingMode(bookId, payload)),
    generateHooks: async (bookId: string, payload: unknown) => normalizeWritingActionResult(await input.writing.generateHooks(bookId, payload)),
    applyHook: async (bookId: string, payload: unknown) => normalizeWritingActionResult(await input.writing.applyHook(bookId, payload)),
    auditChapter: async (bookId: string, chapterNumber: number) => normalizeWritingActionResult(await input.writing.auditChapter(bookId, chapterNumber)),
    detectChapter: async (bookId: string, chapterNumber: number) => normalizeWritingActionResult(await input.writing.detectChapter(bookId, chapterNumber)),
    listSessionNativeConfirmations: async (sessionId: string): Promise<NormalizedWritingActionResult> => {
      const result = await input.sessions.listPendingTools<{ pending: readonly ToolConfirmationRequest[] }>(sessionId);
      if (!result.ok) return normalizeWritingActionResult(result);
      return {
        kind: "confirmation-required",
        confirmations: result.data.pending,
        formalChapterWrite: false,
        raw: result.raw,
        capability: result.capability,
        nextStep: "show-confirmation",
      };
    },
    confirmSessionNativeStep: async (sessionId: string, toolName: string, decision: ToolConfirmationDecision) =>
      normalizeWritingActionResult(await input.sessions.confirmTool(sessionId, toolName, decision)),
  };
}

export function normalizeWritingActionResult(result: ContractResult<unknown>): NormalizedWritingActionResult {
  if (!result.ok) {
    const failureRecord = asRecord(result.error ?? result.raw);
    if (failureRecord?.gate) {
      return {
        kind: "gate-blocked",
        gate: failureRecord.gate,
        error: failureRecord.error,
        formalChapterWrite: false,
        raw: result.raw,
        capability: result.capability,
        nextStep: "show-gate",
      };
    }
    return {
      kind: "unsupported",
      error: result.error ?? result.raw ?? result.code ?? result.cause,
      formalChapterWrite: false,
      raw: result.raw,
      capability: result.capability,
      nextStep: "show-provider-or-tool-error",
    };
  }

  const data = result.data;
  const record = asRecord(data);
  if (record?.gate) {
    return { kind: "gate-blocked", gate: record.gate, error: record.error, formalChapterWrite: false, raw: result.raw, capability: result.capability, nextStep: "show-gate" };
  }

  if (record?.mode === "prompt-preview") {
    return {
      kind: "prompt-preview",
      promptPreview: stringOrNull(record.promptPreview ?? record.prompt),
      formalChapterWrite: false,
      raw: result.raw,
      capability: result.capability,
      nextStep: "copy-or-explicit-apply",
    };
  }

  if (record?.mode === "generated" && typeof record.content === "string") {
    return {
      kind: "generated",
      generatedContent: record.content,
      formalChapterWrite: false,
      raw: result.raw,
      capability: result.capability,
      nextStep: "explicit-apply-required",
    };
  }

  if (record?.status === "writing" || record?.status === "drafting" || record?.status === "queued") {
    return {
      kind: "async-started",
      status: String(record.status),
      formalChapterWrite: false,
      raw: result.raw,
      capability: result.capability,
      nextStep: "wait-for-events-or-refresh",
    };
  }

  return {
    kind: "analysis",
    analysis: data,
    formalChapterWrite: false,
    raw: result.raw,
    capability: result.capability,
    nextStep: "show-analysis",
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
