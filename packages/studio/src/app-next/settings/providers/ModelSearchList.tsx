/**
 * 可搜索、自动排序、带截断的模型库存列表。
 * 替代 ApiProviderDetail 中原来的裸 map 渲染。
 */
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

import type { RuntimeModelOption } from "../runtime-settings-utils";

const MAX_VISIBLE = 200;
const SEARCH_THRESHOLD = 50;

export interface ModelSearchListProps {
  models: readonly RuntimeModelOption[];
  hiddenSet: ReadonlySet<string>;
  children: (visibleModels: readonly RuntimeModelOption[]) => React.ReactNode;
}

export function ModelSearchList({ models, hiddenSet, children }: ModelSearchListProps) {
  const [query, setQuery] = useState("");

  const sorted = useMemo(() => {
    const copy = [...models];
    copy.sort((a, b) => Number(hiddenSet.has(a.value)) - Number(hiddenSet.has(b.value)));
    return copy;
  }, [models, hiddenSet]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (m) => m.value.toLowerCase().includes(q) || m.label.toLowerCase().includes(q),
    );
  }, [sorted, query]);

  const truncated = filtered.length > MAX_VISIBLE;
  const visible = truncated ? filtered.slice(0, MAX_VISIBLE) : filtered;

  return (
    <div className="flex flex-col gap-2">
      {models.length >= SEARCH_THRESHOLD && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-xs"
            placeholder={`搜索模型（共 ${models.length} 个）`}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
        </div>
      )}

      <div className="flex flex-col max-h-[520px] overflow-y-auto pr-1">
        {children(visible)}
      </div>

      {truncated && (
        <p className="text-xs text-muted-foreground text-center pt-1">
          还有 {filtered.length - MAX_VISIBLE} 个模型未显示，请使用搜索框筛选。
        </p>
      )}
    </div>
  );
}
