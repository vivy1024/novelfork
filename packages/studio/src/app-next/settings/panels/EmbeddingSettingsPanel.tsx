import { useEffect, useMemo, useState } from "react";
import { PlugZap } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { notify } from "@/lib/notify";
import {
  createEmbeddingSettingsClient,
  DEFAULT_EMBEDDING_BASE_URL,
  DEFAULT_EMBEDDING_DIM,
  DEFAULT_EMBEDDING_MODEL,
  type EmbeddingSettingsClient,
  type PublicEmbeddingSettings,
} from "../../runtime-admin/embedding-settings";
import { SettingsGroup, SettingsPage, SettingsSaveBar } from "../components/SettingsPage";

const defaultClient = createEmbeddingSettingsClient();

export interface EmbeddingSettingsPanelProps {
  readonly client?: EmbeddingSettingsClient;
}

interface EmbeddingDraft {
  baseUrl: string;
  model: string;
  dim: string;
  apiKey: string;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function draftFromSettings(settings: PublicEmbeddingSettings): EmbeddingDraft {
  return {
    baseUrl: settings.baseUrl || DEFAULT_EMBEDDING_BASE_URL,
    model: settings.model || DEFAULT_EMBEDDING_MODEL,
    dim: String(settings.dim || DEFAULT_EMBEDDING_DIM),
    apiKey: settings.apiKeyMasked,
  };
}

function parseDim(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function EmbeddingSettingsPanel({ client = defaultClient }: EmbeddingSettingsPanelProps) {
  const [draft, setDraft] = useState<EmbeddingDraft | null>(null);
  const [saved, setSaved] = useState<EmbeddingDraft | null>(null);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    client.get()
      .then((settings) => {
        if (!active) return;
        const next = draftFromSettings(settings);
        setDraft(next);
        setSaved(next);
        setConfigured(settings.configured);
      })
      .catch((reason) => {
        if (active) setError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [client]);

  const dirty = useMemo(
    () => Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved)),
    [draft, saved],
  );

  async function handleSave(): Promise<boolean> {
    if (!draft) return false;
    const dim = parseDim(draft.dim);
    if (!dim) {
      setError("向量维度必须是正整数。");
      return false;
    }
    const baseUrl = draft.baseUrl.trim();
    const model = draft.model.trim();
    if (!baseUrl) {
      setError("接口地址不能为空。");
      return false;
    }
    if (!model) {
      setError("模型名不能为空。");
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await client.save({
        baseUrl,
        model,
        dim,
        apiKey: draft.apiKey,
      });
      const next = draftFromSettings(updated);
      setDraft(next);
      setSaved(next);
      setConfigured(updated.configured);
      notify.success("向量模型已保存", {
        description: updated.configured
          ? "已写入 NovelFork 设置，当前进程立即生效，无需重启。"
          : "已保存接口地址和模型；还需要填写 API Key 才能写向量。",
      });
      return true;
    } catch (reason) {
      const message = errorMessage(reason);
      setError(message);
      notify.error("向量模型保存失败", { description: message });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setError(null);
    try {
      if (dirty) {
        const savedOk = await handleSave();
        if (!savedOk) return;
      }
      const result = await client.test();
      if (!result.ok) {
        const message = result.error || "连通测试失败。";
        setError(message);
        notify.error("向量模型连通失败", { description: message });
        return;
      }
      notify.success("向量模型连通成功", {
        description: `${result.model} · ${result.dim} 维`,
      });
    } catch (reason) {
      const message = errorMessage(reason);
      setError(message);
      notify.error("向量模型连通失败", { description: message });
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return <p className="py-8 text-center text-sm text-muted-foreground">正在读取向量模型设置…</p>;
  }
  if (!draft) {
    return (
      <Alert>
        <AlertTitle>向量模型设置加载失败</AlertTitle>
        <AlertDescription>{error || "未能读取独立向量配置。"}</AlertDescription>
      </Alert>
    );
  }

  return (
    <SettingsPage
      title="Embedding 提供商"
      description="独立配置向量模型（默认硅基流动 bge-m3），不占用上面的对话模型供应商。"
      actions={
        <Button type="button" variant="outline" onClick={() => void handleTest()} disabled={testing || saving}>
          <PlugZap data-icon="inline-start" />
          {testing ? "测试中…" : "测试连通"}
        </Button>
      }
    >
      {error ? (
        <Alert>
          <AlertTitle>向量模型操作失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <SettingsGroup
        title="硅基流动 bge-m3"
        description={configured
          ? "当前已配置 API Key，语义增益可以写入实体向量。"
          : "还没有 API Key：关系图只能用共现，bellGain 不会被语义调制。"}
      >
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="embedding-base-url">接口地址</FieldLabel>
            <Input
              id="embedding-base-url"
              aria-label="接口地址"
              value={draft.baseUrl}
              onChange={(event) => setDraft({ ...draft, baseUrl: event.currentTarget.value })}
              placeholder={DEFAULT_EMBEDDING_BASE_URL}
            />
            <FieldDescription>OpenAI 兼容 embeddings 端点，默认硅基流动。</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="embedding-model">模型</FieldLabel>
            <Input
              id="embedding-model"
              aria-label="向量模型"
              value={draft.model}
              onChange={(event) => setDraft({ ...draft, model: event.currentTarget.value })}
              placeholder={DEFAULT_EMBEDDING_MODEL}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="embedding-dim">维度</FieldLabel>
            <Input
              id="embedding-dim"
              aria-label="向量维度"
              type="number"
              min={1}
              value={draft.dim}
              onChange={(event) => setDraft({ ...draft, dim: event.currentTarget.value })}
            />
            <FieldDescription>bge-m3 为 1024 维。</FieldDescription>
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="embedding-api-key">API Key</FieldLabel>
            <Input
              id="embedding-api-key"
              aria-label="向量模型 API Key"
              type="password"
              autoComplete="off"
              value={draft.apiKey}
              onChange={(event) => setDraft({ ...draft, apiKey: event.currentTarget.value })}
              placeholder="sk-…"
            />
            <FieldDescription>写入 NovelFork 本机设置库，不进仓库，也不进上面的对话模型供应商。</FieldDescription>
          </Field>
        </FieldGroup>
      </SettingsGroup>

      <SettingsSaveBar
        dirty={dirty}
        saving={saving}
        saveLabel="保存向量模型"
        onDiscard={() => {
          if (saved) setDraft(saved);
          setError(null);
        }}
        onSave={() => void handleSave()}
      />
    </SettingsPage>
  );
}
