/**
 * 用户管理标签页
 */

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { UnsupportedCapability } from "@/components/runtime/UnsupportedCapability";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson } from "../../hooks/use-api";
import type { RuntimeCapabilityStatus } from "../../lib/runtime-capabilities";

interface User {
  id: string;
  username: string;
  email: string;
  role: "admin" | "user";
  createdAt: string | Date;
  lastLogin: string | Date;
}

interface UserManagementState {
  code: "unsupported";
  capability: string;
  status: RuntimeCapabilityStatus;
  reason?: string;
}

interface UsersResponse {
  users: User[];
  mode?: "local-single-user";
  userManagement?: UserManagementState;
}

const LOCAL_SINGLE_USER_REASON = "当前是本地单用户工具，用户管理 CRUD 尚未接入持久化用户系统。";

export function UsersTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [mode, setMode] = useState<UsersResponse["mode"]>();
  const [userManagement, setUserManagement] = useState<UserManagementState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const data = await fetchJson<UsersResponse>("/api/admin/users");
      setUsers(data.users);
      setMode(data.mode);
      setUserManagement(data.userManagement ?? null);
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

  const isLocalSingleUser = mode === "local-single-user";
  const crudDisabled = userManagement?.code === "unsupported";
  const unsupportedReason = userManagement?.reason ?? LOCAL_SINGLE_USER_REASON;

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
            {isLocalSingleUser && <Badge variant="outline">本地单用户模式</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {isLocalSingleUser ? "当前不启用多用户账号系统，用户 CRUD 仅作为透明占位展示。" : "统一查看账号、角色和最后登录时间。"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void loadUsers()} disabled={refreshing}>
            {refreshing ? "刷新中..." : "刷新"}
          </Button>
          <Button disabled={crudDisabled} title={crudDisabled ? unsupportedReason : undefined}>
            <Plus className="size-4" />
            添加用户{crudDisabled ? "（未接入）" : ""}
          </Button>
        </div>
      </div>

      {crudDisabled && (
        <UnsupportedCapability
          title="本地单用户模式"
          reason={unsupportedReason}
          status={userManagement?.status ?? "planned"}
          capability={userManagement?.capability ?? "admin.users.crud"}
        />
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard title="用户总数" value={String(summary.total)} description="当前持久化用户系统接入的账号数" />
        <SummaryCard title="管理员" value={String(summary.adminCount)} description="拥有管理权限的账号" />
        <SummaryCard title="普通用户" value={String(summary.userCount)} description="非管理员账号" />
      </div>

      <Card>
        <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>用户列表</CardTitle>
            <CardDescription>
              {isLocalSingleUser ? "本地单用户阶段不展示伪造账号；接入持久化用户系统后再启用列表与 CRUD。" : "统一查看账号、邮箱、角色和登录时间。"}
            </CardDescription>
          </div>
          <Badge variant="outline">{summary.total} 人</Badge>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <PageEmptyState
              title={isLocalSingleUser ? "多用户管理未接入" : "暂无用户"}
              description={isLocalSingleUser ? "当前为本地单用户模式，不创建内存用户、不提供添加/编辑/删除假成功。" : "接入持久化用户系统后，这里会显示账号、角色和最近登录时间。"}
              action={<Button disabled={crudDisabled}>添加用户{crudDisabled ? "（未接入）" : ""}</Button>}
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
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
