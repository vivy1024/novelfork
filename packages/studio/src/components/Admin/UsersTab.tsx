/**
 * 用户管理标签页
 */

import { useEffect, useMemo, useState } from "react";
import { Edit2, Plus, Save, Trash2, X } from "lucide-react";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson } from "../../hooks/use-api";

interface User {
  id: string;
  username: string;
  email: string;
  role: "admin" | "user";
  createdAt: string | Date;
  lastLogin: string | Date;
}

interface UserFormState {
  username: string;
  email: string;
  role: "admin" | "user";
}

interface FeedbackState {
  tone: "success" | "error";
  message: string;
}

const EMPTY_FORM: UserFormState = {
  username: "",
  email: "",
  role: "user",
};

export function UsersTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<UserFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    void loadUsers(true);
  }, []);

  const loadUsers = async (initial = false) => {
    if (initial) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const data = await fetchJson<{ users: User[] }>("/api/admin/users");
      setUsers(data.users);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载用户失败");
    } finally {
      if (initial) {
        setLoading(false);
      } else {
        setRefreshing(false);
      }
    }
  };

  const summary = useMemo(() => {
    const adminCount = users.filter((user) => user.role === "admin").length;
    return {
      total: users.length,
      adminCount,
      userCount: users.length - adminCount,
    };
  }, [users]);

  const openCreateDialog = () => {
    setEditorMode("create");
    setEditingId(null);
    setForm(EMPTY_FORM);
    setEditorOpen(true);
  };

  const openEditDialog = (user: User) => {
    setEditorMode("edit");
    setEditingId(user.id);
    setForm({
      username: user.username,
      email: user.email,
      role: user.role,
    });
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editorMode === "edit" && editingId) {
        await fetchJson(`/api/admin/users/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        setFeedback({ tone: "success", message: "用户资料已更新" });
      } else {
        await fetchJson("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        setFeedback({ tone: "success", message: "用户已添加" });
      }
      closeEditor();
      await loadUsers();
    } catch (saveError) {
      setFeedback({
        tone: "error",
        message: saveError instanceof Error ? saveError.message : "保存用户失败",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;

    setDeleting(true);
    try {
      await fetchJson(`/api/admin/users/${deleteTarget.id}`, { method: "DELETE" });
      setFeedback({ tone: "success", message: `已删除用户 ${deleteTarget.username}` });
      setDeleteTarget(null);
      await loadUsers();
    } catch (deleteError) {
      setFeedback({
        tone: "error",
        message: deleteError instanceof Error ? deleteError.message : "删除用户失败",
      });
    } finally {
      setDeleting(false);
    }
  };

  if (loading && users.length === 0 && !error) {
    return (
      <PageEmptyState
        title="正在加载用户"
        description="正在向 /api/admin/users 拉取账号列表。"
        action={<Button variant="outline" onClick={() => void loadUsers(true)}>重试</Button>}
      />
    );
  }

  if (error && users.length === 0) {
    return (
      <PageEmptyState
        title="用户数据加载失败"
        description={error}
        action={<Button variant="outline" onClick={() => void loadUsers(true)}>重试</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold text-foreground">用户治理</h2>
            <Badge variant="secondary">管理中心</Badge>
          </div>
          <p className="text-sm text-muted-foreground">统一管理账号、角色和最后登录时间。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void loadUsers()} disabled={refreshing}>
            {refreshing ? "刷新中..." : "刷新"}
          </Button>
          <Button onClick={openCreateDialog}>
            <Plus className="size-4" />
            添加用户
          </Button>
        </div>
      </div>

      {feedback && (
        <Card className={feedback.tone === "success" ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5"}>
          <CardContent className="py-4 text-sm text-foreground">{feedback.message}</CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard title="用户总数" value={String(summary.total)} description="当前接入的账号数" />
        <SummaryCard title="管理员" value={String(summary.adminCount)} description="拥有管理权限的账号" />
        <SummaryCard title="普通用户" value={String(summary.userCount)} description="非管理员账号" />
      </div>

      <Card>
        <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>用户列表</CardTitle>
            <CardDescription>统一查看账号、邮箱、角色和登录时间。</CardDescription>
          </div>
          <Badge variant="outline">{summary.total} 人</Badge>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <PageEmptyState
              title="暂无用户"
              description="添加用户后，这里会显示账号、角色和最近登录时间。"
              action={<Button onClick={openCreateDialog}>添加用户</Button>}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>用户名</TableHead>
                  <TableHead>邮箱</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>最后登录</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium text-foreground">{user.username}</TableCell>
                    <TableCell className="text-muted-foreground">{user.email}</TableCell>
                    <TableCell>
                      <Badge variant={user.role === "admin" ? "secondary" : "outline"}>
                        {user.role === "admin" ? "管理员" : "普通用户"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(user.createdAt, false)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(user.lastLogin, true)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openEditDialog(user)}
                          aria-label={`编辑用户 ${user.username}`}
                        >
                          <Edit2 className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setDeleteTarget(user)}
                          aria-label={`删除用户 ${user.username}`}
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={editorOpen} onOpenChange={(open) => { if (!open) closeEditor(); }}>
        <DialogContent className="max-w-xl" showCloseButton={false}>
          <DialogHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <DialogTitle>{editorMode === "edit" ? "编辑用户" : "新增用户"}</DialogTitle>
              <DialogDescription>添加或更新账号、邮箱与角色。</DialogDescription>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={closeEditor} aria-label="关闭">
              <X className="size-4" />
            </Button>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="space-y-2">
              <Label htmlFor="user-username">用户名</Label>
              <Input
                id="user-username"
                value={form.username}
                onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))}
                placeholder="输入用户名"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-email">邮箱</Label>
              <Input
                id="user-email"
                type="email"
                value={form.email}
                onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                placeholder="输入邮箱"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-role">角色</Label>
              <select
                id="user-role"
                value={form.role}
                onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value as "admin" | "user" }))}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground"
              >
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeEditor}>
              取消
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              <Save className="size-4" />
              {saving ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="max-w-md" showCloseButton={false}>
          <DialogHeader className="flex flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <DialogTitle>确认删除用户</DialogTitle>
              <DialogDescription>删除后无法恢复，请确认你要移除的账号。</DialogDescription>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => setDeleteTarget(null)} aria-label="关闭">
              <X className="size-4" />
            </Button>
          </DialogHeader>

          {deleteTarget && (
            <Card size="sm" className="border-destructive/20 bg-destructive/5">
              <CardHeader className="space-y-1">
                <CardTitle className="text-base">{deleteTarget.username}</CardTitle>
                <CardDescription>{deleteTarget.email}</CardDescription>
              </CardHeader>
            </Card>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={() => void handleDeleteConfirm()} disabled={deleting}>
              <Trash2 className="size-4" />
              {deleting ? "删除中..." : "删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({ title, value, description }: { title: string; value: string; description: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-xs text-muted-foreground">{description}</CardContent>
    </Card>
  );
}

function formatDate(value: string | Date, includeTime: boolean) {
  const date = new Date(value);
  return includeTime ? date.toLocaleString() : date.toLocaleDateString();
}
