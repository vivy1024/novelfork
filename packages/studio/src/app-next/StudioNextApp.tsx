import { useCallback, useEffect, useState } from "react";

import { resolveStudioNextRoute, type StudioNextRoute } from "./entry";
import { AgentShell, toShellPath, useShellData, type ShellRoute } from "./shell";

interface StudioNextAppProps {
  readonly initialRoute?: StudioNextRoute;
}

function ShellPlaceholder({ title, description }: { readonly title: string; readonly description: string }) {
  return (
    <section className="flex h-full flex-1 flex-col p-6" data-testid="agent-shell-route">
      <p className="text-xs font-medium text-muted-foreground">NovelFork Next</p>
      <h1 className="mt-2 text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </section>
  );
}

function RouteMountPoint({ route }: { readonly route: ShellRoute }) {
  switch (route.kind) {
    case "narrator":
      return <ShellPlaceholder title="Agent Conversation 挂载点" description={`会话 ${route.sessionId} 已由 Shell 路由接管；实时连接将在后续批次接入。`} />;
    case "book":
      return <ShellPlaceholder title="Writing Workbench 挂载点" description={`书籍 ${route.bookId} 已由 Shell 路由接管；完整资源树与编辑器将在后续批次接入。`} />;
    case "search":
      return <ShellPlaceholder title="搜索" description="跨项目搜索入口已接入 Agent Shell，搜索运行时稍后接线。" />;
    case "routines":
      return <ShellPlaceholder title="套路" description="Routines 入口已接入 Agent Shell，配置面板稍后接线。" />;
    case "settings":
      return <ShellPlaceholder title="设置" description="设置入口已接入 Agent Shell，详细面板稍后接线。" />;
    case "home":
    default:
      return <ShellPlaceholder title="Agent Shell" description="选择左侧叙事线、叙述者或全局入口开始。" />;
  }
}

export function StudioNextApp({ initialRoute }: StudioNextAppProps) {
  const [activeRoute, setActiveRoute] = useState<StudioNextRoute>(() => initialRoute ?? resolveStudioNextRoute());
  const { books, sessions } = useShellData();

  const navigate = useCallback((route: ShellRoute) => {
    setActiveRoute(route);
    if (typeof window !== "undefined" && window.history?.pushState) {
      window.history.pushState(null, "", toShellPath(route));
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => setActiveRoute(resolveStudioNextRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <AgentShell route={activeRoute} books={books} sessions={sessions} onNavigate={navigate}>
      <RouteMountPoint route={activeRoute} />
    </AgentShell>
  );
}
