/**
 * 画布明暗跟随 Studio：Studio 在 <html> 上切换 `dark` 类，React Flow 的 colorMode 据此同步。
 */

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  if (typeof MutationObserver === "undefined" || typeof document === "undefined") return () => undefined;
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function snapshot(): "dark" | "light" {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function useCanvasColorMode(): "dark" | "light" {
  return useSyncExternalStore(subscribe, snapshot, () => "light");
}
