import { MessageSquareText } from "lucide-react";

import { SectionLayout } from "../components/layouts";
import { SessionCenter } from "../../components/sessions/SessionCenter";
import type { NarratorSessionRecord } from "../../shared/session-types";
import { useWindowStore } from "../../stores/windowStore";

export function SessionCenterPage() {
  const windows = useWindowStore((state) => state.windows);
  const addWindow = useWindowStore((state) => state.addWindow);
  const updateWindow = useWindowStore((state) => state.updateWindow);
  const setActiveWindow = useWindowStore((state) => state.setActiveWindow);

  const openSession = (session: NarratorSessionRecord) => {
    const existingWindow = windows.find((window) => window.sessionId === session.id);
    if (existingWindow) {
      updateWindow(existingWindow.id, {
        title: session.title,
        agentId: session.agentId,
        sessionId: session.id,
        sessionMode: session.sessionMode,
        minimized: false,
      });
      setActiveWindow(existingWindow.id);
      return;
    }

    addWindow({
      title: session.title,
      agentId: session.agentId,
      sessionId: session.id,
      sessionMode: session.sessionMode,
    });
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
