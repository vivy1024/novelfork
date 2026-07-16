import { useEffect, useState } from "react";
import { AlertTriangle, KeyRound } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Switch } from "@/components/ui/switch";
import {
  createSettingsClient,
  type RuntimeServerSettings,
  type RuntimeSettings,
  type RuntimeTlsSettings,
} from "../runtime-admin";
import { AgentRuntimeHardeningPanel } from "./panels/AgentRuntimeHardeningPanel";
import { ChaptersContainersPanel } from "./panels/ChaptersContainersPanel";
import { GatewayPanel } from "./panels/GatewayPanel";
import { AgentSettingsPanel } from "./panels/AgentSettingsPanel";
import { AppearancePanel } from "./panels/AppearancePanel";
import { AuthenticationPanel } from "./panels/AuthenticationPanel";
import { DataPanel } from "./panels/DataPanel";
import { DevicesPanel } from "./panels/DevicesPanel";
import { MonitoringPanel } from "./panels/MonitoringPanel";
import { NotificationSettingsPanel } from "./panels/NotificationSettingsPanel";
import { ProfilePanel } from "./panels/ProfilePanel";
import { SecurityPanel } from "./panels/SecurityPanel";
import { SearchSettingsPanel } from "./panels/SearchSettingsPanel";
import { ProxySettingsPanel } from "./panels/ProxySettingsPanel";
import { RuntimeControlPanel } from "./panels/RuntimeControlPanel";
import { RuntimeEnvironmentPanel } from "./panels/RuntimeEnvironmentPanel";
import { StorageDiagnosticsPanel } from "./panels/StorageDiagnosticsPanel";
import { TerminalsPanel } from "./panels/TerminalsPanel";
import { UsagePanel } from "./panels/UsagePanel";
import { UsersPanel } from "./panels/UsersPanel";
import { AboutPanel } from "./panels/AboutPanel";
import { SettingsGroup, SettingsPage, SettingsSaveBar, SettingsSwitchRow } from "./components/SettingsPage";
import { asRecord } from "./runtime-settings-utils";

interface SettingsSectionContentProps {
  readonly sectionId: string;
  readonly onSectionChange?: (sectionId: string) => void;
}

export function SettingsSectionContent({ sectionId }: SettingsSectionContentProps) {
  switch (sectionId) {
    case "profile":
      return <ProfilePanel />;
    case "security":
      return <SecurityPanel />;
    case "models":
    case "history":
    case "config":
      return <RuntimeControlPanel />;
    case "agents":
      return <AgentSettingsPanel />;
    case "agent-hardening":
      return <AgentRuntimeHardeningPanel />;
    case "notifications":
      return <NotificationSettingsPanel />;
    case "appearance":
      return <AppearancePanel />;
    case "gateway":
      return <GatewayPanel />;
    case "search":
      return <SearchSettingsPanel />;
    case "chapters":
      return <ChaptersContainersPanel />;
    case "terminals":
      return <TerminalsPanel />;
    case "users":
      return <UsersPanel />;
    case "devices":
      return <DevicesPanel />;
    case "proxy":
      return <ProxySettingsPanel />;
    case "server":
      return <ServerSection />;
    case "authentication":
      return <AuthenticationPanel />;
    case "storage":
      return <StorageDiagnosticsPanel />;
    case "data":
      return <DataPanel />;
    case "usage":
      return <UsagePanel />;
    case "runtime":
      return <RuntimeEnvironmentPanel />;
    case "resources":
      return <MonitoringPanel />;
    case "about":
      return <AboutPanel />;
    default:
      return <RuntimeControlPanel />;
  }
}

interface UpdateDraft {
  serverUrl: string;
  product: string;
  channel: "stable" | "beta";
  checkIntervalMinutes: number;
  autoDownload: boolean;
}

interface ServerDraft {
  port: number;
  host: string;
  defaultProjectDir: string;
  openBrowser: "off" | "browser" | "app";
  tls: RuntimeTlsSettings;
  update: UpdateDraft;
}

const settingsClient = createSettingsClient();

function serverDraft(settings: RuntimeSettings): ServerDraft {
  const server = settings.server ?? { port: 7778, host: "localhost", openBrowser: "browser" };
  const update = asRecord(settings.update);
  return {
    port: server.port,
    host: server.host,
    defaultProjectDir: settings.paths?.defaultProjectDir ?? "",
    openBrowser: server.openBrowser,
    tls: server.tls ?? { enabled: false, certFile: "", keyFile: "" },
    update: {
      serverUrl: typeof update.serverUrl === "string" ? update.serverUrl : "",
      product: typeof update.product === "string" ? update.product : "narrafork",
      channel: update.channel === "beta" ? "beta" : "stable",
      checkIntervalMinutes: typeof update.checkIntervalMinutes === "number" ? update.checkIntervalMinutes : 60,
      autoDownload: update.autoDownload === true,
    },
  };
}

