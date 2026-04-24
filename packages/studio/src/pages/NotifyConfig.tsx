import { useEffect, useState, type ReactNode } from "react";
import { Globe, MessageSquare, Pencil, Plus, Power, RefreshCw, Send, Trash2, Webhook, X } from "lucide-react";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { useApi, putApi } from "../hooks/use-api";
import { notify } from "@/lib/notify";
import { useColors } from "../hooks/use-colors";
import type { TFunction } from "../hooks/use-i18n";
import type { Theme } from "../hooks/use-theme";

// 通知渠道类型定义
type ChannelType = "telegram" | "feishu" | "wechat-work" | "webhook";

interface NotifyChannel {
  readonly type: ChannelType;
  readonly enabled: boolean;
  readonly config: Record<string, string>;
}

interface NotifyData {
  readonly channels: NotifyChannel[];
}

interface ChannelField {
  readonly key: string;
  readonly label: string;
  readonly placeholder: string;
  readonly required: boolean;
  readonly options?: string[];
}

// 渠道元信息
const CHANNEL_META: Record<ChannelType, { label: string; icon: typeof Send; fields: ChannelField[] }> = {
  telegram: {
    label: "Telegram",
    icon: Send,
    fields: [
      { key: "botToken", label: "Bot Token", placeholder: "123456:ABC-DEF...", required: true },
      { key: "chatId", label: "Chat ID", placeholder: "-1001234567890", required: true },
    ],
  },
  feishu: {
    label: "飞书",
    icon: MessageSquare,
    fields: [
      { key: "webhookUrl", label: "Webhook URL", placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/...", required: true },
      { key: "secret", label: "签名密钥", placeholder: "可选，用于签名校验", required: false },
    ],
  },
  "wechat-work": {
    label: "企业微信",
    icon: MessageSquare,
    fields: [
      { key: "webhookUrl", label: "Webhook URL", placeholder: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...", required: true },
    ],
  },
  webhook: {
    label: "Webhook",
    icon: Webhook,
    fields: [
      { key: "url", label: "URL", placeholder: "https://your-server.com/notify", required: true },
      { key: "secret", label: "HMAC Secret", placeholder: "用于签名验证", required: false },
      { key: "method", label: "Method", placeholder: "POST", required: false, options: ["GET", "POST"] },
    ],
  },
};

const CHANNEL_TYPES: ChannelType[] = ["telegram", "feishu", "wechat-work", "webhook"];

interface Nav {
  toWorkflow?: () => void;
}

function channelIcon(type: ChannelType, size = 14) {
  const Icon = CHANNEL_META[type]?.icon ?? Globe;
  return <Icon size={size} />;
}

// 创建空渠道配置
function emptyChannel(type: ChannelType): NotifyChannel {
  const config: Record<string, string> = {};
  for (const f of CHANNEL_META[type].fields) {
    config[f.key] = f.key === "method" ? "POST" : "";
  }
  return { type, enabled: true, config };
}

export function NotifyConfig({ nav, theme }: { nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data, loading, error, refetch } = useApi<NotifyData>("/project/notify");
  const [channels, setChannels] = useState<NotifyChannel[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // 编辑状态：null=列表, "pick"=选择渠道类型, "add"=填写新渠道表单, number=编辑已有渠道
  const [editMode, setEditMode] = useState<null | "pick" | "add" | number>(null);
  const [form, setForm] = useState<NotifyChannel>(emptyChannel("telegram"));

  useEffect(() => {
    if (!data) return;
    setChannels(data.channels.map((ch) => ({ ...ch, config: { ...ch.config } })));
    setDirty(false);
  }, [data]);

  if (loading) return <div className="py-20 text-center text-sm text-muted-foreground">加载中...</div>;
  if (error) return <div className="py-20 text-center text-destructive">错误: {error}</div>;

  // 选择类型后进入表单填写
  const startAdd = (type: ChannelType) => {
    setForm(emptyChannel(type));
    setEditMode("add");
  };

  // 开始编辑已有渠道
  const startEdit = (idx: number) => {
    const ch = channels[idx];
    if (!ch) return;
    setForm({ ...ch, config: { ...ch.config } });
    setEditMode(idx);
  };

  // 保存表单到本地列表
  const confirmForm = () => {
    setChannels((current) => {
      if (editMode === "add") {
        return [...current, form];
      }
      if (typeof editMode === "number") {
        return current.map((ch, i) => (i === editMode ? form : ch));
      }
      return current;
    });
    setEditMode(null);
    setDirty(true);
  };

  // 删除渠道
  const removeChannel = (idx: number) => {
    setChannels((current) => current.filter((_, i) => i !== idx));
    setDirty(true);
  };

  // 切换启用/禁用
  const toggleEnabled = (idx: number) => {
    setChannels((current) => current.map((ch, i) => (i === idx ? { ...ch, enabled: !ch.enabled } : ch)));
    setDirty(true);
  };

  // 保存到服务器
  const handleSave = async () => {
    setSaving(true);
    try {
      await putApi("/project/notify", { channels });
      setDirty(false);
      refetch();
    } catch (e) {
      notify.error("保存失败", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  const isEditing = editMode !== null;
  const canSave = !isEditing && dirty;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="通知配置"
        description="把 Telegram、飞书、企业微信和 Webhook 收口到同一个工作流配置台，统一管理联动通知。"
        actions={
          <>
            {nav.toWorkflow && (
              <button onClick={() => nav.toWorkflow?.()} className="rounded-md border border-border/70 bg-background/70 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted/70">
                工作流总览
              </button>
            )}
            <button onClick={() => void refetch()} className={`rounded-md px-3 py-2 text-xs font-medium ${c.btnSecondary} flex items-center gap-1`}>
              <RefreshCw size={12} />刷新
            </button>
            {!isEditing && (
              <button onClick={() => setEditMode("pick")} className={`rounded-md px-3 py-2 text-xs font-medium ${c.btnPrimary} flex items-center gap-1`}>
                <Plus size={12} />添加渠道
              </button>
            )}
            {canSave && (
              <button onClick={handleSave} disabled={saving} className={`rounded-md px-3 py-2 text-xs font-medium ${c.btnPrimary} disabled:opacity-50`}>
                {saving ? "保存中..." : "保存配置"}
              </button>
            )}
          </>
        }
      />

      {/* 添加渠道：选择类型 */}
      {editMode === "pick" && (
        <ChannelTypeSelector types={CHANNEL_TYPES} onSelect={startAdd} onCancel={() => setEditMode(null)} c={c} />
      )}

      {/* 新增渠道表单 */}
      {editMode === "add" && <ChannelForm form={form} setForm={setForm} onConfirm={confirmForm} onCancel={() => setEditMode(null)} c={c} />}

      {/* 编辑已有渠道表单 */}
      {typeof editMode === "number" && <ChannelForm form={form} setForm={setForm} onConfirm={confirmForm} onCancel={() => setEditMode(null)} c={c} />}

      {!isEditing && channels.length === 0 && (
        <PageEmptyState
          title="暂无通知渠道"
          description="先添加一个渠道，后续章节完成、审计告警或异常重试都能直接推送。"
          action={
            <button onClick={() => setEditMode("pick")} className={`rounded-md px-3 py-2 text-sm font-medium ${c.btnPrimary}`}>
              添加渠道
            </button>
          }
        />
      )}

      {!isEditing && channels.length > 0 && (
        <div className="space-y-4">
          {channels.map((ch, i) => (
            <ChannelCard key={`${ch.type}-${i}`} channel={ch} onToggle={() => toggleEnabled(i)} onEdit={() => startEdit(i)} onDelete={() => removeChannel(i)} c={c} />
          ))}
        </div>
      )}

      {isEditing && channels.length === 0 && <div className="text-center text-sm text-muted-foreground">正在编辑首个通知渠道...</div>}
    </div>
  );
}

function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card/80 p-5 shadow-sm backdrop-blur-sm lg:flex-row lg:items-start lg:justify-between">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">Workflow Workbench</p>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// 渠道类型选择器（新增时先选类型，再填表单）
function ChannelTypeSelector({ types, onSelect, onCancel, c }: {
  types: ChannelType[];
  onSelect: (t: ChannelType) => void;
  onCancel: () => void;
  c: ReturnType<typeof useColors>;
}) {
  return (
    <div className={`space-y-3 rounded-lg border p-4 ${c.cardStatic}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">选择渠道类型</span>
        <button onClick={onCancel} className="rounded p-1 hover:bg-muted/60">
          <X size={14} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {types.map((type) => {
          const meta = CHANNEL_META[type];
          return (
            <button key={type} onClick={() => onSelect(type)} className={`flex items-center gap-2 rounded-md px-3 py-2.5 text-sm ${c.btnSecondary}`}>
              {channelIcon(type)} {meta.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// 渠道配置表单
function ChannelForm({ form, setForm, onConfirm, onCancel, c }: {
  form: NotifyChannel;
  setForm: (f: NotifyChannel) => void;
  onConfirm: () => void;
  onCancel: () => void;
  c: ReturnType<typeof useColors>;
}) {
  const meta = CHANNEL_META[form.type];
  const updateConfig = (key: string, value: string) => {
    setForm({ ...form, config: { ...form.config, [key]: value } });
  };

  // 校验必填字段
  const valid = meta.fields
    .filter((f) => f.required)
    .every((f) => (form.config[f.key] ?? "").trim() !== "");

  return (
    <div className={`space-y-0 divide-y divide-border/40 rounded-lg border ${c.cardStatic}`}>
      <div className="flex items-center justify-between px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-medium">
          {channelIcon(form.type)} {meta.label}
        </span>
        <button onClick={onCancel} className="rounded p-1 hover:bg-muted/60">
          <X size={14} />
        </button>
      </div>
      {meta.fields.map((field) => (
        <div key={field.key} className="flex items-center justify-between px-4 py-2.5">
          <span className="text-sm text-muted-foreground">
            {field.label}
            {field.required && <span className="ml-0.5 text-destructive">*</span>}
          </span>
          {field.options ? (
            <select
              value={form.config[field.key] ?? field.options[0]}
              onChange={(e) => updateConfig(field.key, e.target.value)}
              className={`${c.input} w-56 rounded px-2 py-1 text-sm`}
            >
              {field.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={form.config[field.key] ?? ""}
              onChange={(e) => updateConfig(field.key, e.target.value)}
              placeholder={field.placeholder}
              className={`${c.input} w-56 rounded px-2 py-1 text-sm`}
            />
          )}
        </div>
      ))}
      <div className="flex justify-end gap-2 px-4 py-3">
        <button onClick={onCancel} className={`rounded-md px-4 py-2 text-sm ${c.btnSecondary}`}>
          取消
        </button>
        <button onClick={onConfirm} disabled={!valid} className={`rounded-md px-4 py-2 text-sm ${c.btnPrimary} disabled:opacity-50`}>
          确认
        </button>
      </div>
    </div>
  );
}

// 渠道卡片
function ChannelCard({ channel, onToggle, onEdit, onDelete, c }: {
  channel: NotifyChannel;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  c: ReturnType<typeof useColors>;
}) {
  const meta = CHANNEL_META[channel.type];
  return (
    <div className={`rounded-lg border ${channel.enabled ? "border-primary/50 ring-1 ring-primary/20" : "border-border"} ${c.cardStatic}`}>
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          {channelIcon(channel.type)}
          <span className={`text-sm font-medium ${channel.enabled ? "text-primary" : "text-muted-foreground"}`}>
            {meta.label}
          </span>
          <span className={`rounded px-1.5 py-0.5 text-xs ${channel.enabled ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
            {channel.enabled ? "已启用" : "已禁用"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onToggle} title={channel.enabled ? "禁用" : "启用"} className={`rounded-md p-1.5 text-xs ${c.btnSecondary}`}>
            <Power size={12} />
          </button>
          <button onClick={onEdit} title="编辑" className={`rounded-md p-1.5 text-xs ${c.btnSecondary}`}>
            <Pencil size={12} />
          </button>
          <button onClick={onDelete} title="删除" className="rounded-md p-1.5 text-xs text-red-500 hover:bg-red-500/10">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border/40 px-4 py-2 text-xs text-muted-foreground">
        {meta.fields.map((f) => {
          const val = channel.config[f.key];
          if (!val) return null;
          // 敏感字段脱敏显示
          const masked = f.key.toLowerCase().includes("token") || f.key.toLowerCase().includes("secret")
            ? `${val.slice(0, 4)}••••`
            : val;
          return (
            <div key={f.key}>
              {f.label}: <span className="font-mono text-foreground">{masked}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
