import { useState, useEffect, useCallback } from "react";

interface ToastItem {
  id: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
}

let globalAddToast: ((message: string, type?: ToastItem["type"]) => void) | null = null;

/** 全局 toast 函数，任何地方都可以调用 */
export function toast(message: string, type: ToastItem["type"] = "info"): void {
  globalAddToast?.(message, type);
}

const TYPE_STYLES: Record<ToastItem["type"], string> = {
  info: "border-info/30 bg-info/10 text-info",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
};

/** Toast 容器组件 — 放在 App 根部 */
export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((message: string, type: ToastItem["type"] = "info") => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  useEffect(() => {
    globalAddToast = addToast;
    return () => { globalAddToast = null; };
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto rounded-lg border px-4 py-2.5 text-sm shadow-lg animate-in slide-in-from-top-2 fade-in duration-200 ${TYPE_STYLES[t.type]}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
