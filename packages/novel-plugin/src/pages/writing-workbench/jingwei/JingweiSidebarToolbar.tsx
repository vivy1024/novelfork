import { useState, useCallback } from "react";
import { Eye, X, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/hooks/use-api";
import { getCategorySchema } from "./category-schemas";

interface JingweiSidebarToolbarProps {
  bookId: string;
  /** 导入或其它写操作成功后的回调（刷新侧栏树） */
  onChanged?: () => void;
}

/**
 * 经纬侧栏工具条：导入（Markdown 按 ## 拆分）+ AI 注入预览。
 * 从 JingweiPanel 迁入，避免为这两个入口保留整套分类栏/列表 UI。
 */
export function JingweiSidebarToolbar({ bookId, onChanged }: JingweiSidebarToolbarProps) {
  const [showImport, setShowImport] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  return (
    <div className="shrink-0 border-b border-border">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <Button size="xs" variant="outline" onClick={() => { setShowPreview(false); setShowImport((v) => !v); }} className="h-6 text-xs gap-1">
          <Upload className="size-3" />导入
        </Button>
        <Button size="xs" variant="outline" onClick={() => { setShowImport(false); setShowPreview((v) => !v); }} className="h-6 text-xs gap-1">
          <Eye className="size-3" />AI 注入预览
        </Button>
      </div>
      {showImport && (
        <ImportPanel bookId={bookId} onClose={() => setShowImport(false)} onImported={() => { setShowImport(false); onChanged?.(); }} />
      )}
      {showPreview && (
        <InjectionPreview bookId={bookId} onClose={() => setShowPreview(false)} />
      )}
    </div>
  );
}

function ImportPanel({ bookId, onClose, onImported }: { bookId: string; onClose: () => void; onImported: () => void }) {
  const [text, setText] = useState("");
  const [category, setCategory] = useState("world-model");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleImport = async () => {
    if (!text.trim() || importing) return;
    setImporting(true);
    const entries: Array<{ title: string; contentMd: string; category: string }> = [];
    const sections = text.split(/^## /m).filter(Boolean);
    for (const section of sections) {
      const lines = section.split("\n");
      const title = lines[0]?.trim() ?? "未命名";
      const contentMd = lines.slice(1).join("\n").trim();
      if (contentMd) entries.push({ title, contentMd, category });
    }
    if (entries.length === 0) entries.push({ title: "导入内容", contentMd: text.trim(), category });
    try {
      const data = await fetchJson<{ imported: number }>(
        `/api/books/${encodeURIComponent(bookId)}/jingwei/import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries }),
        },
      );
      setResult(`成功导入 ${data.imported} 条经纬条目`);
      setTimeout(onImported, 500);
    } catch {
      setResult("导入失败");
    }
    setImporting(false);
  };

  return (
    <div className="flex flex-col gap-2 border-t border-border p-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">导入经纬</span>
        <Button size="xs" variant="ghost" onClick={onClose}><X className="size-3" /></Button>
      </div>
      <p className="text-[10px] text-muted-foreground">粘贴 Markdown，按 ## 标题拆分为多条条目。</p>
      <select className="h-7 text-xs border rounded px-2 bg-background" value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="world-model">世界模型</option>
        <option value="characters">角色</option>
        <option value="power-system">力量体系</option>
        <option value="rules">规则</option>
        <option value="factions">势力</option>
        <option value="locations">地点</option>
        <option value="props">物品</option>
        <option value="timeline">时间线</option>
      </select>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-h-24 font-mono text-xs"
        placeholder={"## 条目标题1\n内容...\n\n## 条目标题2\n内容..."}
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleImport} disabled={importing || !text.trim()}>
          {importing ? "导入中…" : "导入"}
        </Button>
        {result && <span className="text-xs text-green-600">{result}</span>}
      </div>
    </div>
  );
}

function InjectionPreview({ bookId, onClose }: { bookId: string; onClose: () => void }) {
  const [chapterNumber, setChapterNumber] = useState(1);
  const [content, setContent] = useState<string | null>(null);

  const fetchPreview = useCallback(async (chapterNum: number) => {
    setContent(null);
    try {
      const data = await fetchJson<{ preview?: string; context?: string }>(
        `/api/books/${encodeURIComponent(bookId)}/jingwei/injection-preview?chapterNumber=${chapterNum}`,
      );
      setContent(data.preview ?? data.context ?? JSON.stringify(data, null, 2));
    } catch {
      setContent("加载预览失败");
    }
  }, [bookId]);

  return (
    <div className="border-t border-border p-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-muted-foreground">AI 注入预览</span>
        <Button size="xs" variant="ghost" onClick={onClose} className="h-5 w-5 p-0"><X className="size-3" /></Button>
      </div>
      <div className="flex items-center gap-1 mt-1">
        <span className="text-[10px] text-muted-foreground">第</span>
        <input
          type="number"
          min={1}
          value={chapterNumber}
          onChange={(e) => {
            const num = Math.max(1, parseInt(e.target.value, 10) || 1);
            setChapterNumber(num);
            void fetchPreview(num);
          }}
          className="w-10 rounded border border-input bg-transparent px-1 text-center text-[10px] font-mono outline-none"
        />
        <span className="text-[10px] text-muted-foreground">章视角</span>
        {content === null && chapterNumber > 0 && (
          <Button size="xs" variant="outline" onClick={() => void fetchPreview(chapterNumber)} className="h-5 text-[10px]">加载</Button>
        )}
      </div>
      {content !== null && (
        <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap text-[10px] font-mono text-muted-foreground">{content}</pre>
      )}
    </div>
  );
}
