import { useMemo, useState } from "react";

import { putApi, useApi } from "./use-api";
import type { UserConfig } from "@/types/settings";

export function useWorkbenchMode() {
  const { data, loading, error, refetch } = useApi<Pick<UserConfig, "preferences">>("/settings/user");
  const [saving, setSaving] = useState(false);

  const enabled = useMemo(() => Boolean(data?.preferences?.workbenchMode), [data?.preferences?.workbenchMode]);

  const setEnabled = async (nextEnabled: boolean) => {
    setSaving(true);
    try {
      await putApi("/settings/user", {
        preferences: {
          workbenchMode: nextEnabled,
        },
      });
      await refetch();
    } finally {
      setSaving(false);
    }
  };

  return {
    enabled,
    loading,
    saving,
    error,
    setEnabled,
    refetch,
  };
}
