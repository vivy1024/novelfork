import { useEffect, useRef, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { fetchJson } from "@/hooks/use-api";
import { useWorkbenchMode } from "@/hooks/use-workbench-mode";

import { WorkbenchIntroEmptyState } from "./WorkbenchIntroEmptyState";

interface WorkbenchModeGateProps {
  children: ReactNode;
}

export function WorkbenchModeGate({ children }: WorkbenchModeGateProps) {
  const { enabled, loading, saving, setEnabled } = useWorkbenchMode();
  const markedIntroRef = useRef(false);

  useEffect(() => {
    if (loading || enabled || markedIntroRef.current) return;
    markedIntroRef.current = true;
    void fetchJson("/onboarding/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tasks: { hasReadWorkbenchIntro: true },
      }),
    }).catch(() => undefined);
  }, [enabled, loading]);

  if (loading) {
    return <div className="py-8 text-center text-sm text-muted-foreground">正在读取工作台模式…</div>;
  }

  if (!enabled) {
    return <WorkbenchIntroEmptyState onEnable={() => setEnabled(true)} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button type="button" variant="outline" onClick={() => void setEnabled(false)} disabled={saving}>
          切回作者模式
        </Button>
      </div>
      {children}
    </div>
  );
}
