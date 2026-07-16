import { useEffect, useState } from "react";
import { GitBranch, Save, Trash2, Upload } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  createAccountProfileClient,
  type AccountProfile,
} from "../../runtime-admin";

const profileClient = createAccountProfileClient();

export function ProfilePanel() {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [gitUsername, setGitUsername] = useState("");
  const [gitEmail, setGitEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    profileClient.get()
      .then((data) => {
        if (!active) return;
        setProfile(data);
        setGitUsername(data.gitUsername ?? "");
        setGitEmail(data.gitEmail ?? "");
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!profile?.avatarImageId) {
      setAvatarUrl(null);
      return;
    }
    let active = true;
    let objectUrl: string | null = null;
    void profileClient.getAvatarBlob(profile.id, profile.avatarImageId).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setAvatarUrl(objectUrl);
    }).catch(() => {
      if (active) setAvatarUrl(null);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [profile?.avatarImageId, profile?.id]);

  async function handleAvatarUpload(file: File | undefined) {
    if (!profile || !file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("头像仅支持 PNG、JPEG 或 WebP。");
      return;
    }
    setAvatarBusy(true);
    setError(null);
    try {
      const result = await profileClient.uploadAvatar(file);
      setProfile({ ...profile, avatarImageId: result.avatarImageId });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleAvatarDelete() {
    if (!profile?.avatarImageId) return;
    setAvatarBusy(true);
    setError(null);
    try {
      await profileClient.deleteAvatar();
      setProfile({ ...profile, avatarImageId: null });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleSave() {
    if (!profile) return;
    const patch: { gitUsername?: string; gitEmail?: string } = {};
    if (gitUsername !== (profile.gitUsername ?? "")) patch.gitUsername = gitUsername;
    if (gitEmail !== (profile.gitEmail ?? "")) patch.gitEmail = gitEmail;
    if (Object.keys(patch).length === 0) return;

    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await profileClient.patch(patch);
      setProfile({ ...profile, gitUsername: gitUsername || null, gitEmail: gitEmail || null });
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="py-8 text-center text-sm text-muted-foreground">正在读取账户资料…</p>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">个人资料</h2>
        <p className="text-sm text-muted-foreground">账户身份由 NarraFork Runtime 管理；此处管理头像和 Git 提交身份。</p>
      </div>

      {error ? (
        <Alert>
          <AlertTitle>资料读取或保存失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {profile ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Runtime 账户</CardTitle>
              <CardDescription>头像可通过 Runtime 上传或删除；用户名和角色为只读字段。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex size-20 items-center justify-center overflow-hidden rounded-full border bg-muted text-2xl font-semibold" aria-label="当前头像">
                  {avatarUrl ? <img src={avatarUrl} alt={`${profile.username} 的头像`} className="size-full object-cover" /> : profile.username.slice(0, 1).toUpperCase()}
                </div>
                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent">
                    <Upload className="size-4" />
                    {avatarBusy ? "处理中…" : "上传头像"}
                    <input aria-label="上传头像文件" className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" disabled={avatarBusy} onChange={(event) => void handleAvatarUpload(event.currentTarget.files?.[0])} />
                  </label>
                  {profile.avatarImageId ? <Button type="button" variant="outline" onClick={handleAvatarDelete} disabled={avatarBusy}><Trash2 data-icon="inline-start" />删除头像</Button> : null}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm">
                  <span className="font-medium">用户名</span>
                  <Input aria-label="用户名" value={profile.username} readOnly />
                </label>
                <label className="flex flex-col gap-2 text-sm">
                  <span className="font-medium">角色</span>
                  <Input aria-label="角色" value={profile.role === "admin" ? "管理员" : "用户"} readOnly />
                </label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitBranch data-icon="inline-start" />
                Git 提交身份
              </CardTitle>
              <CardDescription>用于 NovelFork 创建的 Git 提交；留空会清除 Runtime 中对应字段。</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium">Git 用户名</span>
                <Input
                  aria-label="Git 用户名"
                  value={gitUsername}
                  onChange={(event) => setGitUsername(event.currentTarget.value)}
                  placeholder="例如 Vivy"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium">Git 邮箱</span>
                <Input
                  aria-label="Git 邮箱"
                  type="email"
                  value={gitEmail}
                  onChange={(event) => setGitEmail(event.currentTarget.value)}
                  placeholder="name@example.com"
                />
              </label>
            </CardContent>
            <CardFooter className="justify-between gap-3">
              <span className="text-xs text-muted-foreground">{saved ? "已保存到 Runtime" : "仅发送发生变化的字段"}</span>
              <Button onClick={handleSave} disabled={saving || (gitUsername === (profile.gitUsername ?? "") && gitEmail === (profile.gitEmail ?? ""))}>
                <Save data-icon="inline-start" />
                {saving ? "保存中…" : "保存 Git 身份"}
              </Button>
            </CardFooter>
          </Card>
        </>
      ) : null}
    </div>
  );
}
