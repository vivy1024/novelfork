import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SimpleSelect } from "@/components/ui/simple-select";
import { EmptyState } from "../../components/feedback";
import type { ProviderApiMode, ProviderCompatibility } from "@/shared/provider-catalog";
import { providerApiModeLabel, providerCompatibilityLabel } from "../../lib/display-labels";
import type { ApiProvider } from "../provider-types";
import { ApiProviderCard } from "./ApiProviderCard";

export interface ApiProviderStatusSummary {
  readonly status: "callable" | "degraded" | "error";
  readonly catalogEnabled: boolean;
  readonly configured: boolean;
  readonly verified: boolean;
  readonly reasons: readonly string[];
  readonly callableModelCount: number;
}

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
  return Boolean(form.name.trim());
}

export function ApiProvidersSection({
  providers,
  providerStatuses,
  fixtureProviderIds,
  showAddForm,
  form,
  busy,
  setForm,
  onToggleAddForm,
  onSaveProvider,
  onSelectProvider,
  onToggleProvider,
  onDeleteProvider,
}: {
  readonly providers: readonly ApiProvider[];
  readonly providerStatuses?: Readonly<Record<string, ApiProviderStatusSummary>>;
  readonly fixtureProviderIds?: ReadonlySet<string>;
  readonly showAddForm: boolean;
  readonly form: ProviderFormState;
  readonly busy: string | null;
  readonly setForm: (form: ProviderFormState) => void;
  readonly onToggleAddForm: () => void;
  readonly onSaveProvider: () => void;
  readonly onSelectProvider: (providerId: string) => void;
  readonly onToggleProvider: (providerId: string, enabled: boolean) => void;
  readonly onDeleteProvider?: (providerId: string) => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">密钥接入</h3>
          <p className="text-xs text-muted-foreground">仅管理接口地址、访问密钥、兼容格式和模型列表；不展示平台账号、配额或切号。</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onToggleAddForm}
        >
          + 添加供应商
        </Button>
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
              status={providerStatuses?.[provider.id]}
              isTestFixture={fixtureProviderIds?.has(provider.id) ?? false}
              onSelect={onSelectProvider}
              onToggle={onToggleProvider}
              onDelete={onDeleteProvider}
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
      <p className="text-xs text-muted-foreground">创建后在详情页配置 API Key 和 Base URL</p>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">
          供应商名称 *
          <Input className="mt-1 w-full" placeholder="如：Sub2API" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </label>
        <label className="text-sm">
          供应商前缀
          <Input className="mt-1 w-full" placeholder="如：sub2api" value={form.prefix} onChange={(event) => setForm({ ...form, prefix: event.target.value })} />
        </label>
        <label className="text-sm">
          兼容格式
          <SimpleSelect
            className="mt-1"
            value={form.compatibility}
            onValueChange={(v) => setForm({ ...form, compatibility: v as ProviderCompatibility })}
            options={[
              { value: "openai-compatible", label: providerCompatibilityLabel("openai-compatible") },
              { value: "anthropic-compatible", label: providerCompatibilityLabel("anthropic-compatible") },
            ]}
          />
        </label>
      </div>
      <Button variant="default" disabled={!canSave} onClick={onSave}>
        创建并配置
      </Button>
    </section>
  );
}
