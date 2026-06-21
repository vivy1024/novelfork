import { MessageSquareText } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

import { SectionLayout } from "../components/layouts";
import { toShellPath } from "../shell";
import { SessionCenter } from "../../components/sessions/SessionCenter";
import type { NarratorSessionRecord } from "../../shared/session-types";

export function SessionCenterPage() {
  const routerNavigate = useNavigate();
  const openSession = (session: NarratorSessionRecord) => {
    void routerNavigate({ to: toShellPath({ kind: "narrator", sessionId: session.id }) });
  };

  return (
    <SectionLayout
      title="会话中心"
      description="管理独立对话。书籍内的对话在工作台右侧面板管理。"
      actions={<MessageSquareText className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
    >
      <SessionCenter onOpenSession={openSession} initialBinding="standalone" />
    </SectionLayout>
  );
}
