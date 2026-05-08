/**
 * Provider Validation — real API health check for configured providers.
 *
 * 对标：
 * - Claude Code CLI: provider 验证通过 API 调用确认可用性
 * - Codex CLI: 启动时验证 API key 和模型可用性
 */

export interface ProviderModel {
  readonly id: string;
  readonly name: string;
}

export interface FetchModelsResult {
  readonly ok: boolean;
  readonly models?: readonly ProviderModel[];
  readonly error?: string;
}

export interface ProviderValidationInput {
  readonly providerId: string;
  readonly apiKey?: string;
  readonly baseUrl: string;
  readonly fetchModels: (input: { baseUrl: string; apiKey?: string }) => Promise<FetchModelsResult>;
  readonly timeoutMs?: number;
}

export interface ProviderValidationResult {
  readonly ok: boolean;
  readonly providerId: string;
  readonly models?: readonly ProviderModel[];
  readonly error?: string;
  readonly latencyMs: number;
}

export async function validateProviderConnection(input: ProviderValidationInput): Promise<ProviderValidationResult> {
  const { providerId, apiKey, baseUrl, fetchModels, timeoutMs = 10000 } = input;
  const startTime = Date.now();

  try {
    const result = await Promise.race([
      fetchModels({ baseUrl, apiKey }),
      new Promise<FetchModelsResult>((_, reject) =>
        setTimeout(() => reject(new Error("Provider validation timeout")), timeoutMs),
      ),
    ]);

    const latencyMs = Date.now() - startTime;

    if (!result.ok) {
      return { ok: false, providerId, error: result.error ?? "Unknown error", latencyMs };
    }

    return { ok: true, providerId, models: result.models ?? [], latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    return {
      ok: false,
      providerId,
      error: error instanceof Error ? error.message : String(error),
      latencyMs,
    };
  }
}
