import { Command } from "commander";
import { log, logError } from "../utils.js";
import { runHeadlessChatCommand, type HeadlessChatCommonOptions } from "./headless-chat-common.js";

interface ChatOptions extends HeadlessChatCommonOptions {}

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

export const chatCommand = new Command("chat")
  .description("Headless session chat via Studio API")
  .argument("<prompt>", "Prompt to send (use '-' to read from stdin)")
  .option("--book <bookId>", "Book/project ID for context")
  .option("--session <sessionId>", "Reuse an existing session")
  .option("--model <provider:model>", "Explicit provider:model (e.g. openai:gpt-4o)")
  .option("--json", "Output JSONL events")
  .option("--stdin", "Read additional context from stdin")
  .option("--studio-url <url>", "Studio API base URL", "http://localhost:4567")
  .option("--max-steps <n>", "Maximum tool loop steps")
  .option("--max-turns <n>", "Maximum headless chat turns")
  .option("--max-budget-usd <n>", "Maximum headless budget; 0 stops before model call")
  .option("--input-format <format>", "Input format: text or stream-json", "text")
  .option("--output-format <format>", "Output format: json or stream-json", "json")
  .option("--no-session-persistence", "Run with an ephemeral session and do not write chat history")
  .action(async (promptArg: string, opts: ChatOptions) => {
    try {
      let prompt = promptArg;
      if (prompt === "-") {
        const stdinText = await readStdinContext();
        if (!stdinText) {
          logError("No input received from stdin");
          process.exit(1);
        }
        prompt = stdinText;
      }

      await runHeadlessChatCommand({
        commandLabel: "Chat",
        prompt,
        options: opts,
        readStdinContext,
      });
    } catch (error) {
      if (opts.json || opts.outputFormat === "stream-json") {
        log(JSON.stringify({ type: "result", success: false, exit_code: 1, error: String(error) }));
      } else {
        logError(`Failed to chat: ${error}`);
        logError("Make sure NovelFork Studio is running (novelfork studio)." );
      }
      process.exit(1);
    }
  });
