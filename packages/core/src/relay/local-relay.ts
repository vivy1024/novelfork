/**
 * LocalAIRelay — implements {@link AIRelay} for in-process execution.
 *
 * PipelineRunner has been removed. The streaming write operations
 * (startWriteNext, startDraft, startRevise) and audit now throw
 * "not implemented" errors. Detection and style analysis still work.
 */

import type { AuditResult } from "../models/agent-types.js";
import type { StyleProfile } from "../models/style-profile.js";
import type { AIRelay, WriteSnapshot, RunResult } from "./relay.js";
import type { LLMRelayConfig, RunHandle, RunState, RunStatus } from "./types.js";

// Types from moved modules — using local interfaces to avoid circular deps
interface DetectionResult {
  score: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Internal run record
// ---------------------------------------------------------------------------

interface RunRecord {
  readonly runId: string;
  status: RunStatus;
  stage?: string;
  progress?: number;
  error?: string;
  result?: RunResult;
}

// ---------------------------------------------------------------------------
// LocalAIRelay
// ---------------------------------------------------------------------------

export class LocalAIRelay implements AIRelay {
  private readonly projectRoot: string;
  private readonly runs = new Map<string, RunRecord>();

  constructor(
    projectRoot: string,
    _basePipelineConfig?: Partial<Record<string, unknown>>,
  ) {
    this.projectRoot = projectRoot;
  }

  // -----------------------------------------------------------------------
  // Streaming operations (PipelineRunner removed — these now throw)
  // -----------------------------------------------------------------------

  async startWriteNext(
    _snapshot: WriteSnapshot,
    _llm: LLMRelayConfig,
  ): Promise<RunHandle> {
    throw new Error("startWriteNext is no longer available — PipelineRunner has been removed. Use pipeline.write tool instead.");
  }

  async startDraft(
    _snapshot: WriteSnapshot,
    _llm: LLMRelayConfig,
    _wordCount?: number,
  ): Promise<RunHandle> {
    throw new Error("startDraft is no longer available — PipelineRunner has been removed. Use pipeline.write tool instead.");
  }

  async startRevise(
    _snapshot: WriteSnapshot,
    _chapterNum: number,
    _llm: LLMRelayConfig,
  ): Promise<RunHandle> {
    throw new Error("startRevise is no longer available — PipelineRunner has been removed. Use the revise endpoint directly.");
  }

  // -----------------------------------------------------------------------
  // Request / response operations
  // -----------------------------------------------------------------------

  async audit(
    _snapshot: WriteSnapshot,
    _chapterNum: number,
    _llm: LLMRelayConfig,
  ): Promise<AuditResult> {
    throw new Error("audit via relay is no longer available — PipelineRunner has been removed. Use the audit endpoint directly.");
  }

  async detect(
    _content: string,
    _llm: LLMRelayConfig,
  ): Promise<DetectionResult> {
    throw new Error("detect via LocalAIRelay is no longer available in core. Use the Studio ai-relay route or novel-plugin AI route instead.");
  }

  async analyzeStyle(
    _text: string,
    _llm: LLMRelayConfig,
  ): Promise<StyleProfile> {
    throw new Error("analyzeStyle via LocalAIRelay is no longer available in core. Use the Studio ai-relay route or novel-plugin style tools instead.");
  }

  // -----------------------------------------------------------------------
  // Run management
  // -----------------------------------------------------------------------

  async cancelRun(runId: string): Promise<void> {
    const record = this.runs.get(runId);
    if (!record) {
      throw new Error(`Run not found: ${runId}`);
    }
    if (record.status === "running" || record.status === "pending") {
      record.status = "cancelled";
    }
  }

  async getRunState(runId: string): Promise<RunState> {
    const record = this.runs.get(runId);
    if (!record) {
      throw new Error(`Run not found: ${runId}`);
    }
    return {
      runId: record.runId,
      status: record.status,
      stage: record.stage,
      progress: record.progress,
      error: record.error,
    };
  }
}
