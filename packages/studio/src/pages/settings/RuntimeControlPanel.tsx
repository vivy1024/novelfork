import { useEffect, useMemo, useState } from "react";
import { Activity, Brain, Cpu, Shield, SlidersHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchJson, putApi } from "@/hooks/use-api";
import { PROVIDERS } from "@/shared/provider-catalog";
import type {
  McpPolicyMode,
  ModelDefaultSettings,
  RuntimeControlSettings,
  UserConfig,
} from "@/types/settings";
import { DEFAULT_USER_CONFIG } from "@/types/settings";

const PERMISSION_OPTIONS: Array<{ value: RuntimeControlSettings["defaultPermissionMode"]; label: string; description: string }> = [
  { value: "allow", label: "直接执行", description: "适合本地可逆操作，默认尽量少打断。" },
  { value: "ask", label: "执行前确认", description: "遇到动作前先请求确认，适合稳妥模式。" },
  { value: "deny", label: "默认拒绝", description: "先收窄高风险动作，适合审阅和观察。" },
];

const REASONING_OPTIONS: Array<{ value: RuntimeControlSettings["defaultReasoningEffort"]; label: string; description: string }> = [
  { value: "low", label: "低", description: "适合轻量查询和快速修补。" },
  { value: "medium", label: "中", description: "沿用当前会话默认档位。" },
  { value: "high", label: "高", description: "适合复杂规划和长链分析。" },
];

const MCP_POLICY_OPTIONS: Array<{ value: McpPolicyMode; label: string; description: string }> = [
  { value: "inherit", label: "沿用默认", description: "沿用当前会话或全局策略，不在这里强行覆盖。" },
  { value: "allow", label: "默认放行", description: "MCP 工具在满足注册条件时默认允许进入执行链。" },
  { value: "ask", label: "执行前确认", description: "遇到 MCP 工具调用时先走确认。" },
  { value: "deny", label: "默认拒绝", description: "MCP 工具默认阻断，适合更严格的调试阶段。" },
];

const DEFAULT_RUNTIME_CONTROLS = DEFAULT_USER_CONFIG.runtimeControls;
const DEFAULT_MODEL_DEFAULTS = DEFAULT_USER_CONFIG.modelDefaults;
const MODEL_OPTIONS = PROVIDERS.flatMap((provider) =>
  provider.models.map((model) => ({
    value: `${provider.id}:${model.id}`,
    label: `${provider.name} · ${model.name}`,
  })),
);

function clampNumber(value: number, min: number, max: number, round = true) {
  const normalized = round ? Math.round(value) : value;
  return Math.min(max, Math.max(min, normalized));
}

