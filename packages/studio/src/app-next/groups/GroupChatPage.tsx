import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  chatGroupsClient,
  type ChatGroupDetail,
  type ChatGroupMessage,
  type ChatGroupSummary,
} from "../runtime-admin/chat-groups";

const MESSAGE_PAGE_SIZE = 50;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function groupTitle(group: { readonly title: string | null; readonly id: string }): string {
  return group.title?.trim() || `未命名群组 · ${group.id.slice(0, 8)}`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN");
}

function mergeMessages(
  current: readonly ChatGroupMessage[],
  incoming: readonly ChatGroupMessage[],
): ChatGroupMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function GroupChatPage() {
  const [groups, setGroups] = useState<readonly ChatGroupSummary[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChatGroupDetail | null>(null);
  const [messages, setMessages] = useState<readonly ChatGroupMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [originNarratorId, setOriginNarratorId] = useState("");
  const [newGroupTitle, setNewGroupTitle] = useState("");
  const [memberHandle, setMemberHandle] = useState("");
  const [draft, setDraft] = useState("");

  const loadGroups = useCallback(async (preferredGroupId?: string) => {
    setGroupsLoading(true);
    setGroupsError(null);
    try {
      const result = await chatGroupsClient.listGroups();
      setGroups(result.groups);
      setSelectedGroupId((current) => {
        if (preferredGroupId && result.groups.some((group) => group.id === preferredGroupId)) {
          return preferredGroupId;
        }
        if (current && result.groups.some((group) => group.id === current)) return current;
        return result.groups[0]?.id ?? null;
      });
    } catch (error) {
      setGroupsError(errorMessage(error));
    } finally {
      setGroupsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    if (!selectedGroupId) {
      setDetail(null);
      setMessages([]);
      setNextCursor(null);
      setConversationError(null);
      setConversationLoading(false);
      return;
    }

    let cancelled = false;
    setConversationLoading(true);
    setConversationError(null);
    setActionError(null);
    void Promise.all([
      chatGroupsClient.getGroup(selectedGroupId),
      chatGroupsClient.listMessages(selectedGroupId, { limit: MESSAGE_PAGE_SIZE }),
    ]).then(([nextDetail, messagePage]) => {
      if (cancelled) return;
      setDetail(nextDetail);
      setMessages(messagePage.messages);
      setNextCursor(messagePage.nextCursor);
    }).catch((error: unknown) => {
      if (!cancelled) setConversationError(errorMessage(error));
    }).finally(() => {
      if (!cancelled) setConversationLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedGroupId]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const narratorId = originNarratorId.trim();
    if (!narratorId) return;

    setActionPending(true);
    setActionError(null);
    try {
      const created = await chatGroupsClient.createGroup({
        originNarratorId: narratorId,
        ...(newGroupTitle.trim() ? { title: newGroupTitle.trim() } : {}),
      });
      setCreateOpen(false);
      setOriginNarratorId("");
      setNewGroupTitle("");
      await loadGroups(created.id);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setActionPending(false);
    }
  }

  async function handleAddMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedGroupId) return;
    const handle = memberHandle.trim().replace(/^@/, "");
    if (!handle) return;

    setActionPending(true);
    setActionError(null);
    try {
      await chatGroupsClient.addMember(selectedGroupId, handle);
      const refreshed = await chatGroupsClient.getGroup(selectedGroupId);
      setDetail(refreshed);
      setMemberHandle("");
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setActionPending(false);
    }
  }

  async function handleSend(urgent: boolean) {
    if (!selectedGroupId) return;
    const content = draft.trim();
    if (!content) return;

    setActionPending(true);
    setActionError(null);
    try {
      await chatGroupsClient.sendMessage(selectedGroupId, content, urgent);
      const refreshed = await chatGroupsClient.listMessages(selectedGroupId, { limit: MESSAGE_PAGE_SIZE });
      setMessages(refreshed.messages);
      setNextCursor(refreshed.nextCursor);
      setDraft("");
      await loadGroups(selectedGroupId);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setActionPending(false);
    }
  }

  async function handleLoadMore() {
    if (!selectedGroupId || !nextCursor) return;
    setLoadingMore(true);
    setActionError(null);
    try {
      const page = await chatGroupsClient.listMessages(selectedGroupId, {
        cursor: nextCursor,
        limit: MESSAGE_PAGE_SIZE,
      });
      setMessages((current) => mergeMessages(current, page.messages));
      setNextCursor(page.nextCursor);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">群组聊天</h1>
          <p className="text-sm text-muted-foreground">查看可访问群组，与 Runtime 叙述者成员协作。</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>创建群组</Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              <DialogHeader>
                <DialogTitle>创建群组</DialogTitle>
                <DialogDescription>指定发起群组的 Runtime 叙述者 ID，并可添加标题。</DialogDescription>
              </DialogHeader>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="group-origin-narrator">发起叙述者 ID</FieldLabel>
                  <Input
                    id="group-origin-narrator"
                    value={originNarratorId}
                    onChange={(event) => setOriginNarratorId(event.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="group-title">标题</FieldLabel>
                  <Input
                    id="group-title"
                    value={newGroupTitle}
                    onChange={(event) => setNewGroupTitle(event.target.value)}
                    maxLength={200}
                  />
                </Field>
              </FieldGroup>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
                <Button type="submit" disabled={actionPending || !originNarratorId.trim()}>创建</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {groupsError ? (
        <Alert>
          <AlertTitle>群组列表加载失败</AlertTitle>
          <AlertDescription>{groupsError}</AlertDescription>
        </Alert>
      ) : null}
      {actionError ? (
        <Alert>
          <AlertTitle>操作失败</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(16rem,0.34fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>可访问群组</CardTitle>
            <CardDescription>列表由 Runtime 按最近更新时间返回。</CardDescription>
          </CardHeader>
          <CardContent>
            {groupsLoading ? (
              <div className="flex flex-col gap-3" aria-label="正在加载群组">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : groups.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>暂无可访问群组</EmptyTitle>
                  <EmptyDescription>创建群组后即可开始多人协作。</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>群组</TableHead>
                    <TableHead>成员</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((group) => (
                    <TableRow key={group.id} data-state={group.id === selectedGroupId ? "selected" : undefined}>
                      <TableCell>
                        <Button
                          variant="ghost"
                          className="max-w-48 justify-start truncate"
                          aria-current={group.id === selectedGroupId ? "true" : undefined}
                          onClick={() => setSelectedGroupId(group.id)}
                        >
                          {groupTitle(group)}
                        </Button>
                      </TableCell>
                      <TableCell><Badge variant="secondary">{group.memberCount}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
          <CardFooter>
            <Button variant="outline" size="sm" onClick={() => void loadGroups(selectedGroupId ?? undefined)} disabled={groupsLoading}>
              刷新列表
            </Button>
          </CardFooter>
        </Card>

        {!selectedGroupId ? (
          <Card>
            <CardHeader>
              <CardTitle>选择群组</CardTitle>
              <CardDescription>从列表选择一个群组查看成员与消息。</CardDescription>
            </CardHeader>
            <CardContent>
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>尚未选择群组</EmptyTitle>
                  <EmptyDescription>群组详情和消息将在这里显示。</EmptyDescription>
                </EmptyHeader>
              </Empty>
            </CardContent>
          </Card>
        ) : conversationLoading ? (
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-64" />
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        ) : conversationError || !detail ? (
          <Alert>
            <AlertTitle>群组详情加载失败</AlertTitle>
            <AlertDescription>{conversationError ?? "Runtime 未返回群组详情。"}</AlertDescription>
          </Alert>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{groupTitle(detail.group)}</CardTitle>
              <CardDescription>发起叙述者：{detail.group.originNarratorId ?? "已移除"}</CardDescription>
              <CardAction><Badge variant="outline">{detail.members.length} 位成员</Badge></CardAction>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="messages">
                <TabsList>
                  <TabsTrigger value="messages">消息</TabsTrigger>
                  <TabsTrigger value="members">成员</TabsTrigger>
                </TabsList>
                <TabsContent value="messages" className="flex flex-col gap-4 pt-2">
                  {nextCursor ? (
                    <Button variant="outline" size="sm" onClick={() => void handleLoadMore()} disabled={loadingMore}>
                      {loadingMore ? "正在加载..." : "加载更多"}
                    </Button>
                  ) : null}
                  {messages.length === 0 ? (
                    <Empty>
                      <EmptyHeader>
                        <EmptyTitle>暂无消息</EmptyTitle>
                        <EmptyDescription>发送第一条消息开始群组讨论。</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : (
                    <div className="flex flex-col gap-3" aria-label="群组消息">
                      {[...messages].reverse().map((message) => (
                        <Card key={message.id} size="sm">
                          <CardHeader>
                            <CardTitle>{message.senderLabel || message.senderType}</CardTitle>
                            <CardDescription>{formatTimestamp(message.createdAt)}</CardDescription>
                            {message.urgent ? <CardAction><Badge variant="destructive">紧急</Badge></CardAction> : null}
                          </CardHeader>
                          <CardContent className="whitespace-pre-wrap break-words">{message.content}</CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="group-message">发送消息</FieldLabel>
                      <Textarea
                        id="group-message"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        maxLength={8000}
                        rows={4}
                        placeholder="输入群组消息"
                      />
                    </Field>
                  </FieldGroup>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="outline" onClick={() => void handleSend(true)} disabled={actionPending || !draft.trim()}>
                      紧急发送
                    </Button>
                    <Button onClick={() => void handleSend(false)} disabled={actionPending || !draft.trim()}>
                      发送
                    </Button>
                  </div>
                </TabsContent>
                <TabsContent value="members" className="flex flex-col gap-4 pt-2">
                  <form onSubmit={handleAddMember}>
                    <FieldGroup>
                      <Field orientation="responsive">
                        <FieldLabel htmlFor="group-member-handle">添加 narrator 成员</FieldLabel>
                        <Input
                          id="group-member-handle"
                          value={memberHandle}
                          onChange={(event) => setMemberHandle(event.target.value)}
                          minLength={2}
                          maxLength={33}
                          placeholder="@handle"
                          required
                        />
                        <Button type="submit" disabled={actionPending || !memberHandle.trim()}>添加成员</Button>
                      </Field>
                    </FieldGroup>
                  </form>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>成员</TableHead>
                        <TableHead>角色</TableHead>
                        <TableHead>状态</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.members.map((member) => (
                        <TableRow key={member.id}>
                          <TableCell>
                            {member.memberType === "narrator"
                              ? `@${member.handle || member.title || member.narratorId || "narrator"}`
                              : "当前用户"}
                          </TableCell>
                          <TableCell><Badge variant="secondary">{member.role}</Badge></TableCell>
                          <TableCell>{member.status || (member.memberType === "user" ? "已加入" : "未知")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
