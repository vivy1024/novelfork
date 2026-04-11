/**
 * LocalAIRelay — wraps a {@link PipelineRunner} to implement
 * {@link AIRelay} for in-process execution.
 *
 * Each streaming call creates a PipelineRunner on-the-fly with the
 * supplied {@link LLMRelayConfig}, executes the operation in the
 * background, and returns a {@link RunHandle} for status tracking.
 */

import { randomUUID } from "node:crypto";
import { createLLMClient } from "../llm/provider.js";
import type { LLMConfig } from "../models/project.js";
import { PipelineRunner, type PipelineConfig } from "../pipeline/runner.js";
import type { AuditResult } from "../agents/continuity.js";
import type { DetectionResult } from "../agents/detector.js";
import { detectAIContent } from "../agents/detector.js";
import { analyzeStyle as analyzeStyleSync } from "../agents/style-analyzer.js";
import type { StyleProfile } from "../models/style-profile.js";
import type { AIRelay, WriteSnapshot, RunResult } from "./relay.js";
import type { LLMRelayConfig, RunHandle, RunState, RunStatus } from "./types.js";

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
  private readonly basePipelineConfig: Partial<PipelineConfig>;
  private readonly runs = new Map<string, RunRecord>();

  constructor(
    projectRoot: string,
    basePipelineConfig?: Partial<PipelineConfig>,
  ) {
    this.projectRoot = projectRoot;
    this.basePipelineConfig = basePipelineConfig ?? {};
  }

  // -----------------------------------------------------------------------
  // Streaming operations
  // -----------------------------------------------------------------------

  async startWriteNext(
    snapshot: WriteSnapshot,
    llm: LLMRelayConfig,
  ): Promise<RunHandle> {
    const runId = randomUUID();
    const record = this.createRun(runId);

    const runner = this.buildRunner(llm, snapshot);
    this.executeAsync(record, async () => {
      const value = await runner.writeNextChapter(
        snapshot.bookId,
        snapshot.wordCount,
        snapshot.temperatureOverride,
      );
      record.result = { kind: "writeNext", value };
    });

    return { runId };
  }

  async startDraft(
    snapshot: WriteSnapshot,
    llm: LLMRelayConfig,
    wordCount?: number,
  ): Promise<RunHandle> {
    const runId = randomUUID();
    const record = this.createRun(runId);

    const runner = this.buildRunner(llm, snapshot);
    this.executeAsync(record, async () => {
      const value = await runner.writeDraft(
        snapshot.bookId,
        snapshot.externalContext,
        wordCount ?? snapshot.wordCount,
      );
      record.result = { kind: "draft", value };
    });

    return { runId };
  }

  async startRevise(
    snapshot: WriteSnapshot,
    chapterNum: number,
    llm: LLMRelayConfig,
  ): Promise<RunHandle> {
    const runId = randomUUID();
    const record = this.createRun(runId);

    const runner = this.buildRunner(llm, snapshot);
    this.executeAsync(record, async () => {
      const value = await runner.reviseDraft(snapshot.bookId, chapterNum);
      record.result = { kind: "revise", value };
    });

    return { runId };
  }

  // -----------------------------------------------------------------------
  // Request / response operations
  // -----------------------------------------------------------------------

  async audit(
    snapshot: WriteSnapshot,
    chapterNum: number,
    llm: LLMRelayConfig,
  ): Promise<AuditResult> {
    const runner = this.buildRunner(llm, snapshot);
    return runner.auditDraft(snapshot.bookId, chapterNum);
  }

  async detect(
    content: string,
    _llm: LLMRelayConfig,
  ): Promise<DetectionResult> {
    // detectAIContent uses DetectionConfig from project config, not LLMRelayConfig.
    // The llm parameter is reserved for future provider-based detection.
    return detectAIContent(
      { provider: "gptzero", apiUrl: "https://api.gptzero.me/v2/predict/text", apiKeyEnv: "GPTZERO_API_KEY", threshold: 0.5, enabled: false, autoRewrite: false, maxRetries: 3 },
      content,
    );
  }

  async analyzeStyle(
    text: string,
    _llm: LLMRelayConfig,
  ): Promise<StyleProfile> {
    // analyzeStyle is a synchronous local computation — no LLM call needed.
    return analyzeStyleSync(text);
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

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private createRun(runId: string): RunRecord {
    const record: RunRecord = { runId, status: "pending" };
    this.runs.set(runId, record);
    return record;
  }

  private buildRunner(
    llm: LLMRelayConfig,
    snapshot: WriteSnapshot,
  ): PipelineRunner {
    const llmConfig: LLMConfig = {
      apiKey: llm.apiKey,
      baseUrl: llm.baseUrl,
      model: llm.model,
      provider: (llm.provider as LLMConfig["provider"]) ?? "openai",
      temperature: llm.temperature ?? 0.7,
      maxTokens: llm.maxTokens ?? 8192,
      thinkingBudget: 0,
      apiFormat: "chat" as const,
      stream: llm.stream ?? true,
    };

    const client = createLLMClient(llmConfig);

    const pipelineConfig: PipelineConfig = {
      ...this.basePipelineConfig,
      client,
      model: llm.model,
      projectRoot: snapshot.projectRoot || this.projectRoot,
      defaultLLMConfig: llmConfig,
      modelOverrides: llm.modelOverrides
        ? Object.fromEntries(
            Object.entries(llm.modelOverrides).map(([k, v]) => [k, v]),
          )
        : this.basePipelineConfig.modelOverrides,
    };

    return new PipelineRunner(pipelineConfig);
  }

  private executeAsync(
    record: RunRecord,
    fn: () => Promise<void>,
  ): void {
    record.status = "running";

    fn()
      .then(() => {
        if (record.status === "running") {
          record.status = "completed";
        }
      })
      .catch((err: unknown) => {
        record.status = "failed";
        record.error =
          err instanceof Error ? err.message : String(err);
      });
  }
}
