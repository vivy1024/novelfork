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
import { TOOL_ACCESS_GOVERNANCE_EXPLANATIONS } from "@/shared/tool-access-reasons";
import type { ModelDefaultSettings, RuntimeControlSettings, UserConfig } from "@/types/settings";
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

const MCP_POLICY_OPTIONS: Array<{
  value: RuntimeControlSettings["toolAccess"]["mcpStrategy"];
  label: string;
  description: string;
}> = [
  { value: "inherit", label: "继承默认权限", description: "MCP 工具默认跟随 defaultPermissionMode 判定。" },
  { value: "allow", label: "直接允许", description: "默认允许 MCP 工具执行，仅受 allowlist/blocklist 影响。" },
  { value: "ask", label: "执行前确认", description: "MCP 工具执行前必须确认。" },
  { value: "deny", label: "默认拒绝", description: "默认拒绝 MCP 工具执行。" },
];

const DEFAULT_RUNTIME_CONTROLS = DEFAULT_USER_CONFIG.runtimeControls;
const DEFAULT_MODEL_DEFAULTS = DEFAULT_USER_CONFIG.modelDefaults;

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parsePercentInput(raw: string, fallback: number, min: number, max: number) {
  if (raw.trim() === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clampNumber(parsed, min, max);
}

export function RuntimeControlPanel() {
  const [runtimeControls, setRuntimeControls] = useState<RuntimeControlSettings>(DEFAULT_RUNTIME_CONTROLS);
  const [modelDefaults, setModelDefaults] = useState<ModelDefaultSettings>(DEFAULT_MODEL_DEFAULTS);
  const [modelOptions, setModelOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetchJson<Pick<UserConfig, "runtimeControls" | "modelDefaults">>("/settings/user")
      .then((data) => {
        setRuntimeControls({
          ...DEFAULT_RUNTIME_CONTROLS,
          ...(data.runtimeControls ?? {}),
        });
        setModelDefaults({
          ...DEFAULT_MODEL_DEFAULTS,
          ...(data.modelDefaults ?? {}),
          subagentModelPool: data.modelDefaults?.subagentModelPool ?? DEFAULT_MODEL_DEFAULTS.subagentModelPool,
        });
        setError(null);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    void fetchJson<{ models: Array<{ modelId: string; modelName: string; providerName: string }> }>("/api/providers/models")
      .then((data) => {
        if (cancelled) {
          return;
        }

        setModelOptions(
          data.models.map((model) => ({
            value: model.modelId,
            label: `${model.providerName} · ${model.modelName}`,
          })),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setModelOptions([]);
        }
      });

    return () => {
      cancelled = true;
    };
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

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);

    try {
      const updated = await putApi<UserConfig>("/settings/user", { runtimeControls, modelDefaults });
      setRuntimeControls({
        ...DEFAULT_RUNTIME_CONTROLS,
        ...updated.runtimeControls,
      });
      setModelDefaults({
        ...DEFAULT_MODEL_DEFAULTS,
        ...updated.modelDefaults,
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
              本轮先把会话默认权限、推理强度和上下文压缩阈值纳入 /api/settings 主配置，避免再出现本地并行存储。
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
                      setSaved(false);
                      setModelDefaults((current) => ({
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
                      setSaved(false);
                      setModelDefaults((current) => ({
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
                    setSaved(false);
                    setModelDefaults((current) => ({
                      ...current,
                      subagentModelPool: event.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    }));
                  }}
                />
                <p className="text-xs text-muted-foreground">示例：anthropic:claude-haiku-4-5, openai:gpt-4-turbo</p>
              </CardContent>
            </Card>

            <datalist id="settings-model-options">
              {modelOptions.map((option) => (
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
                      setSaved(false);
                      setRuntimeControls((current) => ({
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
                      setSaved(false);
                      setRuntimeControls((current) => ({
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

            <div className="grid gap-4 xl:grid-cols-3">
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Shield className="size-4 text-primary" />
                    MCP 策略
                  </CardTitle>
                  <CardDescription>{activeMcpPolicy.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Label htmlFor="settings-runtime-mcp-strategy">MCP 策略</Label>
                  <Select
                    value={runtimeControls.toolAccess.mcpStrategy}
                    onValueChange={(value) => {
                      setSaved(false);
                      setRuntimeControls((current) => ({
                        ...current,
                        toolAccess: {
                          ...current.toolAccess,
                          mcpStrategy: value as RuntimeControlSettings["toolAccess"]["mcpStrategy"],
                        },
                      }));
                    }}
                  >
                    <SelectTrigger id="settings-runtime-mcp-strategy" aria-label="MCP 策略" className="w-full">
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
                </CardContent>
              </Card>

              <Card size="sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Shield className="size-4 text-primary" />
                    允许工具列表
                  </CardTitle>
                  <CardDescription>逗号分隔的工具名列表；命中后优先按允许处理。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Label htmlFor="settings-runtime-tool-allowlist">允许工具列表</Label>
                  <Input
                    id="settings-runtime-tool-allowlist"
                    aria-label="允许工具列表"
                    value={runtimeControls.toolAccess.allowlist.join(", ")}
                    onChange={(event) => {
                      setSaved(false);
                      setRuntimeControls((current) => ({
                        ...current,
                        toolAccess: {
                          ...current.toolAccess,
                          allowlist: event.target.value.split(",").map((item) => item.trim()).filter(Boolean),
                        },
                      }));
                    }}
                  />
                </CardContent>
              </Card>

              <Card size="sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Shield className="size-4 text-primary" />
                    阻止工具列表
                  </CardTitle>
                  <CardDescription>逗号分隔的工具名列表；命中后优先按拒绝处理。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Label htmlFor="settings-runtime-tool-blocklist">阻止工具列表</Label>
                  <Input
                    id="settings-runtime-tool-blocklist"
                    aria-label="阻止工具列表"
                    value={runtimeControls.toolAccess.blocklist.join(", ")}
                    onChange={(event) => {
                      setSaved(false);
                      setRuntimeControls((current) => ({
                        ...current,
                        toolAccess: {
                          ...current.toolAccess,
                          blocklist: event.target.value.split(",").map((item) => item.trim()).filter(Boolean),
                        },
                      }));
                    }}
                  />
                </CardContent>
              </Card>
            </div>

            <Card size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Shield className="size-4 text-primary" />
                  治理判定说明
                </CardTitle>
                <CardDescription>把设置项和运行时 reasonKey 对齐，避免只看原始英文原因。</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {TOOL_ACCESS_GOVERNANCE_EXPLANATIONS.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                  <li>Tools Execute / MCP Call 已接入这里的重试、退避、trace、dump 配置。</li>
                </ul>
              </CardContent>
            </Card>

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
                      setSaved(false);
                      setRuntimeControls((current) => ({
                        ...current,
                        contextCompressionThresholdPercent: parsePercentInput(
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
                      setSaved(false);
                      setRuntimeControls((current) => ({
                        ...current,
                        contextTruncateTargetPercent: parsePercentInput(
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
