/**
 * Studio 当前实际生效的明暗（`auto` 已按系统解析）。
 *
 * 明暗由 use-theme 写在 <html> 的 `dark` 类上，这里只读那个类：各处（嵌入的 Runtime 界面、
 * React Flow 画布）都据此跟随，不各自再存一份明暗状态。
 */

import { useSyncExternalStore } from "react";

export type ColorScheme = "light" | "dark";

function subscribe(onChange: () => void): () => void {
  if (typeof MutationObserver === "undefined" || typeof document === "undefined") return () => undefined;
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function snapshot(): ColorScheme {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function useColorScheme(): ColorScheme {
  return useSyncExternalStore(subscribe, snapshot, () => "light");
}
