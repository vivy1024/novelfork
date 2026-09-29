import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { WorkbenchDialogs } from "./ide/use-workbench-dialogs";

/** 复用工作台确认弹窗；过期的确认不能操作另一书籍、视图或已卸载的工作台。 */
export function useWorkbenchLeaveGuard(scope: string, confirm: WorkbenchDialogs["confirm"]) {
  const lifetime = useMemo(() => ({ active: false }), [scope]);
  const latest = useRef(lifetime);
  latest.current = lifetime;
  const pending = useRef(false);

  useLayoutEffect(() => {
    lifetime.active = true;
    return () => { lifetime.active = false; };
  }, [lifetime]);

  return useCallback(async (titles: readonly string[], leave: () => void) => {
    if (pending.current || !lifetime.active || latest.current !== lifetime) return;
    if (titles.length > 0) {
      pending.current = true;
      try {
        const confirmed = await confirm({
          title: `「${titles.join("」「")}」有未保存的修改`,
          description: "离开后未保存的修改将丢失。取消后可继续编辑或等待保存完成。",
          confirmLabel: "放弃修改并离开",
          destructive: true,
        });
        if (!confirmed) return;
      } finally {
        pending.current = false;
      }
    }
    if (lifetime.active && latest.current === lifetime) leave();
  }, [confirm, lifetime]);
}
