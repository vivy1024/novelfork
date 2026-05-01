import { EmptyState } from "../../components/feedback";
import type { ProviderApiMode, ProviderCompatibility } from "@/shared/provider-catalog";
import { providerApiModeLabel, providerCompatibilityLabel } from "../../lib/display-labels";
import type { ApiProvider } from "../provider-types";
import { ApiProviderCard } from "./ApiProviderCard";

export interface ProviderFormState {
  readonly name: string;
  readonly prefix: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly apiMode: ProviderApiMode;
  readonly compatibility: ProviderCompatibility;
}

const API_MODES: ProviderApiMode[] = ["completions", "responses", "codex"];

function isFormValid(form: ProviderFormState): boolean {
  return Boolean(form.name.trim() && form.baseUrl.trim() && form.apiKey.trim());
}

export function ApiProvidersSection({
  providers,
  showAddForm,
  form,
  busy,
  setForm,
  onToggleAddForm,
  onSaveProvider,
  onSelectProvider,
  onToggleProvider,
}: {
  readonly providers: readonly ApiProvider[];
  readonly showAddForm: boolean;
  readonly form: ProviderFormState;
  readonly busy: string | null;
  readonly setForm: (form: ProviderFormState) => void;
  readonly onToggleAddForm: () => void;
  readonly onSaveProvider: () => void;
  readonly onSelectProvider: (providerId: string) => void;
  readonly onToggleProvider: (providerId: string, enabled: boolean) => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">密钥接入</h3>
          <p className="text-xs text-muted-foreground">仅管理接口地址、访问密钥、兼容格式和模型列表；不展示平台账号、配额或切号。</p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted"
          onClick={onToggleAddForm}
        >
          + 添加供应商
        </button>
      </div>

      {showAddForm && (
        <AddProviderForm form={form} setForm={setForm} onSave={onSaveProvider} busy={busy === "create-provider"} />
      )}

      {providers.length === 0 ? (
        <EmptyState title="暂无密钥供应商" description="点击“添加供应商”接入 OpenAI 或 Anthropic 兼容接口。" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {providers.map((provider) => (
            <ApiProviderCard
              key={provider.id}
              provider={provider}
              onSelect={onSelectProvider}
              onToggle={onToggleProvider}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function AddProviderForm({
  form,
  setForm,
  onSave,
  busy,
}: {
  readonly form: ProviderFormState;
  readonly setForm: (form: ProviderFormState) => void;
  readonly onSave: () => void;
  readonly busy: boolean;
}) {
  const canSave = isFormValid(form) && !busy;

  return (
    <section className="space-y-3 rounded-lg border border-border bg-background p-4">
      <h3 className="text-base font-semibold">添加 API key 供应商</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">
          供应商名称
          <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </label>
        <label className="text-sm">
          供应商前缀
          <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" value={form.prefix} onChange={(event) => setForm({ ...form, prefix: event.target.value })} />
        </label>
        <label className="text-sm">
          API Key
          <input type="password" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} />
        </label>
        <label className="text-sm">
          Base URL
          <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} />
        </label>
        <label className="text-sm">
          API 模式
          <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" value={form.apiMode} onChange={(event) => setForm({ ...form, apiMode: event.target.value as ProviderApiMode })}>
            {API_MODES.map((value) => <option key={value} value={value}>{providerApiModeLabel(value)}</option>)}
          </select>
        </label>
        <label className="text-sm">
          兼容格式
          <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2" value={form.compatibility} onChange={(event) => setForm({ ...form, compatibility: event.target.value as ProviderCompatibility })}>
            <option value="openai-compatible">{providerCompatibilityLabel("openai-compatible")}</option>
            <option value="anthropic-compatible">{providerCompatibilityLabel("anthropic-compatible")}</option>
          </select>
        </label>
      </div>
      <button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60" type="button" disabled={!canSave} onClick={onSave}>
        保存供应商
      </button>
    </section>
  );
}
