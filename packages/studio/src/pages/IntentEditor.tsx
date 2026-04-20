import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Compass, Crosshair, Save } from "lucide-react";

import { PageScaffold } from "@/components/layout/PageScaffold";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchJson } from "../hooks/use-api";
import { useColors } from "../hooks/use-colors";
import type { TFunction } from "../hooks/use-i18n";
import type { Theme } from "../hooks/use-theme";

interface Nav {
  toBook: (id: string) => void;
  toDashboard: () => void;
}

interface TruthFileResponse {
  readonly file: string;
  readonly content: string | null;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

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
  const contentRef = useRef(content);
  contentRef.current = content;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  const save = useCallback(
    async (text: string) => {
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
    },
    [bookId, fileName],
  );

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
        if (msg.includes("400") || msg.toLowerCase().includes("not allowed") || msg.toLowerCase().includes("not found")) {
          setLoadError(`该文件 (${fileName}) 暂未被后端支持，请联系管理员将其加入 truth files 白名单。`);
        } else {
          setLoadError(msg);
        }
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bookId, fileName]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleChange = (value: string) => {
    setContent(value);
    dirtyRef.current = true;
    setStatus("idle");

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void save(value);
    }, 3000);
  };

  const handleManualSave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    void save(contentRef.current);
  };

  const statusLabel = (): { text: string; className: string } => {
    switch (status) {
      case "saving":
        return { text: "保存中…", className: "text-amber-500" };
      case "saved":
        return { text: "已保存", className: "text-emerald-500" };
      case "error":
        return { text: "保存失败", className: "text-destructive" };
      default:
        return dirtyRef.current ? { text: "未保存", className: "text-muted-foreground" } : { text: "", className: "" };
    }
  };

  const st = statusLabel();

  if (loading) {
    return (
      <Card className={c.cardStatic}>
        <CardContent className="flex min-h-[400px] items-center justify-center p-5 text-sm text-muted-foreground">
          加载中…
        </CardContent>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card className={`${c.cardStatic} border-amber-500/20 bg-amber-500/5`}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            {icon}
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <span>{loadError}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={c.cardStatic}>
      <CardHeader className="space-y-1 pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            {icon}
            {title}
          </CardTitle>
          <div className="flex items-center gap-3">
            {st.text && <span className={`text-xs ${st.className}`}>{st.text}</span>}
            <Button size="sm" onClick={handleManualSave} disabled={status === "saving"}>
              <Save className="mr-2 size-4" />
              保存
            </Button>
          </div>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <textarea
          value={content}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={`在此编写 ${title}…`}
          className={`${c.input} min-h-[320px] w-full resize-none rounded-xl p-3 font-mono text-sm leading-relaxed`}
        />
      </CardContent>
    </Card>
  );
}

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
    <PageScaffold
      title="写作意图与当前焦点"
      description="把作者意图和当前写作焦点拆成两个可独立维护的文件，便于随时校准故事方向。"
      actions={
        <>
          <Button variant="outline" onClick={nav.toDashboard}>{t("bread.books")}</Button>
          <Button variant="outline" onClick={() => nav.toBook(bookId)}>返回书籍</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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
    </PageScaffold>
  );
}
