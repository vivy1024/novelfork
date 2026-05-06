import { MessageSquareText } from "lucide-react";

import { SectionLayout } from "../components/layouts";
import { toShellPath } from "../shell";
import { SessionCenter } from "../../components/sessions/SessionCenter";
import type { NarratorSessionRecord } from "../../shared/session-types";

export function SessionCenterPage() {
  const openSession = (session: NarratorSessionRecord) => {
    if (typeof window === "undefined" || !window.history?.pushState) return;
    window.history.pushState(null, "", toShellPath({ kind: "narrator", sessionId: session.id }));
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  return (
    <SectionLayout
      title="会话中心"
      description="按独立、书籍绑定、章节绑定和归档状态管理长期 Agent 会话，打开后复用现有会话恢复链。"
      actions={<MessageSquareText className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
    >
      <SessionCenter onOpenSession={openSession} />
    </SectionLayout>
  );
}
