import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Store, Check } from "lucide-react";
import { useApi, putApi } from "@/hooks/use-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PresetBundle {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly difficulty: "easy" | "medium" | "hard";
  readonly genreIds: readonly string[];
  readonly toneId: string;
  readonly settingBaseId: string;
  readonly logicRiskIds: readonly string[];
  readonly suitableFor: readonly string[];
}

interface BundlesResponse {
  readonly bundles: readonly PresetBundle[];
}

export interface TemplateMarketPanelProps {
  readonly bookId: string;
  readonly onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DIFFICULTY_LABELS: Record<string, { label: string; color: string }> = {
  easy: { label: "入门", color: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400" },
  medium: { label: "进阶", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400" },
  hard: { label: "高级", color: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400" },
};

function difficultyBadge(difficulty: string) {
  const info = DIFFICULTY_LABELS[difficulty] ?? DIFFICULTY_LABELS.medium;
  return info;
}

function collectPresetIds(bundle: PresetBundle): string[] {
  const ids: string[] = [...bundle.genreIds];
  if (bundle.toneId) ids.push(bundle.toneId);
  if (bundle.settingBaseId) ids.push(bundle.settingBaseId);
  ids.push(...bundle.logicRiskIds);
  return ids;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TemplateMarketPanel({ bookId, onClose }: TemplateMarketPanelProps) {
  const { data, loading, error } = useApi<BundlesResponse>("/presets/bundles");
  const [importing, setImporting] = useState<string | null>(null);
  const [imported, setImported] = useState<Set<string>>(new Set());
  const [importError, setImportError] = useState<string | null>(null);

  async function handleImport(bundle: PresetBundle) {
    setImporting(bundle.id);
    setImportError(null);

    try {
      const presetIds = collectPresetIds(bundle);
      await putApi(`/books/${bookId}/presets`, { enabledPresetIds: presetIds });
      setImported((prev) => new Set([...prev, bundle.id]));
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : "导入失败");
    } finally {
      setImporting(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">模板市场</span>
          <button type="button" onClick={onClose} className="text-[10px] text-muted-foreground hover:text-foreground">关闭</button>
        </div>
        <div className="flex items-center justify-center py-6">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
          <span className="ml-2 text-xs text-muted-foreground">加载模板…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-border p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">模板市场</span>
          <button type="button" onClick={onClose} className="text-[10px] text-muted-foreground hover:text-foreground">关闭</button>
        </div>
        <p className="text-xs text-destructive">{error}</p>
      </div>
    );
  }

  const bundles = data?.bundles ?? [];

  return (
    <div className="rounded-lg border border-border p-3 space-y-2" data-testid="template-market-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Store className="size-3.5 text-primary" />
          <span className="text-xs font-medium">模板市场</span>
          <Badge variant="secondary" className="text-[9px] h-4">{bundles.length} 套</Badge>
        </div>
        <button type="button" onClick={onClose} className="text-[10px] text-muted-foreground hover:text-foreground">关闭</button>
      </div>

      {importError && <p className="text-xs text-destructive">{importError}</p>}

      <div className="space-y-2">
        {bundles.map((bundle) => {
          const diff = difficultyBadge(bundle.difficulty);
          const isImported = imported.has(bundle.id);
          const isImporting = importing === bundle.id;

          return (
            <div key={bundle.id} className="rounded-md border border-border p-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs font-medium truncate">{bundle.name}</span>
                  <Badge className={`text-[8px] h-3.5 border-0 ${diff.color}`}>{diff.label}</Badge>
                </div>
                <Button
                  size="sm"
                  variant={isImported ? "ghost" : "outline"}
                  className="shrink-0 h-6 text-[10px] px-2"
                  disabled={isImporting || isImported}
                  onClick={() => void handleImport(bundle)}
                >
                  {isImporting ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : isImported ? (
                    <>
                      <Check className="size-3 mr-0.5 text-green-600" />
                      已导入
                    </>
                  ) : (
                    "导入"
                  )}
                </Button>
              </div>

              <p className="text-[10px] text-muted-foreground line-clamp-2">{bundle.description}</p>

              <div className="flex flex-wrap gap-1">
                {bundle.genreIds.length > 0 && (
                  <Badge variant="secondary" className="text-[8px] h-3.5">流派 ×{bundle.genreIds.length}</Badge>
                )}
                {bundle.toneId && (
                  <Badge variant="secondary" className="text-[8px] h-3.5">文风</Badge>
                )}
                {bundle.settingBaseId && (
                  <Badge variant="secondary" className="text-[8px] h-3.5">时代基底</Badge>
                )}
                {bundle.logicRiskIds.length > 0 && (
                  <Badge variant="secondary" className="text-[8px] h-3.5">逻辑风险 ×{bundle.logicRiskIds.length}</Badge>
                )}
              </div>
            </div>
          );
        })}

        {bundles.length === 0 && (
          <p className="text-[10px] text-muted-foreground text-center py-3">暂无推荐模板</p>
        )}
      </div>
    </div>
  );
}
