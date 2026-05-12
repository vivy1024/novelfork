import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { fetchJson, putApi } from "@/hooks/use-api";
import { USER_SETTINGS_API_PATH } from "@/app-next/backend-contract";
import type { CommandBlockRule, RetryRule, RuntimeControlSettings, ToolAccessSettings, UserConfig } from "@/types/settings";
import { Plus, Trash2, X } from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseNum(raw: string, fallback: number, min: number, max: number) {
  if (raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? clamp(n, min, max) : fallback;
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="space-y-3 rounded-lg border border-border p-4">{children}</div>
    </div>
  );
}

function FieldRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <span className="text-sm">{label}</span>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ListSection({ title, description, items, onAdd, onRemove, placeholder }: {
  title: string;
  description: string;
  items: string[];
  onAdd: (value: string) => void;
  onRemove: (index: number) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="space-y-2">
      <div>
        <span className="text-sm">{title}</span>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {items.length > 0 && (
        <div className="space-y-1">
          {items.map((item, i) => (
            <div key={`${item}-${i}`} className="flex items-center gap-2 rounded border border-border px-2 py-1 text-xs font-mono">
              <span className="flex-1 truncate">{item}</span>
              <button type="button" onClick={() => onRemove(i)} className="text-muted-foreground hover:text-destructive">
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          className="flex-1 text-xs"
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              onAdd(draft.trim());
              setDraft("");
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!draft.trim()}
          onClick={() => { onAdd(draft.trim()); setDraft(""); }}
        >
          <Plus className="size-3" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function AgentSettingsPanel() {
  const [config, setConfig] = useState<RuntimeControlSettings | null>(null);
  const savedRef = useRef<RuntimeControlSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<UserConfig>(USER_SETTINGS_API_PATH)
      .then((data) => {
        if (cancelled) return;
        setConfig(data.runtimeControls);
        savedRef.current = data.runtimeControls;
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const isDirty = config && savedRef.current && JSON.stringify(config) !== JSON.stringify(savedRef.current);

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await putApi<UserConfig>(USER_SETTINGS_API_PATH, { runtimeControls: config });
      if (updated?.runtimeControls) {
        setConfig(updated.runtimeControls);
        savedRef.current = updated.runtimeControls;
      } else {
        savedRef.current = { ...config };
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function patch(partial: Partial<RuntimeControlSettings>) {
    setConfig((c) => c ? { ...c, ...partial } : c);
  }

  function patchToolAccess(partial: Partial<ToolAccessSettings>) {
    setConfig((c) => c ? { ...c, toolAccess: { ...c.toolAccess, ...partial } } : c);
  }

  if (loading) return <p className="py-8 text-center text-sm text-muted-foreground">正在读取 Agent 配置…</p>;
  if (!config) return <p className="py-8 text-center text-sm text-destructive">加载失败：{error}</p>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1 text-foreground">AI 代理</h2>
        <p className="text-sm text-muted-foreground">Agent 运行时行为、权限、上下文管理和安全策略。</p>
      </div>

      {/* ── 基础设置 ── */}
      <Section title="基础设置">
        <FieldRow label="默认权限模式">
          <SimpleSelect
            value={config.defaultPermissionMode}
            onValueChange={(v) => patch({ defaultPermissionMode: v as RuntimeControlSettings["defaultPermissionMode"] })}
            options={[
              { value: "allow-all", label: "全部允许" },
              { value: "ask-always", label: "需要审批" },
              { value: "deny-all", label: "只读" },
            ]}
            className="w-32"
            aria-label="默认权限模式"
          />
        </FieldRow>
        <FieldRow label="每条消息最大轮次" description="每条用户消息的 Agent 循环最大轮次数">
          <Input
            type="number"
            className="w-20"
            min={1}
            max={1000}
            value={config.maxTurnSteps}
            onChange={(e) => patch({ maxTurnSteps: parseNum(e.target.value, 200, 1, 1000) })}
          />
        </FieldRow>
        <FieldRow label="旧编码支持" description="自动检测并保留非 UTF-8 文件编码（如 GBK、Shift_JIS）">
          <Switch checked={config.legacyEncoding} onCheckedChange={(v) => patch({ legacyEncoding: v })} />
        </FieldRow>
        <FieldRow label="刷新 Shell 环境" description="每次执行 Bash 工具时通过 login shell 加载最新的环境变量">
          <Switch checked={config.refreshShellEnv} onCheckedChange={(v) => patch({ refreshShellEnv: v })} />
        </FieldRow>
        <FieldRow label="翻译思考内容" description="推理块完成后通过摘要模型翻译为用户语言">
          <Switch checked={config.translateThinking} onCheckedChange={(v) => patch({ translateThinking: v })} />
        </FieldRow>
        <FieldRow label="Dump 每条 API 请求" description="持久化原始请求与响应数据到请求历史">
          <Switch checked={config.dumpApiRequests} onCheckedChange={(v) => patch({ dumpApiRequests: v })} />
        </FieldRow>
        <FieldRow label="仅保留报错请求 dump" description="只有报错请求保存到请求历史，成功请求不落库">
          <Switch checked={config.dumpOnlyErrors} onCheckedChange={(v) => patch({ dumpOnlyErrors: v })} />
        </FieldRow>
        <FieldRow label="默认展开推理内容" description="自动展开消息中的推理/思考块">
          <Switch checked={config.expandReasoning} onCheckedChange={(v) => patch({ expandReasoning: v })} />
        </FieldRow>
      </Section>

      {/* ── 计划与审批 ── */}
      <Section title="计划与审批">
        <FieldRow label="新叙述者默认进入计划模式" description="为新建叙述者默认启用计划模式">
          <Switch checked={config.defaultPlanMode} onCheckedChange={(v) => patch({ defaultPlanMode: v })} />
        </FieldRow>
        <FieldRow label="默认宽松规划" description="规划时工具仍然可用，不会被禁用">
          <Switch checked={config.relaxedPlanning} onCheckedChange={(v) => patch({ relaxedPlanning: v })} />
        </FieldRow>
        <FieldRow label="全局默认自动批准计划" description="ExitPlanMode 计划反思确认后跳过人工审批">
          <Switch checked={config.autoApprovePlan} onCheckedChange={(v) => patch({ autoApprovePlan: v })} />
        </FieldRow>
      </Section>

      {/* ── 安全防护 ── */}
      <Section title="安全防护">
        <FieldRow label="全局默认启用危险反思" description="全部允许模式下对高风险操作进行二次反思确认">
          <Switch checked={config.dangerReflection} onCheckedChange={(v) => patch({ dangerReflection: v })} />
        </FieldRow>
        <FieldRow label="跳过只读危险反思确认" description="已确认只读的操作不再触发额外安全暂停">
          <Switch checked={config.yoloSkipReadonlyConfirmation} onCheckedChange={(v) => patch({ yoloSkipReadonlyConfirmation: v })} />
        </FieldRow>
      </Section>

      {/* ── 重试与超时 ── */}
      <Section title="重试与超时">
        <FieldRow label="可恢复错误最大重试次数" description="遇到临时性 API 错误时的最大重试次数。-1=无限重试">
          <Input
            type="number"
            className="w-20"
            min={-1}
            max={50}
            value={config.recovery.maxRetryAttempts}
            onChange={(e) => patch({ recovery: { ...config.recovery, maxRetryAttempts: parseNum(e.target.value, 5, -1, 50) } })}
          />
        </FieldRow>
        <FieldRow label="沉默工具调用阈值" description="连续多少次无文本输出后要求 AI 说明进度。-1=关闭">
          <Input
            type="number"
            className="w-20"
            min={-1}
            max={200}
            value={config.silentToolCallThreshold}
            onChange={(e) => patch({ silentToolCallThreshold: parseNum(e.target.value, 25, -1, 200) })}
          />
        </FieldRow>
        <FieldRow label="重试退避时间上限（秒）" description="指数退避的最大等待时间">
          <Input
            type="number"
            className="w-20"
            min={1}
            max={120}
            value={Math.round(config.recovery.maxRetryDelayMs / 1000)}
            onChange={(e) => patch({ recovery: { ...config.recovery, maxRetryDelayMs: parseNum(e.target.value, 30, 1, 120) * 1000 } })}
          />
        </FieldRow>
        <FieldRow label="首 token 超时时间（秒）" description="API 请求发起后若在此秒数内没有收到实质事件则中断重试。0=禁用">
          <Input
            type="number"
            className="w-20"
            min={0}
            max={300}
            value={config.firstTokenTimeout}
            onChange={(e) => patch({ firstTokenTimeout: parseNum(e.target.value, 0, 0, 300) })}
          />
        </FieldRow>
      </Section>

      {/* ── 自定义可重试错误规则 ── */}
      <Section title="自定义可重试错误规则" description="将特定 API 错误标记为可重试，匹配的错误将自动重试而非直接失败。">
        {config.retryRules.map((rule, idx) => (
          <div key={rule.id} className="flex items-center gap-2 rounded border border-border px-3 py-2">
            <Switch
              checked={rule.enabled}
              onCheckedChange={(v) => {
                const rules = [...config.retryRules];
                rules[idx] = { ...rule, enabled: v };
                patch({ retryRules: rules });
              }}
              aria-label="启用规则"
            />
            <Input
              type="text"
              className="w-20 text-xs"
              placeholder="状态码"
              value={rule.httpStatus}
              onChange={(e) => {
                const rules = [...config.retryRules];
                rules[idx] = { ...rule, httpStatus: e.target.value };
                patch({ retryRules: rules });
              }}
            />
            <Input
              className="flex-1 text-xs"
              placeholder="内容关键词匹配"
              value={rule.contentKeyword}
              onChange={(e) => {
                const rules = [...config.retryRules];
                rules[idx] = { ...rule, contentKeyword: e.target.value };
                patch({ retryRules: rules });
              }}
            />
            <button
              type="button"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => patch({ retryRules: config.retryRules.filter((_, i) => i !== idx) })}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => patch({ retryRules: [...config.retryRules, { id: `rule-${Date.now().toString(36)}`, enabled: true, httpStatus: "", contentKeyword: "" }] })}
        >
          <Plus className="size-3 mr-1" /> 添加规则
        </Button>
      </Section>

      {/* ── 上下文窗口阈值 ── */}
      <Section title="上下文窗口阈值" description="配置裁剪和压缩的触发时机，按模型上下文窗口大小分两档。">
        <FieldRow label="自动压缩保留轮数" description="压缩后保留的最近 user/assistant 对话轮数">
          <Input
            type="number"
            className="w-20"
            min={1}
            max={20}
            value={config.compressionKeepTurns}
            onChange={(e) => patch({ compressionKeepTurns: parseNum(e.target.value, 4, 1, 20) })}
          />
        </FieldRow>
        <FieldRow label="最大裁剪比例 (%)" description="已裁剪消息比例达到此值时强制启动压缩">
          <Input
            type="number"
            className="w-20"
            min={20}
            max={95}
            value={config.maxTruncateRatio}
            onChange={(e) => patch({ maxTruncateRatio: parseNum(e.target.value, 80, 20, 95) })}
          />
        </FieldRow>
        <Separator />
        <p className="text-xs font-medium text-muted-foreground">标准窗口 (≤600k)</p>
        <FieldRow label="开始裁剪 (%)" description="上下文占用达到此值时开始渐进式裁剪">
          <Input
            type="number"
            className="w-20"
            min={50}
            max={95}
            value={config.contextTruncateTargetPercent}
            onChange={(e) => patch({ contextTruncateTargetPercent: parseNum(e.target.value, 70, 50, 95) })}
          />
        </FieldRow>
        <FieldRow label="开始压缩 (%)" description="上下文占用达到此值时触发压缩">
          <Input
            type="number"
            className="w-20"
            min={50}
            max={95}
            value={config.contextCompressionThresholdPercent}
            onChange={(e) => patch({ contextCompressionThresholdPercent: parseNum(e.target.value, 80, 50, 95) })}
          />
        </FieldRow>
        <Separator />
        <p className="text-xs font-medium text-muted-foreground">大窗口 (&gt;600k)</p>
        <FieldRow label="开始裁剪 (%)" description="大窗口模型的裁剪起始阈值">
          <Input
            type="number"
            className="w-20"
            min={20}
            max={95}
            value={config.largeWindowTruncateTargetPercent}
            onChange={(e) => patch({ largeWindowTruncateTargetPercent: parseNum(e.target.value, 50, 20, 95) })}
          />
        </FieldRow>
        <FieldRow label="开始压缩 (%)" description="大窗口模型的压缩起始阈值">
          <Input
            type="number"
            className="w-20"
            min={30}
            max={95}
            value={config.largeWindowCompressionThresholdPercent}
            onChange={(e) => patch({ largeWindowCompressionThresholdPercent: parseNum(e.target.value, 60, 30, 95) })}
          />
        </FieldRow>
      </Section>

      {/* ── 会话行为 ── */}
      <Section title="会话行为">
        <FieldRow label="会话滚动时自动加载更早消息" description="滚动到顶部时自动加载历史消息">
          <Switch checked={config.scrollAutoLoadHistory} onCheckedChange={(v) => patch({ scrollAutoLoadHistory: v })} />
        </FieldRow>
        <FieldRow label="要求使用用户语言回复" description="指示 AI 使用与界面相同的语言进行回复">
          <Switch checked={config.forceUserLanguage} onCheckedChange={(v) => patch({ forceUserLanguage: v })} />
        </FieldRow>
        <FieldRow label="发送方式" description="聊天输入框中发送消息的方式">
          <SimpleSelect
            value={config.sendMode}
            onValueChange={(v) => patch({ sendMode: v as "enter" | "ctrl-enter" })}
            options={[
              { value: "enter", label: "Enter 发送" },
              { value: "ctrl-enter", label: "Ctrl+Enter 发送" },
            ]}
            className="w-40"
            aria-label="发送方式"
          />
        </FieldRow>
      </Section>

      {/* ── 调试 ── */}
      <Section title="调试">
        <FieldRow label="显示每轮对话的 Token 用量" description="每轮对话结束后显示输入/输出 Token 数量">
          <Switch checked={config.showTokenUsage} onCheckedChange={(v) => patch({ showTokenUsage: v })} />
        </FieldRow>
        <FieldRow label="显示实时 AI 输出速率" description="在标题栏显示实时字符/秒指示器">
          <Switch checked={config.showOutputRate} onCheckedChange={(v) => patch({ showOutputRate: v })} />
        </FieldRow>
      </Section>

      {/* ── 全局白/黑名单 ── */}
      <Section title="全局白/黑名单" description="控制所有会话的目录和命令访问权限。">
        <ListSection
          title="全局白名单目录"
          description="对所有叙述者自动放行的目录"
          items={config.toolAccess.directoryAllowlist}
          onAdd={(v) => patchToolAccess({ directoryAllowlist: [...config.toolAccess.directoryAllowlist, v] })}
          onRemove={(i) => patchToolAccess({ directoryAllowlist: config.toolAccess.directoryAllowlist.filter((_, idx) => idx !== i) })}
          placeholder="输入绝对路径，回车添加"
        />
        <Separator />
        <ListSection
          title="全局黑名单目录"
          description="对所有叙述者禁止访问的目录，优先级高于白名单"
          items={config.toolAccess.directoryBlocklist}
          onAdd={(v) => patchToolAccess({ directoryBlocklist: [...config.toolAccess.directoryBlocklist, v] })}
          onRemove={(i) => patchToolAccess({ directoryBlocklist: config.toolAccess.directoryBlocklist.filter((_, idx) => idx !== i) })}
          placeholder="输入绝对路径，回车添加"
        />
        <Separator />
        <ListSection
          title="全局命令白名单"
          description="所有叙述者自动放行的命令，支持通配符（如 npm*、docker*）"
          items={config.toolAccess.commandAllowlist}
          onAdd={(v) => patchToolAccess({ commandAllowlist: [...config.toolAccess.commandAllowlist, v] })}
          onRemove={(i) => patchToolAccess({ commandAllowlist: config.toolAccess.commandAllowlist.filter((_, idx) => idx !== i) })}
          placeholder="输入命令模式，回车添加"
        />
        <Separator />
        <div className="space-y-2">
          <div>
            <span className="text-sm">全局命令黑名单</span>
            <p className="text-xs text-muted-foreground">所有叙述者自动拒绝的命令，优先于白名单。支持可选的拒绝提示词。</p>
          </div>
          {config.toolAccess.commandBlocklist.map((rule, i) => (
            <div key={`cmd-block-${i}`} className="flex items-center gap-2 rounded border border-border px-2 py-1">
              <Input
                className="flex-1 text-xs"
                placeholder="命令模式"
                value={rule.pattern}
                onChange={(e) => {
                  const list = [...config.toolAccess.commandBlocklist];
                  list[i] = { ...rule, pattern: e.target.value };
                  patchToolAccess({ commandBlocklist: list });
                }}
              />
              <Input
                className="flex-1 text-xs"
                placeholder="拒绝提示词（可选）"
                value={rule.rejectHint ?? ""}
                onChange={(e) => {
                  const list = [...config.toolAccess.commandBlocklist];
                  list[i] = { ...rule, rejectHint: e.target.value || undefined };
                  patchToolAccess({ commandBlocklist: list });
                }}
              />
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => patchToolAccess({ commandBlocklist: config.toolAccess.commandBlocklist.filter((_, idx) => idx !== i) })}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => patchToolAccess({ commandBlocklist: [...config.toolAccess.commandBlocklist, { pattern: "" }] })}
          >
            <Plus className="size-3 mr-1" /> 添加
          </Button>
        </div>
      </Section>

      {/* ── Error ── */}
      {error && <p className="text-sm text-destructive">错误：{error}</p>}

      {/* ── Dirty bar ── */}
      {isDirty && (
        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-background px-4 py-3 -mx-4">
          <Button variant="outline" size="sm" onClick={() => { setConfig(savedRef.current); }}>取消变更</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "保存中..." : "保存变更"}
          </Button>
        </div>
      )}
    </div>
  );
}
