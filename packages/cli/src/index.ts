#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { formatRuntimeCommandHelp } from "@vivy1024/novelfork-core/registry/command-registry";
import { initCommand } from "./commands/init.js";
import { configCommand } from "./commands/config.js";
import { bookCommand } from "./commands/book.js";
import { writeCommand } from "./commands/write.js";
import { reviewCommand } from "./commands/review.js";
import { statusCommand } from "./commands/status.js";
import { radarCommand } from "./commands/radar.js";
import { upCommand, downCommand } from "./commands/daemon.js";
import { doctorCommand } from "./commands/doctor.js";
import { exportCommand } from "./commands/export.js";
import { draftCommand } from "./commands/draft.js";
import { auditCommand } from "./commands/audit.js";
import { reviseCommand } from "./commands/revise.js";
import { agentCommand } from "./commands/agent.js";
import { planCommand } from "./commands/plan.js";
import { composeCommand } from "./commands/compose.js";
import { genreCommand } from "./commands/genre.js";
import { updateCommand } from "./commands/update.js";
import { detectCommand } from "./commands/detect.js";
import { styleCommand } from "./commands/style.js";
import { analyticsCommand } from "./commands/analytics.js";
import { evalCommand } from "./commands/eval.js";
import { importCommand } from "./commands/import.js";
import { fanficCommand } from "./commands/fanfic.js";
import { studioCommand } from "./commands/studio.js";
import { consolidateCommand } from "./commands/consolidate.js";
import { execCommand } from "./commands/exec.js";
import { chatCommand } from "./commands/chat.js";
import { runHeadlessChatCommand, type HeadlessChatCommonOptions } from "./commands/headless-chat-common.js";
import { log, logError } from "./utils.js";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
) as { version: string };

interface RootPrintOptions extends HeadlessChatCommonOptions {
  readonly print?: string;
}

function attachRuntimeCommandHelp(program: Command): void {
  const originalHelpInformation = program.helpInformation.bind(program);
  program.helpInformation = ((contextOptions?: Parameters<Command["helpInformation"]>[0]) => {
    const baseHelp = originalHelpInformation(contextOptions);
    return `${baseHelp}\nAgent runtime commands:\n${formatRuntimeCommandHelp()}\n`;
  }) as Command["helpInformation"];
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

export function createProgram(): Command {
  const program = new Command();

  program
    .name("novelfork")
    .description("NovelFork — Multi-agent web novel production system")
    .version(version)
    .option("-p, --print <prompt>", "Run one non-interactive headless agent turn")
    .option("--book <bookId>", "Book/project ID for root -p context")
    .option("--session <sessionId>", "Reuse an existing session for root -p")
    .option("--model <provider:model>", "Explicit provider:model for root -p")
    .option("--permission-mode <mode>", "Permission mode for root -p: ask, edit, allow, read, or plan")
    .option("--root <path>", "Project root directory for root -p")
    .option("--json", "Output JSONL events for root -p")
    .option("--stdin", "Read additional context from stdin for root -p")
    .option("--studio-url <url>", "Studio API base URL for root -p", "http://localhost:4567")
    .option("--max-steps <n>", "Maximum tool loop steps for root -p")
    .option("--max-turns <n>", "Maximum headless chat turns for root -p")
    .option("--max-budget-usd <n>", "Maximum headless budget for root -p; 0 stops before model call")
    .option("--input-format <format>", "Input format for root -p: text or stream-json", "text")
    .option("--output-format <format>", "Output format for root -p: json or stream-json", "json")
    .option("--no-session-persistence", "Run root -p with an ephemeral session and do not write chat history")
    .action(async (opts: RootPrintOptions) => {
      if (!opts.print) return;
      try {
        await runHeadlessChatCommand({
          commandLabel: "Print",
          prompt: opts.print,
          options: opts,
          readStdinContext,
        });
      } catch (error) {
        if (opts.json || opts.outputFormat === "stream-json") {
          log(JSON.stringify({ type: "result", success: false, exit_code: 1, error: String(error) }));
        } else {
          logError(`Failed to run print prompt: ${error}`);
          logError("Make sure NovelFork Studio is running (novelfork studio).");
        }
        process.exit(1);
      }
    });

  program.addCommand(initCommand);
  program.addCommand(configCommand);
  program.addCommand(bookCommand);
  program.addCommand(writeCommand);
  program.addCommand(reviewCommand);
  program.addCommand(statusCommand);
  program.addCommand(radarCommand);
  program.addCommand(upCommand);
  program.addCommand(downCommand);
  program.addCommand(doctorCommand);
  program.addCommand(exportCommand);
  program.addCommand(draftCommand);
  program.addCommand(auditCommand);
  program.addCommand(reviseCommand);
  program.addCommand(agentCommand);
  program.addCommand(planCommand);
  program.addCommand(composeCommand);
  program.addCommand(genreCommand);
  program.addCommand(updateCommand);
  program.addCommand(detectCommand);
  program.addCommand(styleCommand);
  program.addCommand(analyticsCommand);
  program.addCommand(evalCommand);
  program.addCommand(importCommand);
  program.addCommand(fanficCommand);
  program.addCommand(studioCommand);
  program.addCommand(consolidateCommand);
  program.addCommand(execCommand);
  program.addCommand(chatCommand);

  attachRuntimeCommandHelp(program);
  return program;
}

function isDirectCliEntry(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  return resolve(invoked) === fileURLToPath(import.meta.url);
}

if (isDirectCliEntry()) {
  createProgram().parse();
}
