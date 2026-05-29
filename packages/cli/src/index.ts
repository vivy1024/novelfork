#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { formatRuntimeCommandHelp } from "@vivy1024/novelfork-core/registry/command-registry";
import { initCommand } from "./commands/init.js";
import { configCommand } from "./commands/config.js";
import { doctorCommand } from "./commands/doctor.js";
import { exportCommand } from "./commands/export.js";
import { updateCommand } from "./commands/update.js";
import { analyticsCommand } from "./commands/analytics.js";
import { studioCommand } from "./commands/studio.js";
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

function disabledLegacyCommand(name: string, description: string): Command {
  return new Command(name)
    .description(`${description}（旧 CLI 管线已停用，请使用 novelfork studio 或 novelfork chat）`)
    .argument("[args...]", "ignored legacy arguments")
    .allowUnknownOption(true)
    .action(() => {
      logError(`命令 novelfork ${name} 依赖旧 core 管线，当前版本已停用。请使用 novelfork studio 或 novelfork chat。`);
      process.exitCode = 1;
    });
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
  program.addCommand(disabledLegacyCommand("book", "书籍管理"));
  program.addCommand(disabledLegacyCommand("write", "旧写作管线"));
  program.addCommand(disabledLegacyCommand("review", "旧章节审稿"));
  program.addCommand(disabledLegacyCommand("status", "旧项目状态"));
  program.addCommand(disabledLegacyCommand("radar", "旧雷达分析"));
  program.addCommand(disabledLegacyCommand("up", "旧守护进程启动"));
  program.addCommand(disabledLegacyCommand("down", "旧守护进程停止"));
  program.addCommand(doctorCommand);
  program.addCommand(exportCommand);
  program.addCommand(disabledLegacyCommand("draft", "旧草稿生成"));
  program.addCommand(disabledLegacyCommand("audit", "旧审计管线"));
  program.addCommand(disabledLegacyCommand("revise", "旧修订管线"));
  program.addCommand(disabledLegacyCommand("agent", "旧 Agent 循环"));
  program.addCommand(disabledLegacyCommand("plan", "旧规划管线"));
  program.addCommand(disabledLegacyCommand("compose", "旧组合写作"));
  program.addCommand(disabledLegacyCommand("genre", "旧类型资料"));
  program.addCommand(updateCommand);
  program.addCommand(disabledLegacyCommand("detect", "旧检测管线"));
  program.addCommand(disabledLegacyCommand("style", "旧风格分析"));
  program.addCommand(analyticsCommand);
  program.addCommand(disabledLegacyCommand("eval", "旧质量评估"));
  program.addCommand(disabledLegacyCommand("import", "旧导入管线"));
  program.addCommand(disabledLegacyCommand("fanfic", "旧同人管线"));
  program.addCommand(studioCommand);
  program.addCommand(disabledLegacyCommand("consolidate", "旧资料整合"));
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
