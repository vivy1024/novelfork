import { useEffect, useState } from "react";

import { UnsupportedCapability } from "@/components/runtime/UnsupportedCapability";
import type { PlatformAccount, PlatformId, PlatformImportMethod, PlatformIntegrationCatalogItem, PlatformJsonImportPayload } from "../provider-types";
import { PlatformAccountTable } from "./PlatformAccountTable";

const IMPORT_METHOD_LABELS: Record<PlatformImportMethod, string> = {
  "json-account": "JSON 账号导入",
  "local-auth-json": "本机 auth.json",
  oauth: "OAuth / 浏览器添加",
  "device-code": "设备码添加",
};

export function PlatformIntegrationDetail({
  integration,
  onBack,
  listAccounts,
  importJsonAccount,
  onAccountImported,
}: {
  readonly integration: PlatformIntegrationCatalogItem;
  readonly onBack: () => void;
  readonly listAccounts: (platformId: PlatformId) => Promise<{ accounts: PlatformAccount[] }>;
  readonly importJsonAccount: (platformId: PlatformId, payload: PlatformJsonImportPayload) => Promise<{ account: PlatformAccount }>;
  readonly onAccountImported: (platformId: PlatformId, account: PlatformAccount) => void;
}) {
  const [accounts, setAccounts] = useState<PlatformAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supportsJsonImport = integration.supportedImportMethods.includes("json-account");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    listAccounts(integration.id)
      .then((accountResult) => {
        if (!mounted) return;
        setAccounts(accountResult.accounts);
      })
      .catch((reason) => {
        if (!mounted) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [integration.id, listAccounts]);

  const submitJsonImport = async () => {
    if (!supportsJsonImport || !jsonText.trim()) return;
    setImporting(true);
    setError(null);
    setFeedback(null);
    try {
      const result = await importJsonAccount(integration.id, {
        accountJson: jsonText,
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      });
      setAccounts((current) => [result.account, ...current.filter((account) => account.id !== result.account.id)]);
      onAccountImported(integration.id, result.account);
      setFeedback("JSON 账号已导入，可在账号表格中管理。");
      setJsonText("");
      setDisplayName("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setImporting(false);
    }
  };

  return (
    <section aria-label={`${integration.name} 平台集成详情`} className="space-y-4">
      <button type="button" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" onClick={onBack}>
        ← 返回供应商列表
      </button>
      <div>
        <h2 className="text-lg font-semibold">{integration.name}</h2>
        <p className="text-sm text-muted-foreground">平台账号集成 · {accounts.length} 个账号</p>
      </div>

      {(feedback || error) && (
        <div className={error ? "rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm" : "rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm"}>
          {error ?? feedback}
        </div>
      )}

      <section className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">平台概览</h3>
            <p className="mt-1 text-sm text-muted-foreground">{integration.description}</p>
          </div>
          <span className={integration.enabled ? "rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600" : "rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"}>
            {integration.enabled ? "已启用" : "未启用"}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {integration.supportedImportMethods.length === 0 ? (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">后续接入</span>
          ) : integration.supportedImportMethods.map((method) => (
            <span key={method} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {IMPORT_METHOD_LABELS[method]}
            </span>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-border p-4">
        <div>
          <h3 className="text-base font-semibold">JSON 账号导入</h3>
          <p className="text-xs text-muted-foreground">Codex / Kiro 平台集成通过导入账号 JSON 建立平台账号；导入后账号进入下方表格，后续用于配额刷新、切号和调用链路。</p>
        </div>
        {supportsJsonImport ? (
          <div className="space-y-3">
            <label className="block text-sm">
              账号显示名（可选）
              <input
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={`${integration.name} 主账号`}
              />
            </label>
            <label className="block text-sm">
              JSON 账号数据
              <textarea
                className="mt-1 min-h-32 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs"
                value={jsonText}
                onChange={(event) => setJsonText(event.target.value)}
                placeholder={'{"account_id":"...","email":"...","refresh_token":"..."}'}
              />
            </label>
            <button
              type="button"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              disabled={!jsonText.trim() || importing}
              onClick={() => void submitJsonImport()}
            >
              导入 JSON 账号
            </button>
          </div>
        ) : (
          <UnsupportedCapability
            title={`${integration.name} JSON 导入未接入`}
            reason="该平台当前尚未开放 JSON 账号导入，接口接入前不会展示可提交的导入按钮。"
            status="planned"
            capability={`platform.${integration.id}.json-import`}
          />
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold">账号管理</h3>
            <p className="text-xs text-muted-foreground">平台账号来自真实导入数据；未导入时显示空态，不伪造账号或配额。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground disabled:opacity-60">切换账号（后续接入）</button>
            <button type="button" disabled className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground disabled:opacity-60">刷新配额（后续接入）</button>
            <button type="button" disabled className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground disabled:opacity-60">删除账号（后续接入）</button>
          </div>
        </div>

        <UnsupportedCapability
          title="平台账号操作未接入"
          reason="切换账号、刷新配额和删除账号还没有真实后端 adapter；按钮保持 disabled，避免假成功。"
          status="planned"
          capability="platform.account.actions"
        />

        {loading ? (
          <div className="rounded-lg border border-border p-3 text-sm text-muted-foreground">正在加载平台账号…</div>
        ) : (
          <PlatformAccountTable accounts={accounts} />
        )}
      </section>
    </section>
  );
}
