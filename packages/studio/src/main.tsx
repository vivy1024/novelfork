import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./app-next/router";
import { StudioNextApp } from "./app-next";
import { initTheme } from "./hooks/use-theme";

// Apply stored theme immediately to prevent flash
initTheme();

// TanStack Router 接管 URL 监听与导航。
// StudioNextApp 作为 defaultComponent 渲染，内部通过 useRouterState/useNavigate 与 router 交互。
// rootRoute 不设 component 以避免 router.ts ↔ StudioNextApp 循环依赖。

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} defaultComponent={StudioNextApp} />
  </StrictMode>,
);