function parseNumberInput(raw: string, fallback: number, min: number, max: number, round = true) {
  if (raw.trim() === "") {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return clampNumber(parsed, min, max, round);
}

function parseCsvList(raw: string) {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeRuntimeControls(runtimeControls?: Partial<RuntimeControlSettings> | null): RuntimeControlSettings {
  const defaults = DEFAULT_RUNTIME_CONTROLS;
  return {
    defaultPermissionMode:
      runtimeControls?.defaultPermissionMode === "allow"
      || runtimeControls?.defaultPermissionMode === "ask"
      || runtimeControls?.defaultPermissionMode === "deny"
        ? runtimeControls.defaultPermissionMode
        : defaults.defaultPermissionMode,
    defaultReasoningEffort:
      runtimeControls?.defaultReasoningEffort === "low"
      || runtimeControls?.defaultReasoningEffort === "medium"
      || runtimeControls?.defaultReasoningEffort === "high"
        ? runtimeControls.defaultReasoningEffort
        : defaults.defaultReasoningEffort,
    contextCompressionThresholdPercent: parseNumberInput(
      String(runtimeControls?.contextCompressionThresholdPercent ?? ""),
      defaults.contextCompressionThresholdPercent,
      50,
      95,
    ),
    contextTruncateTargetPercent: parseNumberInput(
      String(runtimeControls?.contextTruncateTargetPercent ?? ""),
      defaults.contextTruncateTargetPercent,
      40,
      90,
    ),
    recovery: {
      resumeOnStartup:
        typeof runtimeControls?.recovery?.resumeOnStartup === "boolean"
          ? runtimeControls.recovery.resumeOnStartup
          : defaults.recovery.resumeOnStartup,
      maxRecoveryAttempts: parseNumberInput(
        String(runtimeControls?.recovery?.maxRecoveryAttempts ?? ""),
        defaults.recovery.maxRecoveryAttempts,
        0,
        20,
      ),
      maxRetryAttempts: parseNumberInput(
        String(runtimeControls?.recovery?.maxRetryAttempts ?? ""),
        defaults.recovery.maxRetryAttempts,
        0,
        20,
      ),
      initialRetryDelayMs: parseNumberInput(
        String(runtimeControls?.recovery?.initialRetryDelayMs ?? ""),
        defaults.recovery.initialRetryDelayMs,
        0,
        300000,
      ),
      maxRetryDelayMs: parseNumberInput(
        String(runtimeControls?.recovery?.maxRetryDelayMs ?? ""),
        defaults.recovery.maxRetryDelayMs,
        0,
        600000,
      ),
      backoffMultiplier: parseNumberInput(
        String(runtimeControls?.recovery?.backoffMultiplier ?? ""),
        defaults.recovery.backoffMultiplier,
        1,
        10,
        false,
      ),
      jitterPercent: parseNumberInput(
        String(runtimeControls?.recovery?.jitterPercent ?? ""),
        defaults.recovery.jitterPercent,
        0,
        100,
      ),
    },
    toolAccess: {
      allowlist:
        Array.isArray(runtimeControls?.toolAccess?.allowlist)
          ? runtimeControls.toolAccess.allowlist.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
          : defaults.toolAccess.allowlist,
      blocklist:
        Array.isArray(runtimeControls?.toolAccess?.blocklist)
          ? runtimeControls.toolAccess.blocklist.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
          : defaults.toolAccess.blocklist,
      mcpStrategy:
        runtimeControls?.toolAccess?.mcpStrategy === "inherit"
        || runtimeControls?.toolAccess?.mcpStrategy === "allow"
        || runtimeControls?.toolAccess?.mcpStrategy === "ask"
        || runtimeControls?.toolAccess?.mcpStrategy === "deny"
          ? runtimeControls.toolAccess.mcpStrategy
          : defaults.toolAccess.mcpStrategy,
    },
    runtimeDebug: {
      tokenDebugEnabled:
        typeof runtimeControls?.runtimeDebug?.tokenDebugEnabled === "boolean"
          ? runtimeControls.runtimeDebug.tokenDebugEnabled
          : defaults.runtimeDebug.tokenDebugEnabled,
      rateDebugEnabled:
        typeof runtimeControls?.runtimeDebug?.rateDebugEnabled === "boolean"
          ? runtimeControls.runtimeDebug.rateDebugEnabled
          : defaults.runtimeDebug.rateDebugEnabled,
      dumpEnabled:
        typeof runtimeControls?.runtimeDebug?.dumpEnabled === "boolean"
          ? runtimeControls.runtimeDebug.dumpEnabled
          : defaults.runtimeDebug.dumpEnabled,
      traceEnabled:
        typeof runtimeControls?.runtimeDebug?.traceEnabled === "boolean"
          ? runtimeControls.runtimeDebug.traceEnabled
          : defaults.runtimeDebug.traceEnabled,
      traceSampleRatePercent: parseNumberInput(
        String(runtimeControls?.runtimeDebug?.traceSampleRatePercent ?? ""),
        defaults.runtimeDebug.traceSampleRatePercent,
        0,
        100,
      ),
    },
  };
}

export function RuntimeControlPanel() {
  const [runtimeControls, setRuntimeControls] = useState<RuntimeControlSettings>(DEFAULT_RUNTIME_CONTROLS);
  const [modelDefaults, setModelDefaults] = useState<ModelDefaultSettings>(DEFAULT_MODEL_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchJson<Pick<UserConfig, "runtimeControls" | "modelDefaults">>("/settings/user")
      .then((data) => {
        setRuntimeControls(normalizeRuntimeControls(data.runtimeControls));
        setModelDefaults({
          ...DEFAULT_MODEL_DEFAULTS,
          ...(data.modelDefaults ?? {}),
          subagentModelPool: data.modelDefaults?.subagentModelPool ?? DEFAULT_MODEL_DEFAULTS.subagentModelPool,
        });
        setError(null);
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const activePermission = useMemo(
    () => PERMISSION_OPTIONS.find((option) => option.value === runtimeControls.defaultPermissionMode) ?? PERMISSION_OPTIONS[0],
    [runtimeControls.defaultPermissionMode],
  );
  const activeReasoning = useMemo(
    () => REASONING_OPTIONS.find((option) => option.value === runtimeControls.defaultReasoningEffort) ?? REASONING_OPTIONS[1],
    [runtimeControls.defaultReasoningEffort],
  );
  const activeMcpPolicy = useMemo(
    () => MCP_POLICY_OPTIONS.find((option) => option.value === runtimeControls.toolAccess.mcpStrategy) ?? MCP_POLICY_OPTIONS[0],
    [runtimeControls.toolAccess.mcpStrategy],
  );

  function updateRuntimeControls(updater: (current: RuntimeControlSettings) => RuntimeControlSettings) {
    setSaved(false);
    setRuntimeControls((current) => updater(current));
  }

  function updateModelDefaults(updater: (current: ModelDefaultSettings) => ModelDefaultSettings) {
    setSaved(false);
    setModelDefaults((current) => updater(current));
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);

    try {
      const updated = await putApi<UserConfig>("/settings/user", { runtimeControls, modelDefaults });
      setRuntimeControls(normalizeRuntimeControls(updated.runtimeControls));
      setModelDefaults({
        ...DEFAULT_MODEL_DEFAULTS,
        ...(updated.modelDefaults ?? {}),
        subagentModelPool: updated.modelDefaults?.subagentModelPool ?? DEFAULT_MODEL_DEFAULTS.subagentModelPool,
      });
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-dashed bg-muted/20">
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <SlidersHorizontal className="size-4 text-primary" />
              运行控制面板
            </CardTitle>
            <CardDescription>
              本轮继续把默认模型、恢复 / 重试 / 退避、工具策略和运行调试入口收进 /api/settings/user，先打通第一轮配置流。
            </CardDescription>
          </div>
          <Badge variant="outline">/api/settings/user</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">正在读取运行控制配置...</p>
        ) : (
          <>
            <div className="grid gap-4 xl:grid-cols-2">
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Cpu className="size-4 text-primary" />
                    默认会话模型
                  </CardTitle>
                  <CardDescription>
                    新建正式 session 时默认写入的 provider/model 组合；当前已接入 session 创建链。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Label htmlFor="settings-default-session-model">默认会话模型</Label>
                  <Input
                    id="settings-default-session-model"
                    aria-label="默认会话模型"
                    list="settings-model-options"
                    value={modelDefaults.defaultSessionModel}
                    onChange={(event) => {
                      updateModelDefaults((current) => ({
                        ...current,
                        defaultSessionModel: event.target.value.trim() || current.defaultSessionModel,
                      }));
                    }}
                  />
                </CardContent>
              </Card>

              <Card size="sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Cpu className="size-4 text-primary" />
                    摘要模型
                  </CardTitle>
                  <CardDescription>
                    为摘要/压缩类链路预留的默认模型，本轮先统一进入主配置流。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Label htmlFor="settings-summary-model">摘要模型</Label>
                  <Input
                    id="settings-summary-model"
                    aria-label="摘要模型"
                    list="settings-model-options"
                    value={modelDefaults.summaryModel}
                    onChange={(event) => {
                      updateModelDefaults((current) => ({
                        ...current,
                        summaryModel: event.target.value.trim() || current.summaryModel,
                      }));
                    }}
                  />
                </CardContent>
              </Card>
            </div>

            <Card size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Cpu className="size-4 text-primary" />
                  子代理模型池
                </CardTitle>
                <CardDescription>
                  以逗号分隔的 provider:model 列表，作为子代理调度池的第一轮事实源。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Label htmlFor="settings-subagent-model-pool">子代理模型池</Label>
                <Input
                  id="settings-subagent-model-pool"
                  aria-label="子代理模型池"
                  value={modelDefaults.subagentModelPool.join(", ")}
                  onChange={(event) => {
                    updateModelDefaults((current) => ({
                      ...current,
                      subagentModelPool: parseCsvList(event.target.value),
                    }));
                  }}
                />
                <p className="text-xs text-muted-foreground">示例：anthropic:claude-haiku-4-5, openai:gpt-4-turbo</p>
              </CardContent>
            </Card>

            <datalist id="settings-model-options">
              {MODEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </datalist>

            <div className="grid gap-4 xl:grid-cols-2">
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Shield className="size-4 text-primary" />
                    默认权限模式
                  </CardTitle>
                  <CardDescription>{activePermission.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Label htmlFor="settings-runtime-permission">默认权限模式</Label>
                  <Select
                    value={runtimeControls.defaultPermissionMode}
                    onValueChange={(value) => {
                      updateRuntimeControls((current) => ({
                        ...current,
                        defaultPermissionMode: value as RuntimeControlSettings["defaultPermissionMode"],
                      }));
                    }}
                  >
                    <SelectTrigger id="settings-runtime-permission" aria-label="默认权限模式" className="w-full">
                      <SelectValue placeholder="选择默认权限模式" />
                    </SelectTrigger>
                    <SelectContent>
                      {PERMISSION_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>

              <Card size="sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Brain className="size-4 text-primary" />
                    默认推理强度
                  </CardTitle>
                  <CardDescription>{activeReasoning.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Label htmlFor="settings-runtime-reasoning">默认推理强度</Label>
                  <Select
                    value={runtimeControls.defaultReasoningEffort}
                    onValueChange={(value) => {
                      updateRuntimeControls((current) => ({
                        ...current,
                        defaultReasoningEffort: value as RuntimeControlSettings["defaultReasoningEffort"],
                      }));
                    }}
                  >
                    <SelectTrigger id="settings-runtime-reasoning" aria-label="默认推理强度" className="w-full">
                      <SelectValue placeholder="选择默认推理强度" />
                    </SelectTrigger>
                    <SelectContent>
                      {REASONING_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Activity className="size-4 text-primary" />
                    上下文压缩阈值
                  </CardTitle>
                  <CardDescription>
                    对齐当前 context manager 的 canCompress 口径，达到该比例后进入压缩区间。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Label htmlFor="settings-runtime-compress-threshold">压缩阈值 (%)</Label>
                  <Input
                    id="settings-runtime-compress-threshold"
                    aria-label="压缩阈值 (%)"
                    type="number"
                    min={50}
                    max={95}
                    value={runtimeControls.contextCompressionThresholdPercent}
                    onChange={(event) => {
                      updateRuntimeControls((current) => ({
                        ...current,
                        contextCompressionThresholdPercent: parseNumberInput(
                          event.target.value,
                          current.contextCompressionThresholdPercent,
                          50,
                          95,
                        ),
                      }));
                    }}
                  />
                  <p className="text-xs text-muted-foreground">当前默认值 80%，来源于现有 /api/context/:bookId/usage 压缩判定。</p>
                </CardContent>
              </Card>

              <Card size="sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Activity className="size-4 text-primary" />
                    上下文截断目标
                  </CardTitle>
                  <CardDescription>
                    对齐当前 context manager 的 truncate 默认目标，压缩后优先回落到该比例。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Label htmlFor="settings-runtime-truncate-target">截断目标 (%)</Label>
                  <Input
                    id="settings-runtime-truncate-target"
                    aria-label="截断目标 (%)"
                    type="number"
                    min={40}
                    max={90}
                    value={runtimeControls.contextTruncateTargetPercent}
                    onChange={(event) => {
                      updateRuntimeControls((current) => ({
                        ...current,
                        contextTruncateTargetPercent: parseNumberInput(
                          event.target.value,
                          current.contextTruncateTargetPercent,
                          40,
                          90,
                        ),
                      }));
                    }}
                  />
                  <p className="text-xs text-muted-foreground">当前默认值 70%，来源于现有 /api/context/:bookId/truncate 目标比例。</p>
                </CardContent>
              </Card>
            </div>

            <Card size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Activity className="size-4 text-primary" />
                  恢复 / 重试 / 退避
                </CardTitle>
                <CardDescription>
                  第一轮先把恢复开关、重试上限和退避参数纳入主配置，后续再接到具体运行器。
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <label className="flex items-center gap-2 rounded-md border border-border/60 bg-background/60 px-3 py-2 text-sm">
                  <input
                    id="settings-runtime-resume-on-startup"
                    aria-label="启动时自动恢复"
                    type="checkbox"
                    checked={runtimeControls.recovery.resumeOnStartup}
                    onChange={(event) => {
                      updateRuntimeControls((current) => ({
                        ...current,
                        recovery: {
                          ...current.recovery,
                          resumeOnStartup: event.target.checked,
                        },
                      }));
                    }}
                    className="size-4"
                  />
                  启动时自动恢复
                </label>

                <div className="space-y-2">
                  <Label htmlFor="settings-runtime-max-recovery-attempts">最大恢复次数</Label>
                  <Input
                    id="settings-runtime-max-recovery-attempts"
                    aria-label="最大恢复次数"
                    type="number"
                    min={0}
                    max={20}
                    value={runtimeControls.recovery.maxRecoveryAttempts}
                    onChange={(event) => {
                      updateRuntimeControls((current) => ({
                        ...current,
                        recovery: {
                          ...current.recovery,
                          maxRecoveryAttempts: parseNumberInput(
                            event.target.value,
                            current.recovery.maxRecoveryAttempts,
                            0,
                            20,
                          ),
                        },
                      }));
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="settings-runtime-max-retry-attempts">最大重试次数</Label>
                  <Input
                    id="settings-runtime-max-retry-attempts"
                    aria-label="最大重试次数"
                    type="number"
                    min={0}
                    max={20}
                    value={runtimeControls.recovery.maxRetryAttempts}
                    onChange={(event) => {
                      updateRuntimeControls((current) => ({
                        ...current,
                        recovery: {
                          ...current.recovery,
                          maxRetryAttempts: parseNumberInput(
                            event.target.value,
                            current.recovery.maxRetryAttempts,
                            0,
                            20,
                          ),
                        },
                      }));
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="settings-runtime-initial-retry-delay">初始退避 (ms)</Label>
                  <Input
                    id="settings-runtime-initial-retry-delay"
                    aria-label="初始退避 (ms)"
                    type="number"
                    min={0}
                    max={300000}
                    value={runtimeControls.recovery.initialRetryDelayMs}
                    onChange={(event) => {
                      updateRuntimeControls((current) => ({
                        ...current,
                        recovery: {
                          ...current.recovery,
                          initialRetryDelayMs: parseNumberInput(
                            event.target.value,
                            current.recovery.initialRetryDelayMs,
                            0,
                            300000,
                          ),
                        },
                      }));
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="settings-runtime-max-retry-delay">最大退避 (ms)</Label>
                  <Input
                    id="settings-runtime-max-retry-delay"
                    aria-label="最大退避 (ms)"
                    type="number"
                    min={0}
                    max={600000}
                    value={runtimeControls.recovery.maxRetryDelayMs}
                    onChange={(event) => {
                      updateRuntimeControls((current) => ({
                        ...current,
                        recovery: {
                          ...current.recovery,
                          maxRetryDelayMs: parseNumberInput(
                            event.target.value,
                            current.recovery.maxRetryDelayMs,
                            0,
                            600000,
                          ),
                        },
                      }));
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="settings-runtime-backoff-multiplier">退避倍率</Label>
                  <Input
                    id="settings-runtime-backoff-multiplier"
                    aria-label="退避倍率"
                    type="number"
                    min={1}
                    max={10}
                    step={0.1}
                    value={runtimeControls.recovery.backoffMultiplier}
                    onChange={(event) => {
                      updateRuntimeControls((current) => ({
                        ...current,
                        recovery: {
                          ...current.recovery,
                          backoffMultiplier: parseNumberInput(
                            event.target.value,
                            current.recovery.backoffMultiplier,
                            1,
                            10,
                            false,
                          ),
                        },
                      }));
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="settings-runtime-jitter-percent">抖动 (%)</Label>
                  <Input
                    id="settings-runtime-jitter-percent"
                    aria-label="抖动 (%)"
                    type="number"
                    min={0}
                    max={100}
                    value={runtimeControls.recovery.jitterPercent}
                    onChange={(event) => {
                      updateRuntimeControls((current) => ({
                        ...current,
                        recovery: {
                          ...current.recovery,
                          jitterPercent: parseNumberInput(
                            event.target.value,
                            current.recovery.jitterPercent,
                            0,
                            100,
                          ),
                        },
                      }));
                    }}
                  />
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 xl:grid-cols-2">
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Shield className="size-4 text-primary" />
                    工具白名单 / 黑名单 / MCP 策略
                  </CardTitle>
                  <CardDescription>{activeMcpPolicy.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="settings-tool-allowlist">工具白名单</Label>
                    <Input
                      id="settings-tool-allowlist"
                      aria-label="工具白名单"
                      value={runtimeControls.toolAccess.allowlist.join(", ")}
                      onChange={(event) => {
                        updateRuntimeControls((current) => ({
                          ...current,
                          toolAccess: {
                            ...current.toolAccess,
                            allowlist: parseCsvList(event.target.value),
                          },
                        }));
                      }}
                    />
                    <p className="text-xs text-muted-foreground">逗号分隔，例如：Read, Write, Bash</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="settings-tool-blocklist">工具黑名单</Label>
                    <Input
                      id="settings-tool-blocklist"
                      aria-label="工具黑名单"
                      value={runtimeControls.toolAccess.blocklist.join(", ")}
                      onChange={(event) => {
                        updateRuntimeControls((current) => ({
                          ...current,
                          toolAccess: {
                            ...current.toolAccess,
                            blocklist: parseCsvList(event.target.value),
                          },
                        }));
                      }}
                    />
                    <p className="text-xs text-muted-foreground">可用于先挡住高风险工具，再逐步放开。</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="settings-mcp-strategy">MCP 策略</Label>
                    <Select
                      value={runtimeControls.toolAccess.mcpStrategy}
                      onValueChange={(value) => {
                        updateRuntimeControls((current) => ({
                          ...current,
                          toolAccess: {
                            ...current.toolAccess,
                            mcpStrategy: value as McpPolicyMode,
                          },
                        }));
                      }}
                    >
                      <SelectTrigger id="settings-mcp-strategy" aria-label="MCP 策略" className="w-full">
                        <SelectValue placeholder="选择 MCP 策略" />
                      </SelectTrigger>
                      <SelectContent>
                        {MCP_POLICY_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              <Card size="sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <SlidersHorizontal className="size-4 text-primary" />
                    运行调试项
                  </CardTitle>
                  <CardDescription>
                    token、速率、dump、trace 先做第一轮配置入口，后续再接具体日志与埋点管线。
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="flex items-center gap-2 rounded-md border border-border/60 bg-background/60 px-3 py-2 text-sm">
                      <input
                        id="settings-debug-token"
                        aria-label="Token 调试"
                        type="checkbox"
                        checked={runtimeControls.runtimeDebug.tokenDebugEnabled}
                        onChange={(event) => {
                          updateRuntimeControls((current) => ({
                            ...current,
                            runtimeDebug: {
                              ...current.runtimeDebug,
                              tokenDebugEnabled: event.target.checked,
                            },
                          }));
                        }}
                        className="size-4"
                      />
                      Token 调试
                    </label>

                    <label className="flex items-center gap-2 rounded-md border border-border/60 bg-background/60 px-3 py-2 text-sm">
                      <input
                        id="settings-debug-rate"
                        aria-label="速率调试"
                        type="checkbox"
                        checked={runtimeControls.runtimeDebug.rateDebugEnabled}
                        onChange={(event) => {
                          updateRuntimeControls((current) => ({
                            ...current,
                            runtimeDebug: {
                              ...current.runtimeDebug,
                              rateDebugEnabled: event.target.checked,
                            },
                          }));
                        }}
                        className="size-4"
                      />
                      速率调试
                    </label>

                    <label className="flex items-center gap-2 rounded-md border border-border/60 bg-background/60 px-3 py-2 text-sm">
                      <input
                        id="settings-debug-dump"
                        aria-label="Dump 调试"
                        type="checkbox"
                        checked={runtimeControls.runtimeDebug.dumpEnabled}
                        onChange={(event) => {
                          updateRuntimeControls((current) => ({
                            ...current,
                            runtimeDebug: {
                              ...current.runtimeDebug,
                              dumpEnabled: event.target.checked,
                            },
                          }));
                        }}
                        className="size-4"
                      />
                      Dump 调试
                    </label>

                    <label className="flex items-center gap-2 rounded-md border border-border/60 bg-background/60 px-3 py-2 text-sm">
                      <input
                        id="settings-debug-trace"
                        aria-label="Trace 调试"
                        type="checkbox"
                        checked={runtimeControls.runtimeDebug.traceEnabled}
                        onChange={(event) => {
                          updateRuntimeControls((current) => ({
                            ...current,
                            runtimeDebug: {
                              ...current.runtimeDebug,
                              traceEnabled: event.target.checked,
                            },
                          }));
                        }}
                        className="size-4"
                      />
                      Trace 调试
                    </label>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="settings-debug-trace-sample-rate">Trace 采样 (%)</Label>
                    <Input
                      id="settings-debug-trace-sample-rate"
                      aria-label="Trace 采样 (%)"
                      type="number"
                      min={0}
                      max={100}
                      value={runtimeControls.runtimeDebug.traceSampleRatePercent}
                      onChange={(event) => {
                        updateRuntimeControls((current) => ({
                          ...current,
                          runtimeDebug: {
                            ...current.runtimeDebug,
                            traceSampleRatePercent: parseNumberInput(
                              event.target.value,
                              current.runtimeDebug.traceSampleRatePercent,
                              0,
                              100,
                            ),
                          },
                        }));
                      }}
                    />
                    <p className="text-xs text-muted-foreground">用于先控制 trace 输出强度，避免调试日志一次铺得过满。</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="flex flex-col gap-3 border-t pt-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <p>当前通过 /api/settings/user 统一持久化；导入/导出会自动带上这组运行控制字段。</p>
                {error ? <p className="text-destructive">保存失败：{error}</p> : saved ? <p className="text-primary">运行控制已保存。</p> : null}
              </div>
              <Button type="button" onClick={handleSave} disabled={loading || saving}>
                {saving ? "保存中..." : "保存运行控制"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
