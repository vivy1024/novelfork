import { EmptyState } from "../../components/feedback";
import { platformAccountAuthModeLabel, platformAccountStatusLabel } from "../../lib/display-labels";
import type { PlatformAccount } from "../provider-types";

const STATUS_CLASS_NAMES: Record<PlatformAccount["status"], string> = {
  active: "bg-emerald-500/10 text-emerald-600",
  disabled: "bg-muted text-muted-foreground",
  expired: "bg-amber-500/10 text-amber-600",
  error: "bg-destructive/10 text-destructive",
};

function formatDateTime(value?: string): string {
  if (!value) return "从未";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatQuota(account: PlatformAccount): string {
  const quota = account.quota;
  if (!quota) return "--";
  const parts: string[] = [];
  if (quota.hourlyPercentage !== undefined) parts.push(`5 小时 ${quota.hourlyPercentage}%`);
  if (quota.weeklyPercentage !== undefined) parts.push(`每周 ${quota.weeklyPercentage}%`);
  return parts.length ? parts.join(" · ") : "--";
}

export function PlatformAccountTable({
  accounts,
  busyAccountId,
  onRefreshQuota,
  onSetCurrent,
  onToggleStatus,
  onDelete,
}: {
  readonly accounts: readonly PlatformAccount[];
  readonly busyAccountId?: string | null;
  readonly onRefreshQuota: (account: PlatformAccount) => void;
  readonly onSetCurrent: (account: PlatformAccount) => void;
  readonly onToggleStatus: (account: PlatformAccount) => void;
  readonly onDelete: (account: PlatformAccount) => void;
}) {
  if (accounts.length === 0) {
    return <EmptyState title="暂无平台账号" description="导入 JSON 账号数据后会在这里显示真实账号。" />;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">当前</th>
            <th className="px-3 py-2 text-left font-medium">名称 / email</th>
            <th className="px-3 py-2 text-left font-medium">账号 ID</th>
            <th className="px-3 py-2 text-left font-medium">认证方式</th>
            <th className="px-3 py-2 text-left font-medium">套餐</th>
            <th className="px-3 py-2 text-left font-medium">状态</th>
            <th className="px-3 py-2 text-left font-medium">优先级</th>
            <th className="px-3 py-2 text-left font-medium">成功 / 失败</th>
            <th className="px-3 py-2 text-left font-medium">配额</th>
            <th className="px-3 py-2 text-left font-medium">最后使用</th>
            <th className="px-3 py-2 text-left font-medium">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {accounts.map((account) => {
            const busy = busyAccountId === account.id;
            return (
              <tr key={account.id}>
                <td className="px-3 py-2 text-muted-foreground">{account.current ? "当前" : "--"}</td>
                <td className="px-3 py-2">
                  <div className="font-medium">{account.displayName}</div>
                  {account.email && <div className="text-xs text-muted-foreground">{account.email}</div>}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{account.accountId ?? "--"}</td>
                <td className="px-3 py-2 text-muted-foreground">{platformAccountAuthModeLabel(account.authMode)}</td>
                <td className="px-3 py-2 text-muted-foreground">{account.planType ?? "--"}</td>
                <td className="px-3 py-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_CLASS_NAMES[account.status]}`}>{platformAccountStatusLabel(account.status)}</span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{account.priority}</td>
                <td className="px-3 py-2 text-muted-foreground">{account.successCount} / {account.failureCount}</td>
                <td className="px-3 py-2 text-muted-foreground">{formatQuota(account)}</td>
                <td className="px-3 py-2 text-muted-foreground">{formatDateTime(account.lastUsedAt)}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <button type="button" disabled={busy} className="rounded border border-border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-60" onClick={() => onRefreshQuota(account)}>刷新配额</button>
                    {!account.current && <button type="button" disabled={busy} className="rounded border border-border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-60" onClick={() => onSetCurrent(account)}>设为当前</button>}
                    <button type="button" disabled={busy} className="rounded border border-border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-60" onClick={() => onToggleStatus(account)}>{account.status === "disabled" ? "启用" : "停用"}</button>
                    <button type="button" disabled={busy} className="rounded border border-destructive/40 px-2 py-0.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-60" onClick={() => onDelete(account)}>删除</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
