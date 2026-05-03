import { Command } from "commander";
import { findProjectRoot, log, logError, resolveContext } from "../utils.js";

const DEFAULT_STUDIO_URL = "http://localhost:4567";

interface ExecOptions {
  readonly root?: string;
  readonly book?: string;
  readonly session?: string;
  readonly model?: string;
  readonly json?: boolean;
  readonly stdin?: boolean;
  readonly studioUrl?: string;
  readonly maxSteps?: string;
}

function parseModelReference(model: string): { providerId: string; modelId: string } | null {
  const [providerId, modelId] = model.split(":");
  if (!providerId || !modelId) return null;
  return { providerId, modelId };
}

async function readStdinContext(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  // @ts-ignore - Buffer.concat type issue
  const text = Buffer.concat(chunks).toString("utf-8").trim();
  return text.length > 0 ? text : undefined;
}

export const execCommand = new Command("exec")
  .description("Non-interactive headless agent execution via Studio API")
  .argument("<prompt>", "The prompt to execute (use '-' to read from stdin)")
  .option("--root <path>", "Project root directory")
  .option("--book <bookId>", "Book/project ID for context")
  .option("--session <sessionId>", "Reuse an existing session")
  .option("--model <provider:model>", "Explicit provider:model (e.g. openai:gpt-4o)")
  .option("--json", "Output JSONL event stream")
  .option("--stdin", "Read additional context from stdin")
  .option("--studio-url <url>", "Studio API base URL", DEFAULT_STUDIO_URL)
  .option("--max-steps <n>", "Maximum tool loop steps")
  .action(async (promptArg: string, opts: ExecOptions) => {
    try {
      const studioUrl = opts.studioUrl ?? DEFAULT_STUDIO_URL;

      // Resolve prompt — '-' means read from stdin
      let prompt = promptArg;
      if (prompt === "-") {
        const stdinText = await readStdinContext();
        if (!stdinText) {
          logError("No input received from stdin");
          process.exit(1);
        }
        prompt = stdinText;
      }

      // Build request body
      const body: Record<string, unknown> = {
        prompt,
        ...(opts.json ? { jsonOutput: true } : {}),
      };

      if (opts.book) body.projectId = opts.book;
      if (opts.session) body.sessionId = opts.session;

      if (opts.model) {
        const parsed = parseModelReference(opts.model);
        if (!parsed) {
          logError("Invalid --model format. Expected provider:model (e.g. openai:gpt-4o)");
          process.exit(1);
        }
        body.sessionConfig = { providerId: parsed.providerId, modelId: parsed.modelId };
      }

      if (opts.maxSteps) {
        const steps = parseInt(opts.maxSteps, 10);
        if (Number.isFinite(steps) && steps > 0) body.maxSteps = steps;
      }

      // Read stdin context if --stdin flag is set (separate from prompt)
      if (opts.stdin) {
        const stdinContext = await readStdinContext();
        if (stdinContext) body.stdinContext = stdinContext;
      }

      // Call Studio API
      const response = await fetch(`${studioUrl}/api/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const result = await response.json() as {
        success: boolean;
        exitCode: number;
        sessionId?: string;
        finalMessage?: string;
        error?: string;
        toolChainSummary?: string;
        pendingConfirmation?: { toolName: string; id: string };
        events?: unknown[];
      };

      if (opts.json) {
        // JSONL output — one event per line
        if (result.sessionId) {
          log(JSON.stringify({ type: "session.created", sessionId: result.sessionId }));
        }
        if (Array.isArray(result.events)) {
          for (const event of result.events) {
            log(JSON.stringify(event));
          }
        }
        log(JSON.stringify({
          type: result.success ? "exec.completed" : "exec.failed",
          exitCode: result.exitCode,
          ...(result.error ? { error: result.error } : {}),
          ...(result.pendingConfirmation ? { pendingConfirmation: result.pendingConfirmation } : {}),
        }));
      } else {
        // Human-readable output
        if (result.success && result.finalMessage) {
          log(result.finalMessage);
        } else if (result.exitCode === 2 && result.pendingConfirmation) {
          logError(`Pending confirmation required: ${result.pendingConfirmation.toolName}`);
          logError(`Session: ${result.sessionId}`);
          logError("Use --session to resume after confirming in Studio UI.");
        } else {
          logError(`Execution failed: ${result.error ?? "unknown error"}`);
          if (result.toolChainSummary) {
            logError(`\nTool chain:\n${result.toolChainSummary}`);
          }
        }
      }

      process.exit(result.exitCode);
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ type: "exec.failed", error: String(e) }));
      } else {
        logError(`Failed to execute: ${e}`);
        logError("Make sure NovelFork Studio is running (novelfork studio).");
      }
      process.exit(1);
    }
  });
