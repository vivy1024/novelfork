import { useEffect, useRef, useState } from "react";
import { BellRing, PlugZap, Play, Save, Upload } from "lucide-react";

import {
  BUILTIN_SOUND_NAMES,
  playBuiltinSound,
} from "@vivy1024/narrafork-runtime-bridge/frontend/notification-sound";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/simple-select";
import { Switch } from "@/components/ui/switch";
import {
  createNotificationSoundsClient,
  createUserPreferencesClient,
  type RuntimeUserPreferences,
  type UserPreferencesPatch,
} from "../../runtime-admin";

const preferencesClient = createUserPreferencesClient();
const soundsClient = createNotificationSoundsClient();

/**
 * Built-in sounds are synthesized by the Runtime oscillator engine, so the ids
 * must come from the Runtime module. A hardcoded list previously drifted and
 * offered ids the Runtime cannot play (`bell`, `pop`) while hiding real ones.
 */
const BUILTIN_SOUND_LABELS: Readonly<Record<string, string>> = {
  gentle: "柔和",
  chime: "清脆",
  alert: "警示",
  soft: "轻柔",
};

const builtinSoundOptions = BUILTIN_SOUND_NAMES.map((name) => ({
  value: name,
  label: BUILTIN_SOUND_LABELS[name] ?? name,
}));

/** Exported so tests can assert the option list stays derived from the Runtime engine. */
export const BUILTIN_SOUND_OPTIONS = builtinSoundOptions;

type WebhookKind = "dingtalk" | "feishu";

interface WebhookTestState {
  readonly kind: WebhookKind;
  readonly ok: boolean;
  readonly detail?: string;
}

type PwaPermission = NotificationPermission | "unsupported";

function readPwaPermission(): PwaPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

