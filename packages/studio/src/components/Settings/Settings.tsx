import { useState, useEffect, Suspense, lazy } from "react";
import { X } from "lucide-react";

type Tab = "status" | "config" | "usage";

interface SettingsProps {
  onClose: () => void;
  theme: "light" | "dark";
}

const Config = lazy(() => import("./Config").then(m => ({ default: m.Config })));
const Status = lazy(() => import("./Status").then(m => ({ default: m.Status })));
const Usage = lazy(() => import("./Usage").then(m => ({ default: m.Usage })));

export function Settings({ onClose, theme }: SettingsProps) {
  const [activeTab, setActiveTab] = useState<Tab>("config");
  const contentHeight = 600;

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background rounded-lg shadow-2xl border border-border w-full max-w-4xl" style={{ height: contentHeight + 100 }}>
        {/* Header */}
        <div className="h-14 flex items-center justify-between px-6 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">设置</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-secondary rounded transition-colors"
            aria-label="关闭"
          >
            <X size={20} className="text-muted-foreground" />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="h-12 flex items-center px-6 border-b border-border bg-background/50">
          {(["status", "config", "usage"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "text-primary border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "status" && "状态"}
              {tab === "config" && "配置"}
              {tab === "usage" && "使用统计"}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="overflow-y-auto" style={{ height: contentHeight }}>
          <Suspense fallback={<div className="p-6 text-muted-foreground">加载中...</div>}>
            {activeTab === "status" && <Status theme={theme} />}
            {activeTab === "config" && <Config theme={theme} />}
            {activeTab === "usage" && <Usage theme={theme} />}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
