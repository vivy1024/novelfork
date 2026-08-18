/**
 * 角色与设定（Characters & Lore）侧栏面板。
 *
 * 彻底消除「经纬」和「叙事记忆」在前端的割裂感：
 * 1. 顶部保留「导入」与「AI 注入预览」快捷动作；
 * 2. 集中展示全书的角色册、世界观、势力、力量体系与设定词条；
 * 3. 点击任何角色条目直接弹出酒馆式多维卡片（静态档案 + 实时动态时态 + 羁绊网络）。
 */

import { useCallback, useState } from "react";
import { BookOpen, Eye, Plus, Sparkles, Upload, Users, UserRound, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson } from "@/hooks/use-api";
import { WorkbenchResourceTree, type ResourceTreeAction } from "../WorkbenchResourceTree";
import type { WorkbenchResourceNode } from "../useWorkbenchResources";

export interface CharactersAndLoreSidebarPanelProps {
  bookId: string;
  nodes: readonly WorkbenchResourceNode[];
  selectedNodeId: string | null;
  onOpen: (node: WorkbenchResourceNode) => void;
  onAction?: (action: ResourceTreeAction) => void;
  onChanged?: () => void;
}

export function CharactersAndLoreSidebarPanel({
  bookId,
  nodes,
  selectedNodeId,
  onOpen,
  onAction,
  onChanged,
}: CharactersAndLoreSidebarPanelProps) {
  const [showImport, setShowImport] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-card text-xs" data-testid="characters-and-lore-panel">
      {/* 顶部轻量工具条：导入设定 + AI 注入预览 */}
      <div className="shrink-0 flex items-center justify-between border-b border-border px-2 py-1.5 bg-muted/20">
        <div className="flex items-center gap-1">
          <Button
            size="xs"
            variant={showImport ? "secondary" : "outline"}
            onClick={() => { setShowPreview(false); setShowImport((v) => !v); }}
            className="h-6 text-xs gap-1"
          >
            <Upload className="size-3" />
            导入设定
          </Button>
          <Button
            size="xs"
            variant={showPreview ? "secondary" : "outline"}
            onClick={() => { setShowImport(false); setShowPreview((v) => !v); }}
            className="h-6 text-xs gap-1"
          >
            <Eye className="size-3" />
            AI 注入预览
          </Button>
        </div>
      </div>

      {showImport && (
        <ImportSection
          bookId={bookId}
          onClose={() => setShowImport(false)}
          onImported={() => {
            setShowImport(false);
            onChanged?.();
          }}
        />
      )}

      {showPreview && (
        <InjectionPreviewSection bookId={bookId} onClose={() => setShowPreview(false)} />
      )}

      {/* 角色与设定主树 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <WorkbenchResourceTree
          nodes={nodes}
          selectedNodeId={selectedNodeId}
          onOpen={onOpen}
          onAction={onAction}
          sortStorageKey={`novelfork:resource-tree-sort:${bookId}:characters-lore`}
        />
      </div>
    </div>
  );
}

function ImportSection({ bookId, onClose, onImported }: { bookId: string; onClose: () => void; onImported: () => void }) {
  const [text, setText] = useState("");
  const [category, setCategory] = useState("characters");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleImport = async () => {
    if (!text.trim() || importing) return;
    setImporting(true);
    setResult(null);

    const trimmed = text.trim();
    const entries: Array<{ title: string; contentMd: string; category: string }> = [];

    // 智能识别 1：酒馆角色卡 JSON (Character Card V2)
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        const data = (parsed.data && typeof parsed.data === "object" ? parsed.data : parsed) as Record<string, unknown>;
        const charName = typeof data.name === "string" ? data.name.trim() : "";
        if (charName) {
          const personality = typeof data.personality === "string" ? data.personality.trim() : "";
          const desc = typeof data.description === "string" ? data.description.trim() : "";
          const scenario = typeof data.scenario === "string" ? data.scenario.trim() : "";
          const mesExample = typeof data.mes_example === "string" ? data.mes_example.trim() : "";
          const firstMes = typeof data.first_mes === "string" ? data.first_mes.trim() : "";

          const sections = [
            desc ? `## 外貌与身份\n${desc}` : "",
            personality ? `## 性格与行事\n${personality}` : "",
            scenario ? `## 背景处境\n${scenario}` : "",
            firstMes ? `## 首发台词/开场\n${firstMes}` : "",
            mesExample ? `## 说话口癖与对话样例\n${mesExample.replace(/\{\{user\}\}/gi, "作者").replace(/\{\{char\}\}/gi, charName)}` : "",
          ].filter(Boolean);

          entries.push({
            title: charName,
            contentMd: sections.join("\n\n"),
            category: "characters",
          });
        }
      } catch {
        // 不是有效单角色 JSON，回退到普通文本解析
      }
    }

    // 智能识别 2：标准 Markdown 批量拆分
    if (entries.length === 0) {
      const sections = text.split(/^## /m).filter(Boolean);
      for (const section of sections) {
        const lines = section.split("\n");
        const title = lines[0]?.trim() ?? "未命名";
        const contentMd = lines.slice(1).join("\n").trim();
        if (contentMd) entries.push({ title, contentMd, category });
      }
      if (entries.length === 0) entries.push({ title: "导入设定", contentMd: text.trim(), category });
    }

    try {
      const data = await fetchJson<{ imported: number }>(
        `/api/books/${encodeURIComponent(bookId)}/jingwei/import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries }),
        },
      );
      setResult(`成功导入 ${data.imported} 条设定条目`);
      setTimeout(onImported, 600);
    } catch {
      setResult("导入失败，请检查格式");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-b border-border p-2.5 bg-muted/30">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">导入设定 / 酒馆角色卡</span>
        <Button size="xs" variant="ghost" onClick={onClose} className="h-5 w-5 p-0"><X className="size-3" /></Button>
      </div>
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        支持粘贴 Markdown（按 ## 拆分）或酒馆角色卡 JSON（自动转换为多维人物档案）。
      </p>
      <select
        className="h-7 text-xs border border-border rounded px-2 bg-background"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
      >
        <option value="characters">角色 (Characters)</option>
        <option value="factions">势力 / 门派 (Factions)</option>
        <option value="world-model">世界模型 (World)</option>
        <option value="power-system">力量体系 (Power System)</option>
        <option value="rules">法则规则 (Rules)</option>
        <option value="locations">地理场景 (Locations)</option>
        <option value="props">重要物品 (Props)</option>
        <option value="timeline">前史时间线 (Timeline)</option>
      </select>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-h-24 font-mono text-xs"
        placeholder={"粘贴 Markdown 文本，或酒馆角色卡 JSON（{\"name\": \"...\", \"personality\": \"...\"}）..."}
      />
      <div className="flex items-center justify-between pt-0.5">
        <span className="text-[10px] text-muted-foreground">
          {text.trim().startsWith("{") ? "检测到 JSON 格式，将智能解析角色卡" : "Markdown 格式"}
        </span>
        <div className="flex items-center gap-1.5">
          <Button size="xs" variant="ghost" onClick={onClose}>取消</Button>
          <Button size="xs" onClick={handleImport} disabled={importing || !text.trim()}>
            {importing ? "导入中…" : "开始导入"}
          </Button>
        </div>
      </div>
      {result && <p className="text-[11px] text-emerald-600 font-medium">{result}</p>}
    </div>
  );
}

function InjectionPreviewSection({ bookId, onClose }: { bookId: string; onClose: () => void }) {
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
    <div className="border-b border-border p-2.5 bg-muted/30">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">AI 设定注入预览</span>
        <Button size="xs" variant="ghost" onClick={onClose} className="h-5 w-5 p-0"><X className="size-3" /></Button>
      </div>
      <div className="flex items-center gap-1 mt-1.5">
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
          className="w-12 rounded border border-border bg-background px-1.5 text-center text-xs font-mono outline-none"
        />
        <span className="text-[10px] text-muted-foreground">章写作视角</span>
        {content === null && (
          <Button size="xs" variant="outline" onClick={() => void fetchPreview(chapterNumber)} className="h-6 text-[10px] ml-1">
            加载
          </Button>
        )}
      </div>
      {content !== null && (
        <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-[10px] font-mono text-muted-foreground bg-muted/50 p-2 rounded">
          {content}
        </pre>
      )}
    </div>
  );
}
