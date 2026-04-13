import { useState, useEffect, useRef, useCallback } from "react";
import { fetchJson } from "../hooks/use-api";
import type { Theme } from "../hooks/use-theme";
import type { TFunction } from "../hooks/use-i18n";
import { useColors } from "../hooks/use-colors";
import { Compass, Crosshair, Save, AlertTriangle } from "lucide-react";

// --- 类型定义 ---

interface Nav {
  toBook: (id: string) => void;
  toDashboard: () => void;
}

interface TruthFileResponse {
  readonly file: string;
  readonly content: string | null;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

// --- 单文件编辑面板 ---

function FilePanel({
  bookId,
  fileName,
  title,
  description,
  icon,
  c,
}: {
  bookId: string;
  fileName: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  c: ReturnType<typeof useColors>;
}) {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // 用于跟踪最新内容，避免闭包过期
  const contentRef = useRef(content);
  contentRef.current = content;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 标记是否有过用户编辑（区分初始加载和用户修改）
  const dirtyRef = useRef(false);

  // 保存逻辑
  const save = useCallback(async (text: string) => {
    setStatus("saving");
    try {
      await fetchJson(`/books/${bookId}/truth/${fileName}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      setStatus("saved");
      dirtyRef.current = false;
    } catch {
      setStatus("error");
    }
  }, [bookId, fileName]);

  // 加载文件内容
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    fetchJson<TruthFileResponse>(`/books/${bookId}/truth/${fileName}`)
      .then((data) => {
        if (cancelled) return;
        setContent(data.content ?? "");
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        // 400 表示文件名不在白名单，显示友好提示
        if (msg.includes("400") || msg.toLowerCase().includes("not allowed") || msg.toLowerCase().includes("not found")) {
          setLoadError(`该文件 (${fileName}) 暂未被后端支持，请联系管理员将其加入 truth files 白名单。`);
        } else {
          setLoadError(msg);
        }
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [bookId, fileName]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // 文本变更：标记 dirty + 启动 debounce 自动保存
  const handleChange = (value: string) => {
    setContent(value);
    dirtyRef.current = true;
    setStatus("idle");

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void save(value);
    }, 3000);
  };

  // 手动保存
  const handleManualSave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    void save(contentRef.current);
  };

  // 状态指示器文案和样式
  const statusLabel = (): { text: string; className: string } => {
    switch (status) {
      case "saving": return { text: "保存中…", className: "text-amber-500" };
      case "saved":  return { text: "已保存", className: "text-emerald-500" };
      case "error":  return { text: "保存失败", className: "text-destructive" };
      default:       return dirtyRef.current
        ? { text: "未保存", className: "text-muted-foreground" }
        : { text: "", className: "" };
    }
  };

  const st = statusLabel();

  // 加载中
  if (loading) {
    return (
      <div className={`border ${c.cardStatic} rounded-lg p-5 flex-1 min-h-[400px] flex items-center justify-center`}>
        <span className="text-muted-foreground text-sm">加载中…</span>
      </div>
    );
  }

  // 后端不支持该文件
  if (loadError) {
    return (
      <div className={`border ${c.cardStatic} rounded-lg p-5 flex-1 min-h-[400px] flex flex-col`}>
        <div className="flex items-center gap-2 mb-3">
          {icon}
          <h2 className="font-semibold text-lg">{title}</h2>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-start gap-3 max-w-md text-sm bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30 rounded-lg p-4">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <span>{loadError}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`border ${c.cardStatic} rounded-lg p-5 flex-1 min-h-[400px] flex flex-col`}>
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="font-semibold text-lg">{title}</h2>
        </div>
        <div className="flex items-center gap-3">
          {st.text && <span className={`text-xs ${st.className}`}>{st.text}</span>}
          <button
            onClick={handleManualSave}
            disabled={status === "saving"}
            className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md ${c.btnPrimary} disabled:opacity-50`}
          >
            <Save size={14} />
            保存
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-3">{description}</p>

      {/* 编辑器 */}
      <textarea
        value={content}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={`在此编写 ${title}…`}
        className={`${c.input} flex-1 rounded-md p-3 text-sm font-mono leading-relaxed resize-none min-h-[300px]`}
      />
    </div>
  );
}

// --- 主组件 ---

export function IntentEditor({
  bookId,
  nav,
  theme,
  t,
}: {
  bookId: string;
  nav: Nav;
  theme: Theme;
  t: TFunction;
}) {
  const c = useColors(theme);

  return (
    <div className="space-y-6">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button onClick={nav.toDashboard} className={c.link}>
          {t("bread.home")}
        </button>
        <span className="text-border">/</span>
        <button onClick={() => nav.toBook(bookId)} className={c.link}>
          {bookId}
        </button>
        <span className="text-border">/</span>
        <span className="text-foreground">写作意图</span>
      </div>

      <h1 className="font-serif text-3xl flex items-center gap-3">
        <Compass size={28} className="text-primary" />
        写作意图与当前焦点
      </h1>

      {/* 双栏编辑区 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <FilePanel
          bookId={bookId}
          fileName="author_intent.md"
          title="Author Intent"
          description="作者对故事走向的高层意图：主题、核心冲突、情感基调、最终愿景。"
          icon={<Compass size={18} className="text-primary" />}
          c={c}
        />
        <FilePanel
          bookId={bookId}
          fileName="current_focus.md"
          title="Current Focus"
          description="当前写作阶段的具体关注点：正在推进的情节线、待解决的问题、近期目标。"
          icon={<Crosshair size={18} className="text-primary" />}
          c={c}
        />
      </div>
    </div>
  );
}