function SwitchRow({ label, description, checked, disabled, onChange }: {
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

export function NotificationSettingsPanel() {
  const [preferences, setPreferences] = useState<RuntimeUserPreferences | null>(null);
  const savedRef = useRef<RuntimeUserPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pwaPermission, setPwaPermission] = useState<PwaPermission>(readPwaPermission);
  const [requestingPermission, setRequestingPermission] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState<WebhookKind | null>(null);
  const [webhookTest, setWebhookTest] = useState<WebhookTestState | null>(null);

  useEffect(() => {
    let active = true;
    preferencesClient.get()
      .then((data) => {
        if (!active) return;
        setPreferences(data);
        savedRef.current = data;
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  async function patchPreferences(patch: UserPreferencesPatch) {
    if (!preferences) return;
    setSaving(true);
    setError(null);
    setPreferences({ ...preferences, ...patch });
    try {
      const updated = await preferencesClient.patch(patch);
      setPreferences(updated);
      savedRef.current = updated;
    } catch (reason) {
      setPreferences(savedRef.current);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function saveWebhook(kind: "dingtalk" | "feishu") {
    if (!preferences || !savedRef.current) return;
    const patch: UserPreferencesPatch = kind === "dingtalk"
      ? {
          ...(preferences.notifyDingtalkWebhook !== savedRef.current.notifyDingtalkWebhook
            ? { notifyDingtalkWebhook: preferences.notifyDingtalkWebhook }
            : {}),
          ...(preferences.notifyDingtalkSecret !== savedRef.current.notifyDingtalkSecret
            ? { notifyDingtalkSecret: preferences.notifyDingtalkSecret }
            : {}),
        }
      : {
          ...(preferences.notifyFeishuWebhook !== savedRef.current.notifyFeishuWebhook
            ? { notifyFeishuWebhook: preferences.notifyFeishuWebhook }
            : {}),
          ...(preferences.notifyFeishuSecret !== savedRef.current.notifyFeishuSecret
            ? { notifyFeishuSecret: preferences.notifyFeishuSecret }
            : {}),
        };
    if (Object.keys(patch).length > 0) await patchPreferences(patch);
  }

  async function uploadCustomSound(file: File) {
    setUploading(true);
    setError(null);
    try {
      const uploaded = await soundsClient.upload(file);
      await patchPreferences({
        notifySoundType: "custom",
        notifySoundFileId: uploaded.id,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUploading(false);
    }
  }

  /**
   * The Runtime only delivers PWA notifications when the browser itself granted
   * permission, so enabling the preference alone is not enough. Request the
   * permission here and only enable the preference once it was granted.
   */
  async function requestPwaPermission() {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    setRequestingPermission(true);
    setError(null);
    try {
      const result = await Notification.requestPermission();
      setPwaPermission(result);
      if (result === "granted" && preferences && !preferences.notifyPwaEnabled) {
        await patchPreferences({ notifyPwaEnabled: true });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRequestingPermission(false);
    }
  }

  /**
   * Probe the webhook with the values currently in the form. Masked secrets are
   * sent back as-is: the Runtime resolves a masked placeholder to the stored
   * credential, which is what makes testing a saved webhook possible.
   */
  async function testWebhook(kind: WebhookKind) {
    if (!preferences) return;
    const webhook = kind === "dingtalk"
      ? preferences.notifyDingtalkWebhook
      : preferences.notifyFeishuWebhook;
    if (!webhook.trim()) {
      setWebhookTest({ kind, ok: false, detail: "请先填写 Webhook 地址。" });
      return;
    }
    const secret = kind === "dingtalk"
      ? preferences.notifyDingtalkSecret
      : preferences.notifyFeishuSecret;
    setTestingWebhook(kind);
    setWebhookTest(null);
    try {
      const result = kind === "dingtalk"
        ? await soundsClient.testDingtalk(webhook, secret || undefined)
        : await soundsClient.testFeishu(webhook, secret || undefined);
      setWebhookTest({
        kind,
        ok: result.ok,
        detail: result.message ?? result.reason ?? result.error ?? result.code,
      });
    } catch (reason) {
      setWebhookTest({
        kind,
        ok: false,
        detail: reason instanceof Error ? reason.message : String(reason),
      });
    } finally {
      setTestingWebhook(null);
    }
  }

  if (loading) return <p className="py-8 text-center text-sm text-muted-foreground">正在读取通知偏好…</p>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">通知</h2>
        <p className="text-sm text-muted-foreground">配置任务完成、等待操作、系统声音以及钉钉和飞书通知。</p>
      </div>

      {error ? (
        <Alert>
          <AlertTitle>通知设置保存失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {preferences ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>触发时机</CardTitle>
              <CardDescription>可在任务完成或需要你操作时收到提醒。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <SwitchRow label="任务完成" description="Agent 完成当前任务时发送通知。" checked={preferences.notifyOnDone} onChange={(value) => void patchPreferences({ notifyOnDone: value })} />
              <SwitchRow label="等待用户操作" description="Agent 等待批准、回答或其他用户输入时发送通知。" checked={preferences.notifyOnWaiting} onChange={(value) => void patchPreferences({ notifyOnWaiting: value })} />
              <SwitchRow
                label="PWA / 系统通知"
                description="允许已安装的 Web 应用发送系统通知。"
                checked={preferences.notifyPwaEnabled}
                disabled={pwaPermission === "unsupported"}
                onChange={(value) => void patchPreferences({ notifyPwaEnabled: value })}
              />
              <PwaPermissionNotice
                permission={pwaPermission}
                requesting={requestingPermission}
                onRequest={() => void requestPwaPermission()}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>声音</CardTitle>
              <CardDescription>可使用内置提示音或上传自定义声音文件。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <SwitchRow label="声音提醒" description="通知触发时播放提示音。" checked={preferences.notifySoundEnabled} onChange={(value) => void patchPreferences({ notifySoundEnabled: value })} />
              <label className="grid gap-2 text-sm sm:grid-cols-[1fr_220px] sm:items-center">
                <span className="font-medium">声音来源</span>
                <SimpleSelect
                  aria-label="声音来源"
                  value={preferences.notifySoundType}
                  onValueChange={(value) => void patchPreferences({ notifySoundType: value as "builtin" | "custom" })}
                  options={[
                    { value: "builtin", label: "内置提示音" },
                    { value: "custom", label: "自定义文件" },
                  ]}
                />
              </label>
              {preferences.notifySoundType === "builtin" ? (
                <div className="grid gap-2 text-sm sm:grid-cols-[1fr_220px] sm:items-center">
                  <span className="font-medium">内置提示音</span>
                  <div className="flex items-center gap-2">
                    <SimpleSelect
                      aria-label="内置提示音"
                      value={preferences.notifySoundBuiltin}
                      onValueChange={(value) => void patchPreferences({ notifySoundBuiltin: value })}
                      options={builtinSoundOptions}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="试听提示音"
                      title="试听提示音"
                      onClick={() => playBuiltinSound(preferences.notifySoundBuiltin)}
                    >
                      <Play />
                    </Button>
                  </div>
                </div>
              ) : (
                <label className="flex flex-col gap-2 text-sm">
                  <span className="font-medium">自定义声音文件</span>
                  <Input
                    aria-label="上传自定义声音"
                    type="file"
                    accept="audio/*"
                    disabled={uploading}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) void uploadCustomSound(file);
                    }}
                  />
                  <span className="text-xs text-muted-foreground">
                    {preferences.notifySoundFileId ? "已上传自定义声音" : "尚未上传"}
                  </span>
                </label>
              )}
            </CardContent>
            {uploading ? (
              <CardFooter>
                <Upload data-icon="inline-start" />
                正在上传声音文件…
              </CardFooter>
            ) : null}
          </Card>

          <WebhookCard
            title="钉钉通知"
            description="通过钉钉机器人 Webhook 接收通知。"
            enabled={preferences.notifyDingtalkEnabled}
            webhook={preferences.notifyDingtalkWebhook}
            secret={preferences.notifyDingtalkSecret}
            saving={saving}
            testing={testingWebhook === "dingtalk"}
            testResult={webhookTest?.kind === "dingtalk" ? webhookTest : null}
            onEnabledChange={(value) => void patchPreferences({ notifyDingtalkEnabled: value })}
            onWebhookChange={(value) => setPreferences({ ...preferences, notifyDingtalkWebhook: value })}
            onSecretChange={(value) => setPreferences({ ...preferences, notifyDingtalkSecret: value })}
            onSave={() => void saveWebhook("dingtalk")}
            onTest={() => void testWebhook("dingtalk")}
          />

          <WebhookCard
            title="飞书通知"
            description="通过飞书机器人 Webhook 接收通知。"
            enabled={preferences.notifyFeishuEnabled}
            webhook={preferences.notifyFeishuWebhook}
            secret={preferences.notifyFeishuSecret}
            saving={saving}
            testing={testingWebhook === "feishu"}
            testResult={webhookTest?.kind === "feishu" ? webhookTest : null}
            onEnabledChange={(value) => void patchPreferences({ notifyFeishuEnabled: value })}
            onWebhookChange={(value) => setPreferences({ ...preferences, notifyFeishuWebhook: value })}
            onSecretChange={(value) => setPreferences({ ...preferences, notifyFeishuSecret: value })}
            onSave={() => void saveWebhook("feishu")}
            onTest={() => void testWebhook("feishu")}
          />
        </>
      ) : null}
    </div>
  );
}

function PwaPermissionNotice({ permission, requesting, onRequest }: {
  readonly permission: PwaPermission;
  readonly requesting: boolean;
  readonly onRequest: () => void;
}) {
  if (permission === "granted") {
    return (
      <p className="text-xs text-muted-foreground">
        浏览器通知权限：已授权，系统通知可正常送达。
      </p>
    );
  }
  if (permission === "unsupported") {
    return (
      <Alert>
        <BellRing className="mb-2 size-4 text-muted-foreground" />
        <AlertTitle>当前环境不支持系统通知</AlertTitle>
        <AlertDescription>
          此浏览器或运行环境没有提供 Notification API，开关已禁用。任务完成提醒仍可通过声音、钉钉或飞书送达。
        </AlertDescription>
      </Alert>
    );
  }
  if (permission === "denied") {
    return (
      <Alert>
        <BellRing className="mb-2 size-4 text-muted-foreground" />
        <AlertTitle>浏览器已拒绝通知权限</AlertTitle>
        <AlertDescription>
          即使这里开启 PWA 通知，系统通知也不会送达。请在浏览器地址栏的站点设置中把通知改为「允许」，然后重新加载页面。
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert>
      <BellRing className="mb-2 size-4 text-muted-foreground" />
      <AlertTitle>尚未授予通知权限</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <span>浏览器还没有授权系统通知，此时仅开启开关不会有任何提醒。</span>
        <Button type="button" variant="outline" size="sm" disabled={requesting} onClick={onRequest}>
          <BellRing data-icon="inline-start" />
          {requesting ? "正在请求权限…" : "请求通知权限"}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function WebhookCard({ title, description, enabled, webhook, secret, saving, testing, testResult, onEnabledChange, onWebhookChange, onSecretChange, onSave, onTest }: {
  readonly title: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly webhook: string;
  readonly secret: string;
  readonly saving: boolean;
  readonly testing: boolean;
  readonly testResult: WebhookTestState | null;
  readonly onEnabledChange: (enabled: boolean) => void;
  readonly onWebhookChange: (value: string) => void;
  readonly onSecretChange: (value: string) => void;
  readonly onSave: () => void;
  readonly onTest: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <SwitchRow label={`启用${title}`} description="开关变化只 PATCH 启用字段，不会重发已掩码的凭据。" checked={enabled} onChange={onEnabledChange} />
        <label className="flex flex-col gap-2 text-sm">
          <span className="font-medium">Webhook URL</span>
          <Input aria-label={`${title} Webhook`} value={webhook} onChange={(event) => onWebhookChange(event.currentTarget.value)} placeholder="https://…" />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          <span className="font-medium">签名密钥</span>
          <Input aria-label={`${title}签名密钥`} type="password" value={secret} onChange={(event) => onSecretChange(event.currentTarget.value)} placeholder="可选" />
        </label>
        {testResult ? (
          <div className="flex items-start gap-2 text-xs" role="status">
            <Badge variant={testResult.ok ? "default" : "destructive"}>
              {testResult.ok ? "测试成功" : "测试失败"}
            </Badge>
            <span className="min-w-0 break-words text-muted-foreground">
              {testResult.ok
                ? (testResult.detail ?? "已向该 Webhook 发送一条测试消息，请在群聊中确认。")
                : (testResult.detail ?? "Runtime 未返回失败原因。")}
            </span>
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button type="button" variant="outline" onClick={onTest} disabled={testing || saving}>
          <PlugZap data-icon="inline-start" />
          {testing ? "正在测试…" : "测试连接"}
        </Button>
        <Button type="button" variant="outline" onClick={onSave} disabled={saving}>
          <Save data-icon="inline-start" />
          保存凭据
        </Button>
      </CardFooter>
    </Card>
  );
}
