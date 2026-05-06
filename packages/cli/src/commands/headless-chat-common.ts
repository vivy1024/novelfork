import { log, logError } from "../utils.js";

const DEFAULT_STUDIO_URL = "http://localhost:4567";

export interface HeadlessChatCommonOptions {
  readonly book?: string;
  readonly session?: string;
  readonly model?: string;
  readonly json?: boolean;
  readonly stdin?: boolean;
  readonly studioUrl?: string;
  readonly maxSteps?: string;
  readonly inputFormat?: "text" | "stream-json";
  readonly outputFormat?: "json" | "stream-json";
  readonly sessionPersistence?: boolean;
  readonly maxTurns?: string;
  readonly maxBudgetUsd?: string;
}

export interface HeadlessChatRunOptions {
  readonly commandLabel: string;
  readonly prompt: string;
  readonly options: HeadlessChatCommonOptions;
  readonly readStdinContext: () => Promise<string | undefined>;
  readonly legacyExecEndpoint?: boolean;
}

function parseModelReference(model: string): { providerId: string; modelId: string } | null {
  const [providerId, modelId] = model.split(":");
  if (!providerId || !modelId) return null;
  return { providerId, modelId };
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseNonNegativeInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseNonNegativeNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function buildHeadlessChatBody(prompt: string, opts: HeadlessChatCommonOptions): Record<string, unknown> {
  const inputFormat = opts.inputFormat ?? "text";
  const outputFormat = opts.outputFormat ?? "json";
  const body: Record<string, unknown> = inputFormat === "stream-json"
    ? { inputFormat: "stream-json", outputFormat, events: [{ type: "user_message", content: prompt }] }
    : { prompt, outputFormat };

  if (opts.book) body.projectId = opts.book;
  if (opts.session) body.sessionId = opts.session;
  if (opts.sessionPersistence === false) body.noSessionPersistence = true;

  if (opts.model) {
    const parsed = parseModelReference(opts.model);
    if (!parsed) {
      throw new Error("Invalid --model format. Expected provider:model (e.g. openai:gpt-4o)");
    }
    body.sessionConfig = { providerId: parsed.providerId, modelId: parsed.modelId };
  }

  const maxSteps = parsePositiveInteger(opts.maxSteps);
  if (maxSteps !== undefined) body.maxSteps = maxSteps;
  const maxTurns = parseNonNegativeInteger(opts.maxTurns);
  if (maxTurns !== undefined) body.maxTurns = maxTurns;
  const maxBudgetUsd = parseNonNegativeNumber(opts.maxBudgetUsd);
  if (maxBudgetUsd !== undefined) body.maxBudgetUsd = maxBudgetUsd;

  return body;
}

function buildLegacyExecBody(prompt: string, opts: HeadlessChatCommonOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt,
    ...(opts.json ? { jsonOutput: true } : {}),
  };
  if (opts.book) body.projectId = opts.book;
  if (opts.session) body.sessionId = opts.session;
  if (opts.model) {
    const parsed = parseModelReference(opts.model);
    if (!parsed) {
      throw new Error("Invalid --model format. Expected provider:model (e.g. openai:gpt-4o)");
    }
    body.sessionConfig = { providerId: parsed.providerId, modelId: parsed.modelId };
  }
  const maxSteps = parsePositiveInteger(opts.maxSteps);
  if (maxSteps !== undefined) body.maxSteps = maxSteps;
  return body;
}

function shouldUseHeadlessChat(opts: HeadlessChatCommonOptions, legacyExecEndpoint: boolean): boolean {
  if (!legacyExecEndpoint) return true;
  return opts.inputFormat === "stream-json"
    || opts.outputFormat === "stream-json"
    || opts.sessionPersistence === false
    || opts.maxTurns !== undefined
    || opts.maxBudgetUsd !== undefined;
}

function extractExitCode(result: { exitCode?: unknown; exit_code?: unknown }): number {
  if (typeof result.exitCode === "number") return result.exitCode;
  if (typeof result.exit_code === "number") return result.exit_code;
  return 1;
}

function extractSuccess(result: { success?: unknown }): boolean {
  return result.success === true;
}

function extractPendingConfirmation(result: Record<string, unknown>): { toolName?: string; id?: string } | undefined {
  const pending = result.pendingConfirmation ?? result.pending_confirmation;
  if (!pending || typeof pending !== "object") return undefined;
  return pending as { toolName?: string; id?: string };
}

async function parseResponse(response: Response, expectsNdjson: boolean): Promise<Record<string, unknown>> {
  if (expectsNdjson) {
    const text = await response.text();
    const events = text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
    const resultEvent = [...events].reverse().find((event) => event.type === "result") ?? {};
    return {
      success: resultEvent.success === true,
      exitCode: extractExitCode(resultEvent),
      sessionId: resultEvent.session_id,
      events,
      pendingConfirmation: resultEvent.pending_confirmation,
      error: resultEvent.error,
    };
  }
  return await response.json() as Record<string, unknown>;
}

function outputJsonEvents(result: Record<string, unknown>, legacyExec: boolean): void {
  const events = Array.isArray(result.events) ? result.events : [];
  if (legacyExec) {
    if (typeof result.sessionId === "string") {
      log(JSON.stringify({ type: "session.created", sessionId: result.sessionId }));
    }
    for (const event of events) log(JSON.stringify(event));
    log(JSON.stringify({
      type: extractSuccess(result) ? "exec.completed" : "exec.failed",
      exitCode: extractExitCode(result),
      ...(typeof result.error === "string" ? { error: result.error } : {}),
      ...(extractPendingConfirmation(result) ? { pendingConfirmation: extractPendingConfirmation(result) } : {}),
    }));
    return;
  }
  for (const event of events) log(JSON.stringify(event));
}

export async function runHeadlessChatCommand(input: HeadlessChatRunOptions): Promise<void> {
  const opts = input.options;
  const studioUrl = opts.studioUrl ?? DEFAULT_STUDIO_URL;
  const useHeadlessChat = shouldUseHeadlessChat(opts, input.legacyExecEndpoint ?? false);
  const outputFormat = opts.outputFormat ?? "json";
  const body = useHeadlessChat ? buildHeadlessChatBody(input.prompt, opts) : buildLegacyExecBody(input.prompt, opts);

  if (opts.stdin) {
    const stdinContext = await input.readStdinContext();
    if (stdinContext) body.stdinContext = stdinContext;
  }

  const apiPath = useHeadlessChat ? "/api/sessions/headless-chat" : "/api/exec";
  const response = await fetch(`${studioUrl}${apiPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await parseResponse(response as Response, outputFormat === "stream-json");
  const exitCode = extractExitCode(result);
  const pendingConfirmation = extractPendingConfirmation(result);

  if (opts.json || outputFormat === "stream-json") {
    outputJsonEvents(result, !useHeadlessChat);
  } else if (extractSuccess(result) && typeof result.finalMessage === "string") {
    log(result.finalMessage);
  } else if (exitCode === 2 && pendingConfirmation) {
    const toolName = pendingConfirmation.toolName ?? (pendingConfirmation as { tool_name?: string }).tool_name ?? "unknown";
    logError(`Pending confirmation required: ${toolName}`);
    if (typeof result.sessionId === "string") logError(`Session: ${result.sessionId}`);
    logError("Use Studio UI to approve/reject, then pass --session to continue.");
  } else {
    logError(`${input.commandLabel} failed: ${typeof result.error === "string" ? result.error : "unknown error"}`);
    if (typeof result.toolChainSummary === "string") {
      logError(`\nTool chain:\n${result.toolChainSummary}`);
    }
  }

  process.exit(exitCode);
}
