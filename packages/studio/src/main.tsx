import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./app-next/router";
import { StudioNextApp } from "./app-next";

// 阶段一：TanStack Router 接管 URL 监听，但渲染仍由 StudioNextApp 内部 switch 处理
// root route 没有 component，所以 RouterProvider 不渲染任何东西
// StudioNextApp 仍然用自己的 resolveStudioNextRoute + pushState 管理路由
// 后续阶段会逐步把 RouteMountPoint 中的路由迁移到 TanStack Router 的 route component

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} defaultComponent={StudioNextApp} />
  </StrictMode>,
);
