import { Command } from "commander";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { findProjectRoot, log, logError, GLOBAL_CONFIG_DIR, GLOBAL_ENV_PATH } from "../utils.js";

export const configCommand = new Command("config")
  .description("Manage project configuration");

configCommand
  .command("set")
  .description("Set a configuration value")
  .argument("<key>", "Config key (e.g., llm.apiKey)")
  .argument("<value>", "Config value")
  .action(async (key: string, value: string) => {
    const root = findProjectRoot();
    const configPath = join(root, "inkos.json");

    try {
      const raw = await readFile(configPath, "utf-8");
      const config = JSON.parse(raw);

      const keys = key.split(".");
      let target = config;
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i]!;
        if (!(k in target)) {
          target[k] = {};
        }
        target = target[k];
      }
      target[keys[keys.length - 1]!] = value;

      await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
      log(`Set ${key} = ${value}`);
    } catch (e) {
      logError(`Failed to update config: ${e}`);
      process.exit(1);
    }
  });

configCommand
  .command("set-global")
  .description("Set global LLM config (~/.inkos/.env), shared by all projects")
  .requiredOption("--provider <provider>", "LLM provider (openai / anthropic)")
  .requiredOption("--base-url <url>", "API base URL")
  .requiredOption("--api-key <key>", "API key")
  .requiredOption("--model <model>", "Model name")
  .option("--temperature <n>", "Temperature")
  .option("--max-tokens <n>", "Max output tokens")
  .option("--thinking-budget <n>", "Anthropic thinking budget")
  .option("--api-format <format>", "API format (chat / responses)")
  .action(async (opts) => {
    try {
      await mkdir(GLOBAL_CONFIG_DIR, { recursive: true });

      const lines = [
        "# InkOS Global LLM Configuration",
        `INKOS_LLM_PROVIDER=${opts.provider}`,
        `INKOS_LLM_BASE_URL=${opts.baseUrl}`,
        `INKOS_LLM_API_KEY=${opts.apiKey}`,
        `INKOS_LLM_MODEL=${opts.model}`,
      ];
      if (opts.temperature) lines.push(`INKOS_LLM_TEMPERATURE=${opts.temperature}`);
      if (opts.maxTokens) lines.push(`INKOS_LLM_MAX_TOKENS=${opts.maxTokens}`);
      if (opts.thinkingBudget) lines.push(`INKOS_LLM_THINKING_BUDGET=${opts.thinkingBudget}`);
      if (opts.apiFormat) lines.push(`INKOS_LLM_API_FORMAT=${opts.apiFormat}`);

      await writeFile(GLOBAL_ENV_PATH, lines.join("\n") + "\n", "utf-8");
      log(`Global config saved to ${GLOBAL_ENV_PATH}`);
      log("All projects will use this config unless overridden by project .env");
    } catch (e) {
      logError(`Failed to set global config: ${e}`);
      process.exit(1);
    }
  });

configCommand
  .command("show-global")
  .description("Show global LLM config (~/.inkos/.env)")
  .action(async () => {
    try {
      const content = await readFile(GLOBAL_ENV_PATH, "utf-8");
      const masked = content.replace(
        /(INKOS_LLM_API_KEY=)(.{8})(.*)(.{4})/,
        "$1$2...$4",
      );
      log(masked);
    } catch {
      log("No global config found. Run 'inkos config set-global' to create one.");
    }
  });

configCommand
  .command("show")
  .description("Show current project configuration")
  .action(async () => {
    const root = findProjectRoot();
    const configPath = join(root, "inkos.json");

    try {
      const raw = await readFile(configPath, "utf-8");
      const config = JSON.parse(raw);
      // Mask API key
      if (config.llm?.apiKey) {
        const key = config.llm.apiKey;
        config.llm.apiKey = key.slice(0, 8) + "..." + key.slice(-4);
      }
      log(JSON.stringify(config, null, 2));
    } catch (e) {
      logError(`Failed to read config: ${e}`);
      process.exit(1);
    }
  });

const KNOWN_AGENTS = ["writer", "auditor", "reviser", "architect", "radar", "chapter-analyzer"] as const;

configCommand
  .command("set-model")
  .description("Set model override for a specific agent")
  .argument("<agent>", `Agent name (${KNOWN_AGENTS.join(", ")})`)
  .argument("<model>", "Model name (e.g., gpt-4o, claude-sonnet-4-20250514)")
  .action(async (agent: string, model: string) => {
    if (!KNOWN_AGENTS.includes(agent as typeof KNOWN_AGENTS[number])) {
      logError(`Unknown agent "${agent}". Valid agents: ${KNOWN_AGENTS.join(", ")}`);
      process.exit(1);
    }

    const root = findProjectRoot();
    const configPath = join(root, "inkos.json");

    try {
      const raw = await readFile(configPath, "utf-8");
      const config = JSON.parse(raw);
      const overrides = config.modelOverrides ?? {};
      config.modelOverrides = { ...overrides, [agent]: model };
      await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
      log(`Model override: ${agent} → ${model}`);
    } catch (e) {
      logError(`Failed to update config: ${e}`);
      process.exit(1);
    }
  });

configCommand
  .command("remove-model")
  .description("Remove model override for a specific agent (falls back to default)")
  .argument("<agent>", "Agent name")
  .action(async (agent: string) => {
    const root = findProjectRoot();
    const configPath = join(root, "inkos.json");

    try {
      const raw = await readFile(configPath, "utf-8");
      const config = JSON.parse(raw);
      const overrides = config.modelOverrides;
      if (!overrides || !(agent in overrides)) {
        log(`No model override for "${agent}".`);
        return;
      }
      const { [agent]: _, ...rest } = overrides;
      config.modelOverrides = Object.keys(rest).length > 0 ? rest : undefined;
      await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
      log(`Removed model override for ${agent}. Will use default model.`);
    } catch (e) {
      logError(`Failed to update config: ${e}`);
      process.exit(1);
    }
  });

configCommand
  .command("show-models")
  .description("Show model routing for all agents")
  .option("--json", "Output JSON")
  .action(async (opts) => {
    const root = findProjectRoot();
    const configPath = join(root, "inkos.json");

    try {
      const raw = await readFile(configPath, "utf-8");
      const config = JSON.parse(raw);
      const defaultModel = config.llm?.model ?? "(not set)";
      const overrides: Record<string, string> = config.modelOverrides ?? {};

      if (opts.json) {
        log(JSON.stringify({ defaultModel, overrides }, null, 2));
        return;
      }

      log(`Default model: ${defaultModel}\n`);
      if (Object.keys(overrides).length === 0) {
        log("No agent-specific overrides. All agents use the default model.");
        return;
      }
      log("Agent overrides:");
      for (const [agent, model] of Object.entries(overrides)) {
        log(`  ${agent} → ${model}`);
      }
      log("");
      const usingDefault = KNOWN_AGENTS.filter((a) => !(a in overrides));
      if (usingDefault.length > 0) {
        log(`Using default: ${usingDefault.join(", ")}`);
      }
    } catch (e) {
      logError(`Failed to read config: ${e}`);
      process.exit(1);
    }
  });
