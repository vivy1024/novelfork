import { useState } from "react";
import { Pencil, Save, X } from "lucide-react";

import { PageEmptyState } from "@/components/layout/PageEmptyState";
import { PageScaffold } from "@/components/layout/PageScaffold";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchJson, useApi } from "../hooks/use-api";
import { notify } from "@/lib/notify";
import { useColors } from "../hooks/use-colors";
import type { TFunction } from "../hooks/use-i18n";
import type { Theme } from "../hooks/use-theme";

interface TruthFile {
  readonly name: string;
  readonly size: number;
  readonly preview: string;
}

interface Nav {
  toBook: (id: string) => void;
  toDashboard: () => void;
}

export function TruthFiles({ bookId, nav, theme, t }: { bookId: string; nav: Nav; theme: Theme; t: TFunction }) {
  const c = useColors(theme);
  const { data } = useApi<{ files: ReadonlyArray<TruthFile> }>(`/books/${bookId}/truth`);
  const [selected, setSelected] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const { data: fileData, refetch: refetchFile } = useApi<{ file: string; content: string | null }>(
    selected ? `/books/${bookId}/truth/${selected}` : "",
  );

  const startEdit = () => {
    setEditText(fileData?.content ?? "");
    setEditMode(true);
  };

  const cancelEdit = () => {
    setEditMode(false);
  };

  const handleSaveEdit = async () => {
    if (!selected) return;
    setSavingEdit(true);
    try {
      await fetchJson(`/books/${bookId}/truth/${selected}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editText }),
      });
      setEditMode(false);
      refetchFile();
    } catch (e) {
      notify.error("保存失败", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSavingEdit(false);
    }
  };

  const selectedLabel = data?.files.find((file) => file.name === selected)?.name ?? selected ?? t("truth.selectFile");

  return (
    <PageScaffold
      title={t("truth.title")}
      description="左侧切换真相文件，右侧查看预览并直接修订内容。"
      actions={
        <>
          <Button variant="outline" onClick={nav.toDashboard}>返回书单</Button>
          <Button variant="outline" onClick={() => nav.toBook(bookId)}>返回书籍</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <Card className={c.cardStatic}>
          <CardHeader className="space-y-1 pb-3">
            <CardTitle className="text-lg">文件列表</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 p-0">
            {data?.files.map((f) => (
              <button
                key={f.name}
                onClick={() => {
                  setSelected(f.name);
                  setEditMode(false);
                }}
                className={`w-full border-b border-border/40 px-4 py-3 text-left text-sm transition-colors last:border-b-0 ${
                  selected === f.name ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                }`}
              >
                <div className="truncate font-mono text-sm">{f.name}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{f.size.toLocaleString()} {t("truth.chars")}</div>
              </button>
            ))}
            {(!data?.files || data.files.length === 0) && (
              <div className="p-4">
                <PageEmptyState
                  title={t("truth.empty")}
                  description="当前书籍还没有可用的 truth 文件，等系统生成后会显示在这里。"
                  icon={Pencil}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card className={c.cardStatic}>
          <CardHeader className="space-y-1 pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-lg">{selectedLabel}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">{t("truth.title")}</p>
              </div>
              {selected && fileData?.content != null && !editMode && (
                <Button variant="outline" onClick={startEdit}>
                  <Pencil className="mr-2 size-4" />
                  Edit
                </Button>
              )}
              {editMode && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={cancelEdit}>
                    <X className="mr-2 size-4" />
                    Cancel
                  </Button>
                  <Button onClick={handleSaveEdit} disabled={savingEdit}>
                    <Save className="mr-2 size-4" />
                    {savingEdit ? t("truth.saving") : t("truth.save")}
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="min-h-[420px]">
            {selected && fileData?.content != null ? (
              editMode ? (
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className={`${c.input} min-h-[360px] w-full resize-none rounded-xl p-3 font-mono text-sm leading-relaxed`}
                />
              ) : (
                <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground/80">{fileData.content}</pre>
              )
            ) : selected && fileData?.content === null ? (
              <PageEmptyState
                title={t("truth.notFound")}
                description="后端返回了空内容，可能是白名单未配置或文件尚未生成。"
                icon={Pencil}
              />
            ) : (
              <PageEmptyState
                title={t("truth.selectFile")}
                description="先从左侧选择一个真相文件，再查看预览或切换到编辑模式。"
                icon={Pencil}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </PageScaffold>
  );
}
