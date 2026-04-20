import { useState } from "react";
import { LayoutGrid, MessagesSquare, MonitorSmartphone, PlusCircle } from "lucide-react";

import { ChatWindowManager } from "@/components/ChatWindowManager";
import { PageScaffold } from "@/components/layout/PageScaffold";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewSessionDialog, type NewSessionPayload } from "@/components/sessions/NewSessionDialog";
import { useWindowStore } from "@/stores/windowStore";
import type { Theme } from "../hooks/use-theme";

export function SessionCenter({ theme }: { theme: Theme }) {
  const windows = useWindowStore((state) => state.windows);
  const addWindow = useWindowStore((state) => state.addWindow);
  const connected = windows.filter((window) => window.wsConnected).length;
  const minimized = windows.filter((window) => window.minimized).length;
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleCreateSession = (payload: NewSessionPayload) => {
    addWindow(payload.agentId, payload.title);
  };

  return (
    <>
      <PageScaffold
        title="会话中心"
        description="把原来的多窗口对话正式抬升成一级导航入口。现在已经把 prompt 式创建替换成结构化表单，后续继续补会话列表、筛选、归档和详情视图。"
        actions={
          <>
            <Badge variant="secondary">一级入口</Badge>
            <Badge variant="outline">会话对象化</Badge>
            <Button onClick={() => setDialogOpen(true)}>
              <PlusCircle className="size-4" />
              新建会话
            </Button>
          </>
        }
        contentClassName="space-y-4"
      >
        <div className="grid gap-4 md:grid-cols-3">
          <SessionStat
            title="活跃窗口"
            value={String(windows.length)}
            description="当前保存在本地的会话窗口"
            icon={MessagesSquare}
          />
          <SessionStat
            title="在线连接"
            value={String(connected)}
            description="与后端保持连接的窗口数"
            icon={MonitorSmartphone}
          />
          <SessionStat
            title="最小化"
            value={String(minimized)}
            description="已折叠、等待继续处理的窗口"
            icon={LayoutGrid}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PlusCircle className="size-5 text-primary" />
              会话工作台
            </CardTitle>
            <CardDescription>
              多窗口布局继续保留，但入口已经从 prompt 改成结构化 shadcn 表单；创建时可以先选常用 Agent 模板，再补充标题与自定义 Agent ID。
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[720px]">
            <ChatWindowManager theme={theme} onCreateWindow={() => setDialogOpen(true)} />
          </CardContent>
        </Card>
      </PageScaffold>

      <NewSessionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreate={handleCreateSession}
      />
    </>
  );
}

function SessionStat({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: string;
  value: string;
  description: string;
  icon: typeof MessagesSquare;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          {title}
        </CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-xs text-muted-foreground">{description}</CardContent>
    </Card>
  );
}
