import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./app-next/router";
import { StudioNextApp } from "./app-next";
import { RuntimeAuthGate } from "./app-next/p0/RuntimeAuthGate";
import { installRuntimeAuthenticatedFetch } from "./app-next/runtime/auth";
import { RuntimeLocaleDocumentSync } from "./app-next/runtime/locale";
import { initTheme } from "./hooks/use-theme";

// Apply stored theme immediately to prevent flash and route every retained
// NovelFork same-origin API call through Runtime authentication.
initTheme();
installRuntimeAuthenticatedFetch();

// TanStack Router 接管 URL 监听与导航。
// StudioNextApp 作为 defaultComponent 渲染，内部通过 useRouterState/useNavigate 与 router 交互。
// rootRoute 不设 component 以避免 router.ts ↔ StudioNextApp 循环依赖。

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RuntimeAuthGate>
      <RuntimeLocaleDocumentSync />
      <RouterProvider router={router} defaultComponent={StudioNextApp} />
    </RuntimeAuthGate>
  </StrictMode>,
);
