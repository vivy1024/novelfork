import { readFile, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ProjectConfigSchema, type ProjectConfig } from "../models/project.js";

export const GLOBAL_CONFIG_DIR = join(homedir(), ".novelfork");
export const GLOBAL_ENV_PATH = join(GLOBAL_CONFIG_DIR, ".env");
const LEGACY_GLOBAL_CONFIG_DIR = join(homedir(), ".inkos");
const LEGACY_GLOBAL_ENV_PATH = join(LEGACY_GLOBAL_CONFIG_DIR, ".env");

function getEnvValue(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

export function isApiKeyOptionalForEndpoint(params: {
  readonly provider?: string | undefined;
  readonly baseUrl?: string | undefined;
}): boolean {
  if (params.provider === "anthropic") {
    return false;
  }
  if (!params.baseUrl) {
    return false;
  }

  try {
    const url = new URL(params.baseUrl);
    const hostname = url.hostname.toLowerCase();

    return (
      hostname === "localhost"
      || hostname === "127.0.0.1"
      || hostname === "::1"
      || hostname === "0.0.0.0"
      || hostname === "host.docker.internal"
      || hostname.endsWith(".local")
      || isPrivateIpv4(hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Load project config from novelfork.json with .env overrides.
 * NovelFork env vars are preferred; legacy InkOS env vars are accepted as fallback.
 */
export async function loadProjectConfig(
  root: string,
  options?: { readonly requireApiKey?: boolean },
): Promise<ProjectConfig> {
  const { config: loadEnv } = await import("dotenv");

  // Priority: ~/.novelfork/.env > legacy ~/.inkos/.env (fallback only) > project .env overrides
  loadEnv({ path: GLOBAL_ENV_PATH });
  loadEnv({ path: LEGACY_GLOBAL_ENV_PATH });
  loadEnv({ path: join(root, ".env"), override: true });

  const configPath = join(root, "novelfork.json");

  try {
    await access(configPath);
  } catch {
    throw new Error(
      `novelfork.json not found in ${root}.\nMake sure you are inside a NovelFork project directory (cd into the project created by 'novelfork init').`,
    );
  }

  const raw = await readFile(configPath, "utf-8");

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(raw);
  } catch {
    throw new Error(`novelfork.json in ${root} is not valid JSON. Check the file for syntax errors.`);
  }

  // .env overrides novelfork.json for LLM settings — only non-empty values override
  const env = process.env;
  const llm = (config.llm ?? {}) as Record<string, unknown>;

  const provider = getEnvValue("NOVELFORK_LLM_PROVIDER", "INKOS_LLM_PROVIDER");
  const baseUrl = getEnvValue("NOVELFORK_LLM_BASE_URL", "INKOS_LLM_BASE_URL");
  const model = getEnvValue("NOVELFORK_LLM_MODEL", "INKOS_LLM_MODEL");
  const temperature = getEnvValue("NOVELFORK_LLM_TEMPERATURE", "INKOS_LLM_TEMPERATURE");
  const maxTokens = getEnvValue("NOVELFORK_LLM_MAX_TOKENS", "INKOS_LLM_MAX_TOKENS");
  const thinkingBudget = getEnvValue("NOVELFORK_LLM_THINKING_BUDGET", "INKOS_LLM_THINKING_BUDGET");
  const apiFormat = getEnvValue("NOVELFORK_LLM_API_FORMAT", "INKOS_LLM_API_FORMAT");
  const defaultLanguage = getEnvValue("NOVELFORK_DEFAULT_LANGUAGE", "INKOS_DEFAULT_LANGUAGE");

  if (provider) llm.provider = provider;
  if (baseUrl) llm.baseUrl = baseUrl;
  if (model) llm.model = model;
  if (temperature) llm.temperature = parseFloat(temperature);
  if (maxTokens) llm.maxTokens = parseInt(maxTokens, 10);
  if (thinkingBudget) llm.thinkingBudget = parseInt(thinkingBudget, 10);

  const extraFromEnv: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(env)) {
    const prefix = key.startsWith("NOVELFORK_LLM_EXTRA_")
      ? "NOVELFORK_LLM_EXTRA_"
      : key.startsWith("INKOS_LLM_EXTRA_")
        ? "INKOS_LLM_EXTRA_"
        : undefined;
    if (!prefix || !value) continue;
    const paramName = key.slice(prefix.length);
    if (/^\d+(\.\d+)?$/.test(value)) extraFromEnv[paramName] = parseFloat(value);
    else if (value === "true") extraFromEnv[paramName] = true;
    else if (value === "false") extraFromEnv[paramName] = false;
    else if (value.startsWith("{") || value.startsWith("[")) {
      try { extraFromEnv[paramName] = JSON.parse(value); } catch { extraFromEnv[paramName] = value; }
    } else {
      extraFromEnv[paramName] = value;
    }
  }
  if (Object.keys(extraFromEnv).length > 0) {
    llm.extra = { ...(llm.extra as Record<string, unknown> ?? {}), ...extraFromEnv };
  }

  if (apiFormat) llm.apiFormat = apiFormat;
  config.llm = llm;

  if (defaultLanguage) config.language = defaultLanguage;

  // API key ONLY from env — never stored in novelfork.json
  const apiKeyRaw = getEnvValue("NOVELFORK_LLM_API_KEY", "INKOS_LLM_API_KEY");
  const apiKey = apiKeyRaw && apiKeyRaw.trim().length > 0 ? apiKeyRaw.trim() : undefined;
  const resolvedProvider = typeof llm.provider === "string" ? llm.provider : undefined;
  const resolvedBaseUrl = typeof llm.baseUrl === "string" ? llm.baseUrl : undefined;
  const apiKeyOptional = isApiKeyOptionalForEndpoint({ provider: resolvedProvider, baseUrl: resolvedBaseUrl });

  if (!apiKey && options?.requireApiKey !== false && !apiKeyOptional) {
    throw new Error(
      "NOVELFORK_LLM_API_KEY not set. Run 'novelfork config set-global' or add it to project .env file.",
    );
  }
  if (options?.requireApiKey === false) {
    llm.provider = typeof llm.provider === "string" && llm.provider.length > 0
      ? llm.provider
      : "openai";
    llm.baseUrl = typeof llm.baseUrl === "string" && llm.baseUrl.length > 0
      ? llm.baseUrl
      : "https://example.invalid/v1";
    llm.model = typeof llm.model === "string" && llm.model.length > 0
      ? llm.model
      : "noop-model";
  }
  llm.apiKey = apiKey ?? "";

  return ProjectConfigSchema.parse(config);
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((segment) => Number.parseInt(segment, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }

  if (parts[0] === 10) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
}
