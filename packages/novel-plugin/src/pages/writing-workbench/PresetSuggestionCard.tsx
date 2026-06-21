import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Check, Sparkles } from "lucide-react";
import { fetchJson, putApi } from "@/hooks/use-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PresetItem {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly description: string;
  readonly tags?: readonly string[];
}

interface PresetsResponse {
  readonly presets: readonly PresetItem[];
}

interface BookConfig {
  readonly genre?: string;
  readonly enabledPresetIds?: readonly string[];
}

export interface PresetSuggestionCardProps {
  readonly bookId: string;
  readonly onClose: () => void;
}

// ---------------------------------------------------------------------------
// 中文题材 → 英文 genre ID 映射
// 与 engine/presets 的 compatibleGenres/genreIds（英文）以及
// storage.ts guided-setup 的 GENRE_TO_PRESET（中文）对齐。
// ---------------------------------------------------------------------------

const GENRE_CN_TO_EN: Record<string, string> = {
  玄幻: "xuanhuan",
  仙侠: "xianxia",
  武侠: "wuxia",
  都市: "urban",
  科幻: "scifi",
  历史: "history",
  言情: "romance",
  悬疑: "mystery",
  游戏: "game",
  末日: "apocalypse",
  穿越: "transmigration",
  重生: "rebirth",
  系统流: "system-flow",
  无限流: "infinite-flow",
  诡秘: "occult",
  赘婿: "son-in-law",
  种田: "farming",
  官场: "politics",
  军事: "military",
  体育: "sports",
  同人: "fanfiction",
  轻小说: "light-novel",
  克苏鲁: "cthulhu",
  赛博朋克: "cyberpunk",
  修真: "cultivation",
  灵异: "supernatural",
};

const CATEGORY_LABELS: Record<string, string> = {
  genre: "流派",
  tone: "文风",
  "setting-base": "时代基底",
  "logic-risk": "逻辑风险",
  bundle: "套装",
  beat: "节拍",
  "anti-ai": "去AI味",
  literary: "文学技法",
};

// 推荐展示时的分类优先级（越靠前越优先展示）
const CATEGORY_PRIORITY: Record<string, number> = {
  bundle: 0,
  genre: 1,
  tone: 2,
  "anti-ai": 3,
  literary: 4,
  "setting-base": 5,
  "logic-risk": 6,
  beat: 7,
};

const MAX_SUGGESTIONS = 6;

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PresetSuggestionCard({ bookId, onClose }: PresetSuggestionCardProps) {
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<PresetItem[]>([]);
  const [enabledIds, setEnabledIds] = useState<string[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [open, setOpen] = useState(true);

  // 读取 book 配置（题材 + 已启用预设），再按题材拉取兼容预设
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const book = await fetchJson<BookConfig>(`/books/${encodeURIComponent(bookId)}`);
        const already = [...(book.enabledPresetIds ?? [])];
        const genreCn = (book.genre ?? "").trim();
        const genreEn = GENRE_CN_TO_EN[genreCn];

        // 有题材映射 → 按题材拉兼容预设；否则拉全部（含通用预设）
        const query = genreEn ? `/presets?genre=${encodeURIComponent(genreEn)}` : "/presets";
        const res = await fetchJson<PresetsResponse>(query);

        if (!active) return;

        // 过滤掉已启用的，按分类优先级 + 名称排序，截断到 MAX
        const recommended = res.presets
          .filter((p) => !already.includes(p.id))
          .slice()
          .sort((a, b) => {
            const pa = CATEGORY_PRIORITY[a.category] ?? 99;
            const pb = CATEGORY_PRIORITY[b.category] ?? 99;
            if (pa !== pb) return pa - pb;
            return a.name.localeCompare(b.name, "zh-CN");
          })
          .slice(0, MAX_SUGGESTIONS);

        setEnabledIds(already);
        setSuggestions(recommended);
      } catch {
        if (active) setSuggestions([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [bookId]);

  const persist = useCallback(
    async (nextIds: string[]) => {
      const prev = enabledIds;
      setEnabledIds(nextIds);
      try {
        await putApi(`/books/${encodeURIComponent(bookId)}/presets`, { enabledPresetIds: nextIds });
      } catch {
        setEnabledIds(prev); // 失败回滚
      }
    },
    [bookId, enabledIds],
  );

  const handleEnableOne = useCallback(
    async (preset: PresetItem) => {
      if (enabledIds.includes(preset.id)) return;
      setPending((p) => [...p, preset.id]);
      await persist([...enabledIds, preset.id]);
      setPending((p) => p.filter((id) => id !== preset.id));
    },
    [enabledIds, persist],
  );

  const handleEnableAll = useCallback(async () => {
    const toAdd = suggestions.map((s) => s.id).filter((id) => !enabledIds.includes(id));
    if (toAdd.length === 0) return;
    setPending((p) => [...p, ...toAdd]);
    await persist([...enabledIds, ...toAdd]);
    setPending([]);
  }, [suggestions, enabledIds, persist]);

  const handleClose = useCallback(() => {
    setOpen(false);
    onClose();
  }, [onClose]);

  // 无推荐时直接关闭，不打扰用户
  useEffect(() => {
    if (!loading && suggestions.length === 0) {
      handleClose();
    }
  }, [loading, suggestions.length, handleClose]);

  const allEnabled = suggestions.length > 0 && suggestions.every((s) => enabledIds.includes(s.id));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            为你的作品推荐这些写作规范
          </DialogTitle>
          <DialogDescription>
            根据你选择的题材，这些预设能帮 AI 写出更贴合的内容。可以一键启用，也可以稍后在预设面板里调整。
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
            <span className="ml-2 text-xs text-muted-foreground">分析推荐预设…</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 max-h-80 overflow-y-auto">
            {suggestions.map((preset) => {
              const isEnabled = enabledIds.includes(preset.id);
              const isPending = pending.includes(preset.id);
              return (
                <div
                  key={preset.id}
                  className="flex items-start justify-between gap-2 rounded-lg border border-border p-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-medium">{preset.name}</span>
                      <Badge variant="secondary" className="text-[9px] h-4">
                        {categoryLabel(preset.category)}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                      {preset.description}
                    </p>
                  </div>
                  <Button
                    variant={isEnabled ? "ghost" : "outline"}
                    size="sm"
                    className="shrink-0 h-7 px-2 text-[11px]"
                    disabled={isEnabled || isPending}
                    onClick={() => void handleEnableOne(preset)}
                  >
                    {isPending ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : isEnabled ? (
                      <>
                        <Check className="size-3 mr-1" />
                        已启用
                      </>
                    ) : (
                      "启用"
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" size="sm" onClick={handleClose}>
            稍后再说
          </Button>
          <Button
            size="sm"
            disabled={loading || allEnabled || suggestions.length === 0}
            onClick={() => void handleEnableAll()}
          >
            <Sparkles className="size-3.5 mr-1" />
            {allEnabled ? "已全部启用" : "全部启用"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
