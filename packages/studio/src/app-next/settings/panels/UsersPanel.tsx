import { useCallback, useEffect, useState } from "react";
import { Ban, Pencil, ShieldCheck, Trash2, UserCheck, Users } from "lucide-react";

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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createUsersClient,
  type RuntimeAdminUser,
  type RuntimeUserRole,
  type RuntimeUsersSnapshot,
  type UsersClient,
} from "../../runtime-admin/users";

const defaultUsersClient = createUsersClient();

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function displayDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

interface RoleChange {
  readonly user: RuntimeAdminUser;
  readonly role: RuntimeUserRole;
}

export interface UsersPanelProps {
  readonly client?: UsersClient;
}

export function UsersPanel({ client = defaultUsersClient }: UsersPanelProps) {
  const [snapshot, setSnapshot] = useState<RuntimeUsersSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<RuntimeAdminUser | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [roleChange, setRoleChange] = useState<RoleChange | null>(null);
  const [deletingUser, setDeletingUser] = useState<RuntimeAdminUser | null>(null);

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

  function patchUser(id: string, patch: Partial<RuntimeAdminUser>) {
    setSnapshot((current) => current ? {
      ...current,
      currentUser: current.currentUser.id === id
        ? { ...current.currentUser, ...patch }
        : current.currentUser,
      users: current.users.map((user) => user.id === id ? { ...user, ...patch } : user),
    } : current);
  }

  async function toggleRegistration(registrationOpen: boolean) {
    setBusyAction("registration");
    setError(null);
    setNotice(null);
    try {
      const result = await client.updateRegistrationOpen(registrationOpen);
      setSnapshot((current) => current ? { ...current, registrationOpen: result.registrationOpen } : current);
      setNotice(result.registrationOpen ? "新用户注册已开放。" : "新用户注册已关闭。");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  function openEdit(user: RuntimeAdminUser) {
    setEditingUser(user);
    setEditUsername(user.username);
    setEditPassword("");
  }

  async function saveUser() {
    if (!editingUser) return;
    const username = editUsername.trim();
    const input = {
      username: username && username !== editingUser.username ? username : undefined,
      password: editPassword || undefined,
    };
    if (!input.username && !input.password) {
      setEditingUser(null);
      return;
    }

    setBusyAction("edit-user");
    setError(null);
    setNotice(null);
    try {
      const updated = await client.updateUser(editingUser.id, input);
      patchUser(editingUser.id, updated);
      setEditingUser(null);
      setEditPassword("");
      setNotice(`用户“${updated.username}”已更新。`);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function confirmRoleChange() {
    if (!roleChange) return;
    setBusyAction("change-role");
    setError(null);
    setNotice(null);
    try {
      const updated = await client.updateUser(roleChange.user.id, { role: roleChange.role });
      patchUser(roleChange.user.id, updated);
      setRoleChange(null);
      setNotice(`用户“${updated.username}”的角色已更新。`);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function toggleDisabled(user: RuntimeAdminUser) {
    const disabled = user.disabledAt === null;
    setBusyAction(`toggle-disabled:${user.id}`);
    setError(null);
    setNotice(null);
    try {
      const updated = await client.updateUser(user.id, { disabled });
      patchUser(user.id, updated);
      setNotice(`用户“${updated.username}”已${disabled ? "禁用" : "启用"}。`);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function confirmDelete() {
    if (!deletingUser) return;
    setBusyAction("delete-user");
    setError(null);
    setNotice(null);
    try {
      await client.deleteUser(deletingUser.id);
      setSnapshot((current) => current ? {
        ...current,
        users: current.users.filter((user) => user.id !== deletingUser.id),
      } : current);
      setNotice(`用户“${deletingUser.username}”已删除。`);
      setDeletingUser(null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4" aria-label="正在读取用户管理设置">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!snapshot) {
    return (
      <Alert>
        <AlertTitle>无法读取用户管理设置</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          <span>{error ?? "Runtime 未返回用户数据。"}</span>
          <Button variant="outline" size="sm" onClick={() => void load()}>重试</Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">用户管理</h2>
        <p className="text-sm text-muted-foreground">管理 Runtime 账户、角色、登录凭据和注册策略。</p>
      </div>

      {error ? (
        <Alert>
          <AlertTitle>用户操作失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <AlertTitle>用户设置已更新</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck />
            注册设置
          </CardTitle>
          <CardDescription>控制是否允许新用户从登录页自行注册。首位管理员的初始化不受此开关影响。</CardDescription>
          <CardAction>
            <Switch
              aria-label="允许新用户注册"
              checked={snapshot.registrationOpen}
              disabled={busyAction === "registration"}
              onCheckedChange={(checked) => void toggleRegistration(checked)}
            />
          </CardAction>
        </CardHeader>
        <CardContent>
          <Badge variant={snapshot.registrationOpen ? "default" : "secondary"}>
            {snapshot.registrationOpen ? "注册已开放" : "注册已关闭"}
          </Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users />
            Runtime 用户
          </CardTitle>
          <CardDescription>当前账户不能降级或删除自身；Runtime 也会保护最后一位管理员。</CardDescription>
        </CardHeader>
        <CardContent>
          {snapshot.users.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><Users /></EmptyMedia>
                <EmptyTitle>没有可管理的用户</EmptyTitle>
                <EmptyDescription>Runtime 尚未返回任何用户账户。</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>用户名</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>创建日期</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot.users.map((user) => {
                  const isCurrent = user.id === snapshot.currentUser.id;
                  const nextRole: RuntimeUserRole = user.role === "admin" ? "user" : "admin";
                  return (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-2">
                          {user.username}
                          {isCurrent ? <Badge variant="outline">当前账户</Badge> : null}
                        </span>
                      </TableCell>
                      <TableCell>
                        {isCurrent ? (
                          <Badge variant="default">管理员</Badge>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={`将 ${user.username} 设为${nextRole === "admin" ? "管理员" : "普通用户"}`}
                            onClick={() => setRoleChange({ user, role: nextRole })}
                          >
                            {user.role === "admin" ? "管理员" : "普通用户"}
                          </Button>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.disabledAt ? "destructive" : "secondary"}>
                          {user.disabledAt ? "已禁用" : "已启用"}
                        </Badge>
                      </TableCell>
                      <TableCell>{displayDate(user.createdAt)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="icon-sm" aria-label={`编辑 ${user.username}`} onClick={() => openEdit(user)}>
                            <Pencil />
                          </Button>
                          {!isCurrent ? (
                            <>
                              <Button
                                variant="outline"
                                size="icon-sm"
                                aria-label={`${user.disabledAt ? "启用" : "禁用"} ${user.username}`}
                                disabled={busyAction === `toggle-disabled:${user.id}`}
                                onClick={() => void toggleDisabled(user)}
                              >
                                {user.disabledAt ? <UserCheck /> : <Ban />}
                              </Button>
                              <Button variant="destructive" size="icon-sm" aria-label={`删除 ${user.username}`} onClick={() => setDeletingUser(user)}>
                                <Trash2 />
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={editingUser !== null} onOpenChange={(open) => { if (!open) setEditingUser(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑用户</DialogTitle>
            <DialogDescription>修改用户名，或设置新密码。留空的密码不会发生变化。</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="runtime-user-name">用户名</FieldLabel>
              <Input id="runtime-user-name" aria-label="用户名" value={editUsername} onChange={(event) => setEditUsername(event.currentTarget.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="runtime-user-password">新密码</FieldLabel>
              <Input id="runtime-user-password" aria-label="新密码" type="password" autoComplete="new-password" value={editPassword} onChange={(event) => setEditPassword(event.currentTarget.value)} />
              <FieldDescription>不需要重置密码时保持为空。</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingUser(null)}>取消</Button>
            <Button disabled={!editUsername.trim() || busyAction === "edit-user"} onClick={() => void saveUser()}>
              {busyAction === "edit-user" ? "正在保存…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={roleChange !== null} onOpenChange={(open) => { if (!open) setRoleChange(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认修改用户角色</DialogTitle>
            <DialogDescription>
              将“{roleChange?.user.username ?? ""}”设为{roleChange?.role === "admin" ? "管理员" : "普通用户"}。
              管理员可以访问用户、设备和实例级设置。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleChange(null)}>取消</Button>
            <Button disabled={busyAction === "change-role"} onClick={() => void confirmRoleChange()}>
              {busyAction === "change-role" ? "正在更新…" : "确认修改"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deletingUser !== null} onOpenChange={(open) => { if (!open) setDeletingUser(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除用户</DialogTitle>
            <DialogDescription>删除“{deletingUser?.username ?? ""}”及其账户访问权限。此操作无法撤销。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingUser(null)}>取消</Button>
            <Button variant="destructive" disabled={busyAction === "delete-user"} onClick={() => void confirmDelete()}>
              {busyAction === "delete-user" ? "正在删除…" : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
