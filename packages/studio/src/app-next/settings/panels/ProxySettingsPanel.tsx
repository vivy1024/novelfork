import { useState, useEffect } from "react";
import { fetchJson, putApi } from "../../../hooks/use-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Save, CheckCircle, AlertCircle } from "lucide-react";
import type { ProxySettings } from "../../../types/settings";

interface ProxyCard {
  id: string;
  label: string;
  description: string;
  value: string;
  type: "platform" | "provider" | "tool";
}

export function ProxySettingsPanel() {
  const [proxy, setProxy] = useState<ProxySettings>({ providers: {}, webFetch: "", platforms: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<{ proxy: ProxySettings }>("/settings/user")
      .then((data) => {
        if (data.proxy) setProxy(data.proxy);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function saveField(field: string, value: string) {
    setSaving(field);
    try {
      if (field === "webFetch") {
        await putApi("/settings/user", { proxy: { webFetch: value } });
      } else if (field.startsWith("platform:")) {
        const key = field.replace("platform:", "");
        await putApi("/settings/user", { proxy: { platforms: { ...proxy.platforms, [key]: value } } });
      } else if (field.startsWith("provider:")) {
        const key = field.replace("provider:", "");
        await putApi("/settings/user", { proxy: { providers: { ...proxy.providers, [key]: value } } });
      }
      setSaved(field);
      setTimeout(() => setSaved(null), 2000);
    } catch { /* ignore */ }
    finally { setSaving(null); }
  }

  if (loading) return <p className="py-8 text-center text-sm text-muted-foreground">加载代理配置...</p>;

  const cards: ProxyCard[] = [
    { id: "platform:ai", label: "AI 供应商", description: "用于所有 AI API 请求的代理", value: proxy.platforms?.ai ?? "", type: "platform" },
    { id: "webFetch", label: "WebFetch", description: "用于网页抓取和 HTTP 请求的代理", value: proxy.webFetch ?? "", type: "tool" },
  ];

  // 动态添加已配置的供应商代理
  for (const [providerId, proxyUrl] of Object.entries(proxy.providers ?? {})) {
    cards.push({
      id: `provider:${providerId}`,
      label: providerId,
      description: `供应商 ${providerId} 的独立代理`,
      value: proxyUrl,
      type: "provider",
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1 text-foreground">代理管理</h2>
        <p className="text-sm text-muted-foreground">集中管理所有供应商和服务的网络代理配置。</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {cards.map((card) => (
          <ProxyCardItem
            key={card.id}
            card={card}
            saving={saving === card.id}
            saved={saved === card.id}
            onChange={(value) => {
              if (card.id === "webFetch") {
                setProxy((p) => ({ ...p, webFetch: value }));
              } else if (card.id.startsWith("platform:")) {
                const key = card.id.replace("platform:", "");
                setProxy((p) => ({ ...p, platforms: { ...p.platforms, [key]: value } }));
              } else if (card.id.startsWith("provider:")) {
                const key = card.id.replace("provider:", "");
                setProxy((p) => ({ ...p, providers: { ...p.providers, [key]: value } }));
              }
            }}
            onSave={(value) => saveField(card.id, value)}
          />
        ))}
      </div>

      {/* 添加供应商代理 */}
      <AddProviderProxy
        existingIds={Object.keys(proxy.providers ?? {})}
        onAdd={(providerId, url) => {
          setProxy((p) => ({ ...p, providers: { ...p.providers, [providerId]: url } }));
          void saveField(`provider:${providerId}`, url);
        }}
      />
    </div>
  );
}

function ProxyCardItem({ card, saving, saved, onChange, onSave }: {
  card: ProxyCard;
  saving: boolean;
  saved: boolean;
  onChange: (value: string) => void;
  onSave: (value: string) => void;
}) {
  const isValidUrl = !card.value.trim() || /^(https?|socks5?):\/\/.+/.test(card.value.trim());
  const statusBadge = card.value.trim()
    ? <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600"><CheckCircle className="size-2.5" />已配置</span>
    : <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"><AlertCircle className="size-2.5" />未配置</span>;

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold">{card.label}</h4>
          <p className="text-xs text-muted-foreground">{card.description}</p>
        </div>
        {statusBadge}
      </div>
      <div className="flex gap-2">
        <Input
          placeholder="http://127.0.0.1:7890"
          value={card.value}
          onChange={(e) => onChange(e.target.value)}
          className={`flex-1 text-xs font-mono ${!isValidUrl ? "border-destructive" : ""}`}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => onSave(card.value)}
          disabled={saving || (!isValidUrl && card.value.trim() !== "")}
          className="gap-1"
        >
          <Save className="size-3" />
          {saving ? "..." : saved ? "已保存" : "保存"}
        </Button>
      </div>
      {!isValidUrl && <p className="text-[10px] text-destructive">格式无效，需以 http://、https:// 或 socks5:// 开头</p>}
    </div>
  );
}

function AddProviderProxy({ existingIds, onAdd }: { existingIds: string[]; onAdd: (id: string, url: string) => void }) {
  const [providerId, setProviderId] = useState("");
  const [url, setUrl] = useState("");

  const handleAdd = () => {
    if (!providerId.trim() || existingIds.includes(providerId.trim())) return;
    onAdd(providerId.trim(), url.trim());
    setProviderId("");
    setUrl("");
  };

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <h4 className="text-sm font-semibold">添加供应商代理</h4>
      <p className="text-xs text-muted-foreground">为特定供应商配置独立的代理地址。</p>
      <div className="flex gap-2">
        <Input
          placeholder="供应商 ID"
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
          className="w-32 text-xs"
        />
        <Input
          placeholder="代理地址 (http://...)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 text-xs font-mono"
        />
        <Button variant="outline" size="sm" onClick={handleAdd} disabled={!providerId.trim()}>
          添加
        </Button>
      </div>
    </div>
  );
}
