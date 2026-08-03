import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Clipboard,
  Download,
  Fingerprint,
  KeyRound,
  Pencil,
  ShieldCheck,
  Smartphone,
  Trash2,
  Unlink,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  createSecurityClient,
  isPasskeySupported,
  isSafeAuthorizeUrl,
  type PasskeySummary,
  type SecurityClient,
  type SecuritySnapshot,
  type SsoIdentity,
  type TotpSetupResult,
} from "../../runtime-admin/security";
import { isUserCancelledWebAuthn } from "../../runtime/auth";

const defaultSecurityClient = createSecurityClient();

type TotpStep = "scan" | "verify" | "backup";

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function displayDate(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

function downloadBackupCodes(codes: ReadonlyArray<string>) {
  const blob = new Blob([`NovelFork backup codes\n\n${codes.join("\n")}\n`], {
    type: "text/plain",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "narrafork-backup-codes.txt";
  anchor.click();
  URL.revokeObjectURL(url);
}

export interface SecurityPanelProps {
  readonly client?: SecurityClient;
}

export function SecurityPanel({ client = defaultSecurityClient }: SecurityPanelProps) {
  const [snapshot, setSnapshot] = useState<SecuritySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [totpOpen, setTotpOpen] = useState(false);
  const [totpStep, setTotpStep] = useState<TotpStep>("scan");
  const [totpSetup, setTotpSetup] = useState<TotpSetupResult | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<ReadonlyArray<string>>([]);
  const [enableMfaAfterSetup, setEnableMfaAfterSetup] = useState(true);

  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");

  const [renamingPasskey, setRenamingPasskey] = useState<PasskeySummary | null>(null);
  const [passkeyName, setPasskeyName] = useState("");
  const [deletingPasskey, setDeletingPasskey] = useState<PasskeySummary | null>(null);
  const [unlinkingIdentity, setUnlinkingIdentity] = useState<SsoIdentity | null>(null);

  const passkeySupported = useMemo(() => isPasskeySupported(), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await client.getSnapshot());
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  async function refreshStatus() {
    const status = await client.getStatus();
    setSnapshot((current) => current ? { ...current, status } : current);
  }

  async function handleMfaToggle(enabled: boolean) {
    setBusyAction("mfa");
    setError(null);
    setNotice(null);
    try {
      const result = await client.setMfaEnabled(enabled);
      setSnapshot((current) => current ? {
        ...current,
        status: { ...current.status, mfaEnabled: result.mfaEnabled },
      } : current);
      setNotice(enabled ? "登录时已要求第二重验证。" : "登录时的第二重验证要求已关闭。已登记的验证方式仍会保留。");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function beginTotpSetup() {
    setBusyAction("totp-setup");
    setError(null);
    setNotice(null);
    try {
      const setup = await client.setupTotp();
      setTotpSetup(setup);
      setTotpStep("scan");
      setTotpCode("");
      setBackupCodes([]);
      setEnableMfaAfterSetup(!snapshot?.status.mfaEnabled);
      setTotpOpen(true);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function activateTotp() {
    const code = totpCode.trim();
    if (code.length !== 6) return;
    setBusyAction("totp-activate");
    setError(null);
    try {
      const result = await client.activateTotp(code);
      setBackupCodes(result.backupCodes);
      setTotpStep("backup");
      await refreshStatus();
    } catch (reason) {
      setError(errorMessage(reason));
      setTotpCode("");
    } finally {
      setBusyAction(null);
    }
  }

  async function finishTotpSetup() {
    setBusyAction("totp-finish");
    setError(null);
    try {
      if (enableMfaAfterSetup && !snapshot?.status.mfaEnabled) {
        await client.setMfaEnabled(true);
      }
      await refreshStatus();
      setNotice("身份验证器已启用。请妥善保管刚刚生成的备用代码。");
      setTotpOpen(false);
    } catch (reason) {
      setError(`TOTP 已激活，但登录验证要求未能更新：${errorMessage(reason)}`);
      setTotpOpen(false);
    } finally {
      setBusyAction(null);
    }
  }

  async function disableTotp() {
    if (!disableCode.trim() && !disablePassword) return;
    setBusyAction("totp-disable");
    setError(null);
    try {
      await client.disableTotp({
        code: disableCode.trim() || undefined,
        password: disablePassword || undefined,
      });
      await refreshStatus();
      setDisableOpen(false);
      setDisableCode("");
      setDisablePassword("");
      setNotice("身份验证器已停用。");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function registerPasskey() {
    if (!passkeySupported) return;
    setBusyAction("passkey-register");
    setError(null);
    setNotice(null);
    try {
      await client.registerPasskey();
      await load();
      setNotice("Passkey 已登记，可用于登录或双重验证。");
    } catch (reason) {
      if (!isUserCancelledWebAuthn(reason)) setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  function openPasskeyRename(passkey: PasskeySummary) {
    setRenamingPasskey(passkey);
    setPasskeyName(passkey.name ?? "");
  }

  async function renamePasskey() {
    const name = passkeyName.trim();
    if (!renamingPasskey || !name) return;
    setBusyAction("passkey-rename");
    setError(null);
    try {
      await client.renamePasskey(renamingPasskey.id, name);
      setSnapshot((current) => current ? {
        ...current,
        passkeys: current.passkeys.map((passkey) =>
          passkey.id === renamingPasskey.id ? { ...passkey, name } : passkey),
      } : current);
      setRenamingPasskey(null);
      setNotice("Passkey 名称已更新。");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function deletePasskey() {
    if (!deletingPasskey) return;
    setBusyAction("passkey-delete");
    setError(null);
    try {
      await client.deletePasskey(deletingPasskey.id);
      const status = await client.getStatus();
      setSnapshot((current) => current ? {
        ...current,
        status,
        passkeys: current.passkeys.filter((passkey) => passkey.id !== deletingPasskey.id),
      } : current);
      setDeletingPasskey(null);
      setNotice("Passkey 已移除。");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function linkIdentity(providerId: string) {
    setBusyAction(`sso-link:${providerId}`);
    setError(null);
    try {
      const { authorizeUrl } = await client.startIdentityLink(providerId);
      if (!isSafeAuthorizeUrl(authorizeUrl)) {
        throw new Error("Runtime 返回了不安全的 SSO 授权地址");
      }
      window.location.assign(authorizeUrl);
    } catch (reason) {
      setError(errorMessage(reason));
      setBusyAction(null);
    }
  }

  async function unlinkIdentity() {
    if (!unlinkingIdentity) return;
    setBusyAction("sso-unlink");
    setError(null);
    try {
      await client.unlinkIdentity(unlinkingIdentity.id);
      setSnapshot((current) => current ? {
        ...current,
        identities: current.identities.filter((identity) => identity.id !== unlinkingIdentity.id),
      } : current);
      setUnlinkingIdentity(null);
      setNotice("SSO 身份已解绑。");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function copyText(value: string, successMessage: string) {
    try {
      if (!navigator.clipboard) throw new Error("当前浏览器不允许访问剪贴板");
      await navigator.clipboard.writeText(value);
      setNotice(successMessage);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4" aria-label="正在读取账户安全状态">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!snapshot) {
    return (
      <Alert>
        <AlertTitle>无法读取账户安全状态</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          <span>{error ?? "Runtime 未返回安全设置。"}</span>
          <Button variant="outline" size="sm" onClick={() => void load()}>重试</Button>
        </AlertDescription>
      </Alert>
    );
  }

  const hasFactor = snapshot.status.totpEnabled || snapshot.status.passkeyCount > 0;
  const providerNames = new Map(snapshot.providers.map((provider) => [provider.id, provider.name]));
  const linkedProviders = new Set(snapshot.identities.map((identity) => identity.provider));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">账户安全</h2>
        <p className="text-sm text-muted-foreground">安全状态和身份操作直接由 Runtime 提供。</p>
      </div>

      {error ? (
        <Alert>
          <AlertTitle>安全操作失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <AlertTitle>安全设置已更新</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck />
            登录双重验证
          </CardTitle>
          <CardDescription>只有在至少登记一种可用因素后，才能要求每次登录进行第二重验证。</CardDescription>
          <CardAction>
            <Switch
              aria-label="登录时要求双重验证"
              checked={snapshot.status.mfaEnabled}
              disabled={!hasFactor || busyAction === "mfa"}
              onCheckedChange={(checked) => void handleMfaToggle(checked)}
            />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge variant={snapshot.status.mfaEnabled ? "default" : "secondary"}>
            {snapshot.status.mfaEnabled ? "登录验证已启用" : "登录验证未启用"}
          </Badge>
          <Badge variant={snapshot.status.totpEnabled ? "outline" : "secondary"}>
            TOTP {snapshot.status.totpEnabled ? "已登记" : "未登记"}
          </Badge>
          <Badge variant={snapshot.status.passkeyCount > 0 ? "outline" : "secondary"}>
            {snapshot.status.passkeyCount} 个 Passkey
          </Badge>
          {!hasFactor ? <p className="w-full text-sm text-muted-foreground">请先登记身份验证器或 Passkey。</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone />
            身份验证器（TOTP）
          </CardTitle>
          <CardDescription>使用兼容 TOTP 的身份验证器应用生成一次性验证码。</CardDescription>
          <CardAction>
            {snapshot.status.totpEnabled ? (
              <Button variant="destructive" size="sm" onClick={() => {
                setError(null);
                setDisableOpen(true);
              }}>停用</Button>
            ) : (
              <Button size="sm" disabled={busyAction === "totp-setup"} onClick={() => void beginTotpSetup()}>
                {busyAction === "totp-setup" ? "准备中…" : "设置身份验证器"}
              </Button>
            )}
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Badge variant={snapshot.status.totpEnabled ? "default" : "secondary"}>
            {snapshot.status.totpEnabled ? "已启用" : "未启用"}
          </Badge>
          {snapshot.status.totpEnabled ? (
            <span className="text-sm text-muted-foreground">剩余 {snapshot.status.backupCodesRemaining} 个备用代码</span>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Fingerprint />
            Passkey
          </CardTitle>
          <CardDescription>此处读取并管理 Runtime 中已有的 Passkey 凭据。</CardDescription>
          <CardAction className="flex items-center gap-2">
            <Badge variant={passkeySupported ? "outline" : "secondary"}>
              {passkeySupported ? "当前浏览器支持 WebAuthn" : "当前浏览器不支持 WebAuthn"}
            </Badge>
            <Button size="sm" disabled={!passkeySupported || busyAction === "passkey-register"} onClick={() => void registerPasskey()}>
              {busyAction === "passkey-register" ? "验证中…" : "登记 Passkey"}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {snapshot.passkeys.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><Fingerprint /></EmptyMedia>
                <EmptyTitle>尚无 Passkey</EmptyTitle>
                <EmptyDescription>Runtime 尚未为当前账户保存 Passkey 凭据。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {snapshot.passkeys.map((passkey) => (
                <div key={passkey.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{passkey.name || "未命名 Passkey"}</p>
                    <p className="text-xs text-muted-foreground">
                      添加于 {displayDate(passkey.createdAt)}
                      {displayDate(passkey.lastUsedAt) ? ` · 最近使用 ${displayDate(passkey.lastUsedAt)}` : ""}
                      {passkey.deviceType ? ` · ${passkey.deviceType}` : ""}
                      {passkey.backedUp ? " · 已备份" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="outline" size="icon-sm" aria-label={`重命名 ${passkey.name || "Passkey"}`} onClick={() => openPasskeyRename(passkey)}>
                      <Pencil />
                    </Button>
                    <Button variant="destructive" size="icon-sm" aria-label={`删除 ${passkey.name || "Passkey"}`} onClick={() => setDeletingPasskey(passkey)}>
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound />
            SSO 身份
          </CardTitle>
          <CardDescription>读取已配置的 OIDC 提供方，并管理当前账户的关联身份。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {snapshot.identities.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><KeyRound /></EmptyMedia>
                <EmptyTitle>尚未关联 SSO 身份</EmptyTitle>
                <EmptyDescription>可从下方已配置的提供方开始关联。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {snapshot.identities.map((identity) => (
                <div key={identity.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{providerNames.get(identity.provider) ?? identity.provider}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {identity.email || identity.displayName || "已关联身份"}
                      {displayDate(identity.lastLoginAt) ? ` · 最近登录 ${displayDate(identity.lastLoginAt)}` : ""}
                    </p>
                  </div>
                  <Button variant="destructive" size="sm" onClick={() => setUnlinkingIdentity(identity)}>
                    <Unlink data-icon="inline-start" />解绑
                  </Button>
                </div>
              ))}
            </div>
          )}

          {snapshot.providers.length > 0 ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium">可用 SSO 提供方</p>
              {snapshot.providers.map((provider) => (
                <div key={provider.id} className="flex items-center justify-between gap-3">
                  <span className="text-sm">{provider.name}</span>
                  {linkedProviders.has(provider.id) ? (
                    <Badge variant="secondary">已关联</Badge>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyAction === `sso-link:${provider.id}`}
                      onClick={() => void linkIdentity(provider.id)}
                    >
                      {busyAction === `sso-link:${provider.id}` ? "正在跳转…" : "关联"}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Runtime 当前未配置可用的 SSO 提供方。</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={totpOpen} onOpenChange={(open) => {
        if (open || totpStep !== "backup") setTotpOpen(open);
      }}>
        <DialogContent showCloseButton={totpStep !== "backup"}>
          <DialogHeader>
            <DialogTitle>设置身份验证器</DialogTitle>
            <DialogDescription>
              {totpStep === "scan" ? "扫描二维码或手动输入密钥。" : null}
              {totpStep === "verify" ? "输入身份验证器当前显示的 6 位验证码。" : null}
              {totpStep === "backup" ? "请立即保存备用代码；每个代码只能使用一次。" : null}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert>
              <AlertTitle>TOTP 操作失败</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {totpStep === "scan" && totpSetup ? (
            <div className="flex flex-col items-center gap-4">
              <img className="size-52 rounded-lg border" src={totpSetup.qrDataUrl} alt="TOTP 设置二维码" />
              <div className="flex max-w-full items-center gap-2">
                <code className="truncate rounded-md bg-muted px-2 py-1 text-sm">{totpSetup.secret}</code>
                <Button variant="outline" size="icon-sm" aria-label="复制 TOTP 密钥" onClick={() => void copyText(totpSetup.secret, "TOTP 密钥已复制。") }>
                  <Clipboard />
                </Button>
              </div>
              <Button className="w-full" onClick={() => setTotpStep("verify")}>下一步</Button>
            </div>
          ) : null}

          {totpStep === "verify" ? (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="totp-activation-code">6 位验证码</FieldLabel>
                <Input
                  id="totp-activation-code"
                  aria-label="TOTP 验证码"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={6}
                  value={totpCode}
                  onChange={(event) => setTotpCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))}
                />
                <FieldDescription>验证码用于确认身份验证器已经正确保存密钥。</FieldDescription>
              </Field>
              <div className="flex justify-between gap-3">
                <Button variant="outline" onClick={() => setTotpStep("scan")}>上一步</Button>
                <Button disabled={totpCode.length !== 6 || busyAction === "totp-activate"} onClick={() => void activateTotp()}>
                  {busyAction === "totp-activate" ? "正在验证…" : "激活"}
                </Button>
              </div>
            </FieldGroup>
          ) : null}

          {totpStep === "backup" ? (
            <div className="flex flex-col gap-4">
              <Alert>
                <AlertTitle>备用代码只显示这一次</AlertTitle>
                <AlertDescription>将它们保存在密码管理器或其他安全位置。</AlertDescription>
              </Alert>
              <div className="grid grid-cols-2 gap-2">
                {backupCodes.map((code) => <code key={code} className="rounded-md bg-muted px-2 py-1 text-center text-sm">{code}</code>)}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => void copyText(backupCodes.join("\n"), "备用代码已复制。") }>
                  <Clipboard data-icon="inline-start" />复制
                </Button>
                <Button variant="outline" size="sm" onClick={() => downloadBackupCodes(backupCodes)}>
                  <Download data-icon="inline-start" />下载
                </Button>
              </div>
              {!snapshot.status.mfaEnabled ? (
                <Field orientation="horizontal">
                  <FieldLabel>完成后要求登录双重验证</FieldLabel>
                  <Switch
                    aria-label="完成后要求登录双重验证"
                    checked={enableMfaAfterSetup}
                    onCheckedChange={setEnableMfaAfterSetup}
                  />
                </Field>
              ) : null}
              <Button disabled={busyAction === "totp-finish"} onClick={() => void finishTotpSetup()}>
                <Check data-icon="inline-start" />
                {busyAction === "totp-finish" ? "正在完成…" : "我已保存，完成设置"}
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>停用身份验证器</DialogTitle>
            <DialogDescription>使用当前 TOTP/备用代码，或账户密码确认此高风险操作。</DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert>
              <AlertTitle>无法停用身份验证器</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="totp-disable-code">TOTP 或备用代码</FieldLabel>
              <Input id="totp-disable-code" aria-label="停用验证码" type="password" value={disableCode} onChange={(event) => setDisableCode(event.currentTarget.value)} />
            </Field>
            <FieldSeparator>或者</FieldSeparator>
            <Field>
              <FieldLabel htmlFor="totp-disable-password">账户密码</FieldLabel>
              <Input id="totp-disable-password" aria-label="停用账户密码" type="password" value={disablePassword} onChange={(event) => setDisablePassword(event.currentTarget.value)} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisableOpen(false)}>取消</Button>
            <Button variant="destructive" disabled={(!disableCode.trim() && !disablePassword) || busyAction === "totp-disable"} onClick={() => void disableTotp()}>
              {busyAction === "totp-disable" ? "正在停用…" : "确认停用"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renamingPasskey !== null} onOpenChange={(open) => { if (!open) setRenamingPasskey(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名 Passkey</DialogTitle>
            <DialogDescription>设置便于识别设备或密码管理器的名称。</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="passkey-name">Passkey 名称</FieldLabel>
            <Input id="passkey-name" aria-label="Passkey 名称" maxLength={60} value={passkeyName} onChange={(event) => setPasskeyName(event.currentTarget.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenamingPasskey(null)}>取消</Button>
            <Button disabled={!passkeyName.trim() || busyAction === "passkey-rename"} onClick={() => void renamePasskey()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deletingPasskey !== null} onOpenChange={(open) => { if (!open) setDeletingPasskey(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除 Passkey</DialogTitle>
            <DialogDescription>删除后，无法再使用“{deletingPasskey?.name || "未命名 Passkey"}”登录或完成双重验证。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingPasskey(null)}>取消</Button>
            <Button variant="destructive" disabled={busyAction === "passkey-delete"} onClick={() => void deletePasskey()}>确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={unlinkingIdentity !== null} onOpenChange={(open) => { if (!open) setUnlinkingIdentity(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>解绑 SSO 身份</DialogTitle>
            <DialogDescription>解绑后，此提供方身份将不能再登录当前账户。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnlinkingIdentity(null)}>取消</Button>
            <Button variant="destructive" disabled={busyAction === "sso-unlink"} onClick={() => void unlinkIdentity()}>确认解绑</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
