import { useState, useEffect } from "react";
import { fetchJson, putApi } from "../../../hooks/use-api";
import type { UserProfile } from "../../../types/settings";
import { User, Mail, GitBranch } from "lucide-react";

export function ProfilePanel() {
  const [profile, setProfile] = useState<UserProfile>({
    name: "",
    email: "",
    gitName: "",
    gitEmail: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchJson<{ profile: UserProfile }>("/settings/user")
      .then((data) => {
        setProfile(data.profile);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await putApi("/settings/user", { profile });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-muted-foreground">加载中...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2 text-foreground">个人资料</h2>
        <p className="text-sm text-muted-foreground">
          配置您的个人信息和 Git 提交信息
        </p>
      </div>

      <div className="rounded-lg border border-border p-4 space-y-4">
        <div>
          <label className="flex items-center gap-2 text-sm font-medium mb-2 text-foreground">
            <User className="w-4 h-4" />
            姓名
          </label>
          <input
            type="text"
            value={profile.name}
            onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20"
            placeholder="您的姓名"
          />
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm font-medium mb-2 text-foreground">
            <Mail className="w-4 h-4" />
            邮箱
          </label>
          <input
            type="email"
            value={profile.email}
            onChange={(e) => setProfile({ ...profile, email: e.target.value })}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20"
            placeholder="your@email.com"
          />
        </div>

        <div className="pt-4 border-t border-border">
          <h3 className="flex items-center gap-2 text-sm font-semibold mb-3 text-foreground">
            <GitBranch className="w-4 h-4" />
            Git 配置
          </h3>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block text-foreground">
                Git 用户名
              </label>
              <input
                type="text"
                value={profile.gitName || ""}
                onChange={(e) => setProfile({ ...profile, gitName: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20"
                placeholder="用于 Git 提交的用户名"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block text-foreground">
                Git 邮箱
              </label>
              <input
                type="email"
                value={profile.gitEmail || ""}
                onChange={(e) => setProfile({ ...profile, gitEmail: e.target.value })}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20"
                placeholder="用于 Git 提交的邮箱"
              />
            </div>
          </div>
        </div>

        <div className="pt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
