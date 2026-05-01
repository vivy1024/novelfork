import React, { useEffect, useMemo, useState } from "react";

import { fetchJson } from "@/hooks/use-api";
import {
  findRuntimeModelByRef,
  runtimeModelLabel,
  runtimeModelRef,
  splitRuntimeModelRef,
  usableRuntimeModels,
  type RuntimeModelOption,
} from "@/lib/runtime-model-options";

interface ModelPickerProps {
  value?: { providerId: string; modelId: string };
  onChange: (providerId: string, modelId: string) => void;
  theme: "light" | "dark";
}

const MODEL_SOURCE_LABELS: Record<string, string> = {
  detected: "自动发现",
  manual: "手动配置",
  imported: "配置导入",
};

const MODEL_TEST_STATUS_LABELS: Record<string, string> = {
  success: "连接成功",
  failed: "连接失败",
  error: "连接异常",
  pending: "待测试",
  untested: "未测试",
};

function modelSourceLabel(source: string | undefined): string {
  return source ? MODEL_SOURCE_LABELS[source] ?? "运行时模型池" : "运行时模型池";
}

function modelTestStatusLabel(status: string | undefined): string {
  return status ? MODEL_TEST_STATUS_LABELS[status] ?? "待确认" : "未测试";
}

export const ModelPicker = React.memo(function ModelPicker({
  value,
  onChange,
  theme,
}: ModelPickerProps) {
  const [runtimeModels, setRuntimeModels] = useState<RuntimeModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    void fetchJson<{ models?: RuntimeModelOption[] }>("/api/providers/models")
      .then((response) => {
        if (!cancelled) {
          setRuntimeModels(usableRuntimeModels(response.models));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setRuntimeModels([]);
          setLoadError(error instanceof Error ? error.message : "模型池加载失败");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedModelRef = value ? runtimeModelRef(value.providerId, value.modelId) : "";
  const selectedRuntimeModel = selectedModelRef ? findRuntimeModelByRef(runtimeModels, selectedModelRef) : undefined;
  const activeModelRef = selectedRuntimeModel
    ? splitRuntimeModelRef(selectedRuntimeModel).modelRef
    : runtimeModels[0]
      ? splitRuntimeModelRef(runtimeModels[0]).modelRef
      : "";
  const currentModel = selectedRuntimeModel ?? runtimeModels[0];
  const cardClassName = useMemo(
    () => theme === "dark"
      ? "rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-slate-100"
      : "rounded-lg border border-slate-200 bg-white p-3 text-slate-900",
    [theme],
  );

  const handleModelChange = (modelRef: string) => {
    const model = findRuntimeModelByRef(runtimeModels, modelRef);
    if (!model) return;

    const selection = splitRuntimeModelRef(model);
    if (!selection.providerId || !selection.modelId) return;
    onChange(selection.providerId, selection.modelId);
  };

  const hasModels = runtimeModels.length > 0;
  const selectedModelMissing = !!selectedModelRef && !selectedRuntimeModel && hasModels;

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-2 block text-sm font-medium text-foreground" htmlFor="runtime-model-picker">
          运行时模型
        </label>
        <select
          id="runtime-model-picker"
          aria-label="运行时模型"
          value={activeModelRef}
          disabled={loading || !hasModels}
          onChange={(event) => handleModelChange(event.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
        >
          {!hasModels ? <option value="">无可用模型</option> : null}
          {runtimeModels.map((model) => {
            const selection = splitRuntimeModelRef(model);
            return (
              <option key={selection.modelRef} value={selection.modelRef}>
                {runtimeModelLabel(model)}
              </option>
            );
          })}
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">正在读取统一模型池…</p>
      ) : loadError ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {loadError}
        </p>
      ) : hasModels ? (
        <div className={cardClassName}>
          <div className="text-sm font-medium">{currentModel ? runtimeModelLabel(currentModel) : "模型信息不可用"}</div>
          {currentModel ? (
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <span>上下文：{((currentModel.contextWindow ?? 0) / 1000).toFixed(0)}K</span>
              <span>最大输出：{((currentModel.maxOutputTokens ?? 0) / 1000).toFixed(0)}K</span>
              <span>来源：{modelSourceLabel(currentModel.source)}</span>
              <span>测试：{modelTestStatusLabel(currentModel.lastTestStatus)}</span>
            </div>
          ) : null}
          {selectedModelMissing ? (
            <p className="mt-2 text-xs text-amber-600">当前模型不可用，请重新选择。</p>
          ) : null}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
          尚未配置可用模型
        </div>
      )}
    </div>
  );
});
