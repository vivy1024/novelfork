import { useEffect, useRef, useState } from "react";
import { Save, Upload } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

function SwitchRow({ label, description, checked, onChange }: {
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
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

  if (loading) return <p className="py-8 text-center text-sm text-muted-foreground">正在读取通知偏好…</p>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">通知</h2>
        <p className="text-sm text-muted-foreground">只配置 Runtime 已支持的完成、等待、PWA、声音、钉钉和飞书通知。</p>
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
              <CardDescription>Runtime 当前只提供任务完成和等待用户操作两类事件。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <SwitchRow label="任务完成" description="Agent 完成当前任务时发送通知。" checked={preferences.notifyOnDone} onChange={(value) => void patchPreferences({ notifyOnDone: value })} />
              <SwitchRow label="等待用户操作" description="Agent 等待批准、回答或其他用户输入时发送通知。" checked={preferences.notifyOnWaiting} onChange={(value) => void patchPreferences({ notifyOnWaiting: value })} />
              <SwitchRow label="PWA / 系统通知" description="允许 Runtime 通过已安装的 Web 应用发送系统通知。" checked={preferences.notifyPwaEnabled} onChange={(value) => void patchPreferences({ notifyPwaEnabled: value })} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>声音</CardTitle>
              <CardDescription>可使用 Runtime 内置提示音或上传自定义声音文件。</CardDescription>
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
                    { value: "builtin", label: "Runtime 内置" },
                    { value: "custom", label: "自定义文件" },
                  ]}
                />
              </label>
              {preferences.notifySoundType === "builtin" ? (
                <label className="grid gap-2 text-sm sm:grid-cols-[1fr_220px] sm:items-center">
                  <span className="font-medium">内置提示音</span>
                  <SimpleSelect
                    aria-label="内置提示音"
                    value={preferences.notifySoundBuiltin}
                    onValueChange={(value) => void patchPreferences({ notifySoundBuiltin: value })}
                    options={[
                      { value: "gentle", label: "柔和" },
                      { value: "chime", label: "清脆" },
                      { value: "bell", label: "铃声" },
                      { value: "pop", label: "气泡" },
                    ]}
                  />
                </label>
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
                    {preferences.notifySoundFileId ? `Runtime 文件 ID：${preferences.notifySoundFileId}` : "尚未上传"}
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
            description="通过钉钉机器人 Webhook 接收 Runtime 通知。"
            enabled={preferences.notifyDingtalkEnabled}
            webhook={preferences.notifyDingtalkWebhook}
            secret={preferences.notifyDingtalkSecret}
            saving={saving}
            onEnabledChange={(value) => void patchPreferences({ notifyDingtalkEnabled: value })}
            onWebhookChange={(value) => setPreferences({ ...preferences, notifyDingtalkWebhook: value })}
            onSecretChange={(value) => setPreferences({ ...preferences, notifyDingtalkSecret: value })}
            onSave={() => void saveWebhook("dingtalk")}
          />

          <WebhookCard
            title="飞书通知"
            description="通过飞书机器人 Webhook 接收 Runtime 通知。"
            enabled={preferences.notifyFeishuEnabled}
            webhook={preferences.notifyFeishuWebhook}
            secret={preferences.notifyFeishuSecret}
            saving={saving}
            onEnabledChange={(value) => void patchPreferences({ notifyFeishuEnabled: value })}
            onWebhookChange={(value) => setPreferences({ ...preferences, notifyFeishuWebhook: value })}
            onSecretChange={(value) => setPreferences({ ...preferences, notifyFeishuSecret: value })}
            onSave={() => void saveWebhook("feishu")}
          />
        </>
      ) : null}
    </div>
  );
}

function WebhookCard({ title, description, enabled, webhook, secret, saving, onEnabledChange, onWebhookChange, onSecretChange, onSave }: {
  readonly title: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly webhook: string;
  readonly secret: string;
  readonly saving: boolean;
  readonly onEnabledChange: (enabled: boolean) => void;
  readonly onWebhookChange: (value: string) => void;
  readonly onSecretChange: (value: string) => void;
  readonly onSave: () => void;
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
      </CardContent>
      <CardFooter className="justify-end">
        <Button type="button" variant="outline" onClick={onSave} disabled={saving}>
          <Save data-icon="inline-start" />
          保存凭据
        </Button>
      </CardFooter>
    </Card>
  );
}