function validateServerDraft(draft: ServerDraft): string | null {
  if (!draft.host.trim()) return "监听地址不能为空。";
  if (!draft.defaultProjectDir.trim()) return "默认项目目录不能为空。";
  if (!draft.update.product.trim()) return "更新产品标识不能为空。";
  if (draft.update.serverUrl.trim()) {
    try {
      new URL(draft.update.serverUrl.trim());
    } catch {
      return "更新服务器必须是有效的 URL。";
    }
  }
  if (draft.tls.enabled && (!draft.tls.certFile.trim() || !draft.tls.keyFile.trim())) {
    return "启用 HTTPS 时必须填写证书文件和私钥文件。";
  }
  return null;
}

function ServerSection() {
  const [draft, setDraft] = useState<ServerDraft | null>(null);
  const [savedDraft, setSavedDraft] = useState<ServerDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generatingTls, setGeneratingTls] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [restartUrl, setRestartUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    settingsClient.get()
      .then((settings) => {
        if (!active) return;
        const nextDraft = serverDraft(settings);
        setDraft(nextDraft);
        setSavedDraft(nextDraft);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  async function handleSave() {
    if (!draft) return;
    const validationError = validateServerDraft(draft);
    if (validationError) {
      setError(validationError);
      return;
    }
    const server: RuntimeServerSettings = {
      port: draft.port,
      host: draft.host.trim(),
      openBrowser: draft.openBrowser,
      tls: {
        ...draft.tls,
        certFile: draft.tls.certFile.trim(),
        keyFile: draft.tls.keyFile.trim(),
        ...(draft.tls.caFile?.trim() ? { caFile: draft.tls.caFile.trim() } : {}),
      },
    };
    setSaving(true);
    setError(null);
    setRestartUrl(null);
    try {
      const updated = await settingsClient.patch({
        server,
        paths: { defaultProjectDir: draft.defaultProjectDir.trim() },
        update: {
          serverUrl: draft.update.serverUrl.trim() || undefined,
          product: draft.update.product.trim(),
          channel: draft.update.channel,
          checkIntervalMinutes: draft.update.checkIntervalMinutes,
          autoDownload: draft.update.autoDownload,
        },
      });
      const nextDraft = serverDraft(updated);
      setDraft(nextDraft);
      setSavedDraft(nextDraft);
      if (updated.serverRestarting) setRestartUrl(updated.newUrl ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateTls() {
    if (!draft) return;
    setGeneratingTls(true);
    setError(null);
    try {
      const result = await settingsClient.generateTls();
      setDraft({
        ...draft,
        tls: {
          enabled: true,
          certFile: result.certPath,
          keyFile: result.keyPath,
        },
      });
      setRestartUrl(result.newUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setGeneratingTls(false);
    }
  }

  async function handleCheckUpdate() {
    setCheckingUpdate(true);
    setError(null);
    setUpdateStatus(null);
    try {
      const result = await settingsClient.checkUpdate();
      setUpdateStatus(result.updateAvailable
        ? `发现新版本 ${result.latestVersion ?? ""}（当前 ${result.currentVersion}）`
        : `当前已是最新版本 ${result.currentVersion}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCheckingUpdate(false);
    }
  }

  if (loading) return <p className="py-8 text-center text-sm text-muted-foreground">正在读取服务器设置…</p>;
  if (!draft) return <p className="py-8 text-center text-sm text-destructive">服务器设置加载失败。</p>;

  const dirty = savedDraft !== null && JSON.stringify(draft) !== JSON.stringify(savedDraft);

  return (
    <SettingsPage
      title="服务器与更新"
      description="直接读写 Runtime 设置中的 server、paths、tls 和 update 字段。"
    >
      <Alert>
        <AlertTitle className="flex items-center gap-2"><AlertTriangle data-icon="inline-start" />保存后可能重启 Runtime</AlertTitle>
        <AlertDescription>监听地址、端口或 TLS 有变化时，Runtime 会安排服务器重启；请准备使用新的 URL 重新连接。</AlertDescription>
      </Alert>

      {error ? <Alert><AlertTitle>服务器设置操作失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
      {restartUrl ? <Alert><AlertTitle>Runtime 正在重启</AlertTitle><AlertDescription>新的访问地址：{restartUrl}</AlertDescription></Alert> : null}

      <SettingsGroup title="监听与启动" description="端口和监听地址会触发 Runtime 重启；打开方式在下次启动时生效。">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="runtime-server-port">端口</FieldLabel>
            <Input id="runtime-server-port" aria-label="服务器端口" type="number" min={1} max={65535} value={draft.port} onChange={(event) => setDraft({ ...draft, port: Math.min(65535, Math.max(1, Number(event.currentTarget.value) || 7778)) })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="runtime-server-host">监听地址</FieldLabel>
            <Input id="runtime-server-host" aria-label="监听地址" value={draft.host} onChange={(event) => setDraft({ ...draft, host: event.currentTarget.value })} placeholder="localhost 或 0.0.0.0" />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="runtime-default-project-dir">默认项目目录</FieldLabel>
            <Input id="runtime-default-project-dir" aria-label="默认项目目录" value={draft.defaultProjectDir} onChange={(event) => setDraft({ ...draft, defaultProjectDir: event.currentTarget.value })} placeholder="Runtime 创建项目时使用的绝对路径" />
            <FieldDescription>不能为空；仅保存目录字符串，不会在浏览器端创建或修改目录。</FieldDescription>
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel>启动时打开</FieldLabel>
            <SimpleSelect aria-label="启动时打开" value={draft.openBrowser} onValueChange={(value) => setDraft({ ...draft, openBrowser: value as ServerDraft["openBrowser"] })} options={[
              { value: "off", label: "不自动打开" },
              { value: "browser", label: "浏览器标签页" },
              { value: "app", label: "应用窗口" },
            ]} />
          </Field>
        </div>
      </SettingsGroup>

      <SettingsGroup title="TLS / HTTPS" description="可使用已有 PEM 文件，或让 Runtime 生成自签名证书。">
        <SettingsSwitchRow
          label="启用 HTTPS"
          description="启用时证书和私钥路径必须真实存在。"
          checked={draft.tls.enabled}
          onCheckedChange={(enabled) => setDraft({ ...draft, tls: { ...draft.tls, enabled } })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="runtime-tls-cert">证书文件</FieldLabel>
            <Input id="runtime-tls-cert" aria-label="TLS 证书文件" value={draft.tls.certFile} onChange={(event) => setDraft({ ...draft, tls: { ...draft.tls, certFile: event.currentTarget.value } })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="runtime-tls-key">私钥文件</FieldLabel>
            <Input id="runtime-tls-key" aria-label="TLS 私钥文件" value={draft.tls.keyFile} onChange={(event) => setDraft({ ...draft, tls: { ...draft.tls, keyFile: event.currentTarget.value } })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="runtime-tls-passphrase">私钥密码</FieldLabel>
            <Input id="runtime-tls-passphrase" aria-label="TLS 私钥密码" type="password" autoComplete="off" value={draft.tls.passphrase ?? ""} onChange={(event) => setDraft({ ...draft, tls: { ...draft.tls, passphrase: event.currentTarget.value || undefined } })} placeholder="可选；掩码值会由 Runtime 保留" />
          </Field>
          <Field>
            <FieldLabel htmlFor="runtime-tls-ca">CA 文件</FieldLabel>
            <Input id="runtime-tls-ca" aria-label="TLS CA 文件" value={draft.tls.caFile ?? ""} onChange={(event) => setDraft({ ...draft, tls: { ...draft.tls, caFile: event.currentTarget.value || undefined } })} placeholder="可选" />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={handleGenerateTls} disabled={generatingTls}>
            <KeyRound data-icon="inline-start" />
            {generatingTls ? "正在生成…" : "生成自签名证书"}
          </Button>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Runtime 更新" description="只保存更新源、产品标识、通道、检查间隔和自动下载设置。">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="runtime-update-server">更新服务器</FieldLabel>
            <Input id="runtime-update-server" aria-label="更新服务器" value={draft.update.serverUrl} onChange={(event) => setDraft({ ...draft, update: { ...draft.update, serverUrl: event.currentTarget.value } })} placeholder="https://updates.example.com" />
          </Field>
          <Field>
            <FieldLabel htmlFor="runtime-update-product">产品标识</FieldLabel>
            <Input id="runtime-update-product" aria-label="更新产品标识" value={draft.update.product} onChange={(event) => setDraft({ ...draft, update: { ...draft.update, product: event.currentTarget.value } })} />
          </Field>
          <Field>
            <FieldLabel>更新通道</FieldLabel>
            <SimpleSelect aria-label="更新通道" value={draft.update.channel} onValueChange={(value) => setDraft({ ...draft, update: { ...draft.update, channel: value as "stable" | "beta" } })} options={[
              { value: "stable", label: "稳定版" },
              { value: "beta", label: "测试版" },
            ]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="runtime-update-interval">检查间隔（分钟）</FieldLabel>
            <Input id="runtime-update-interval" aria-label="更新检查间隔" type="number" min={0} value={draft.update.checkIntervalMinutes} onChange={(event) => setDraft({ ...draft, update: { ...draft.update, checkIntervalMinutes: Math.max(0, Number(event.currentTarget.value) || 0) } })} />
            <FieldDescription>0 表示禁用自动检查。</FieldDescription>
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>自动下载</FieldTitle>
              <FieldDescription>检测到更新后自动下载。</FieldDescription>
            </FieldContent>
            <Switch aria-label="自动下载更新" checked={draft.update.autoDownload} onCheckedChange={(value) => setDraft({ ...draft, update: { ...draft.update, autoDownload: value } })} />
          </Field>
        </div>
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <p className="text-sm text-muted-foreground">{updateStatus ?? "可直接通过 Runtime 更新接口检查当前产品版本。"}</p>
          <Button type="button" variant="outline" onClick={handleCheckUpdate} disabled={checkingUpdate}>
            {checkingUpdate ? "检查中…" : "立即检查更新"}
          </Button>
        </div>
      </SettingsGroup>

      <SettingsSaveBar
        dirty={dirty}
        saving={saving}
        saveLabel="保存服务器设置"
        onDiscard={() => {
          if (savedDraft) setDraft(savedDraft);
          setError(null);
        }}
        onSave={() => void handleSave()}
      />
    </SettingsPage>
  );
}
