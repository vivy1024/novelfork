import { useCallback, useMemo, useState } from "react";

import { requireModelForAiAction, type AiAction, type ProviderRuntimeStatus } from "@/api/lib/ai-gate";
import type { AiGateResult } from "@/api/lib/ai-gate";

import { useApi } from "./use-api";

export function useAiModelGate() {
  const { data: providerStatusData } = useApi<{ status: ProviderRuntimeStatus }>("/providers/status");
  const [blockedResult, setBlockedResult] = useState<Extract<AiGateResult, { ok: false }> | null>(null);

  const providerStatus = useMemo<ProviderRuntimeStatus>(
    () => providerStatusData?.status ?? { hasUsableModel: false },
    [providerStatusData],
  );

  const ensureModelFor = useCallback((action: AiAction) => {
    const result = requireModelForAiAction(action, providerStatus);
    if (!result.ok) {
      setBlockedResult(result);
      return false;
    }
    return true;
  }, [providerStatus]);

  const closeGate = useCallback(() => {
    setBlockedResult(null);
  }, []);

  return {
    ensureModelFor,
    blockedResult,
    closeGate,
  };
}
