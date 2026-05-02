import { useEffect, useState } from "react";

import type { Routines as RoutinesConfig } from "../../types/routines";
import { DEFAULT_ROUTINES } from "../../types/routines";
import {
  fetchRoutines,
  resetRoutines,
  saveRoutines,
  type EditableRoutinesScope,
  type RoutinesScope,
} from "./routines-api";

export const ROUTINES_SCOPE_META: Record<RoutinesScope, { label: string; description: string }> = {
  merged: {
    label: "生效视图",
    description: "默认读取 merged 视图；项目配置覆盖全局配置，只读展示当前实际生效结果。",
  },
  global: {
    label: "全局",
    description: "编辑 ~/.novelfork/routines.json，作为所有项目的默认基线。",
  },
  project: {
    label: "项目",
    description: "编辑 <workspace>/.novelfork/routines.json，只影响当前工作区。",
  },
};

export function cloneDefaultRoutines(): RoutinesConfig {
  return {
    commands: [...DEFAULT_ROUTINES.commands],
    tools: [...DEFAULT_ROUTINES.tools],
    permissions: [...DEFAULT_ROUTINES.permissions],
    globalSkills: [...DEFAULT_ROUTINES.globalSkills],
    projectSkills: [...DEFAULT_ROUTINES.projectSkills],
    subAgents: [...DEFAULT_ROUTINES.subAgents],
    globalPrompts: [...DEFAULT_ROUTINES.globalPrompts],
    systemPrompts: [...DEFAULT_ROUTINES.systemPrompts],
    mcpTools: [...DEFAULT_ROUTINES.mcpTools],
    hooks: [...DEFAULT_ROUTINES.hooks],
  };
}

export function useRoutinesEditor({
  projectRoot,
  defaultScope,
}: {
  projectRoot?: string;
  defaultScope?: RoutinesScope;
}) {
  const hasProjectScope = Boolean(projectRoot);
  const [viewScope, setViewScope] = useState<RoutinesScope>(defaultScope ?? (hasProjectScope ? "merged" : "global"));
  const [routines, setRoutines] = useState<RoutinesConfig>(cloneDefaultRoutines());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasProjectScope && viewScope !== "global") {
      setViewScope("global");
    }
  }, [hasProjectScope, viewScope]);

  useEffect(() => {
    let cancelled = false;

    async function loadCurrentScope() {
      setLoading(true);
      setError(null);
      setSaved(false);
      try {
        const next = await fetchRoutines(viewScope, projectRoot);
        if (!cancelled) {
          setRoutines(next);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "加载 routines 配置失败");
          setRoutines(cloneDefaultRoutines());
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadCurrentScope();

    return () => {
      cancelled = true;
    };
  }, [projectRoot, viewScope]);

  useEffect(() => {
    if (!saved) {
      return;
    }

    const timer = window.setTimeout(() => setSaved(false), 2000);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const isReadOnly = viewScope === "merged";
  const scopeMeta = ROUTINES_SCOPE_META[viewScope];

  const handleSave = async () => {
    if (isReadOnly) {
      return;
    }

    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await saveRoutines(viewScope as EditableRoutinesScope, routines, projectRoot);
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存 routines 配置失败");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (isReadOnly) {
      return;
    }

    if (!window.confirm("确定将当前 routines 作用域重置为默认值？")) {
      return;
    }

    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const next = await resetRoutines(viewScope as EditableRoutinesScope, projectRoot);
      setRoutines(next);
      setSaved(true);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "重置 routines 配置失败");
    } finally {
      setSaving(false);
    }
  };

  return {
    error,
    handleReset,
    handleSave,
    hasProjectScope,
    isReadOnly,
    loading,
    routines,
    saved,
    saving,
    scopeMeta,
    setRoutines,
    setViewScope,
    viewScope,
  };
}
