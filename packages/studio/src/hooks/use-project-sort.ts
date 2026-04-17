import { useState, useCallback } from "react";

interface SortableItem {
  readonly id: string;
  readonly sortOrder?: number;
}

const STORAGE_KEY = "inkos-project-sort-order";

/**
 * 加载项目排序顺序
 */
function loadSortOrder(): Record<string, number> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

/**
 * 保存项目排序顺序
 */
function saveSortOrder(order: Record<string, number>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
  } catch {
    // 静默失败
  }
}

/**
 * 项目拖拽排序 Hook
 */
export function useProjectSort<T extends SortableItem>(items: ReadonlyArray<T>) {
  const [sortOrder, setSortOrder] = useState<Record<string, number>>(loadSortOrder);

  // 应用排序
  const sortedItems = [...items].sort((a, b) => {
    const orderA = sortOrder[a.id] ?? 999999;
    const orderB = sortOrder[b.id] ?? 999999;
    return orderA - orderB;
  });

  // 处理拖拽结束
  const handleDragEnd = useCallback((activeId: string, overId: string) => {
    if (activeId === overId) return;

    const oldIndex = sortedItems.findIndex((item) => item.id === activeId);
    const newIndex = sortedItems.findIndex((item) => item.id === overId);

    if (oldIndex === -1 || newIndex === -1) return;

    // 重新计算排序顺序
    const newOrder = { ...sortOrder };
    sortedItems.forEach((item, index) => {
      if (index === newIndex) {
        newOrder[activeId] = index;
      } else if (oldIndex < newIndex) {
        // 向下拖动
        if (index > oldIndex && index <= newIndex) {
          newOrder[item.id] = index - 1;
        }
      } else {
        // 向上拖动
        if (index >= newIndex && index < oldIndex) {
          newOrder[item.id] = index + 1;
        }
      }
    });

    setSortOrder(newOrder);
    saveSortOrder(newOrder);
  }, [sortedItems, sortOrder]);

  return {
    sortedItems,
    handleDragEnd,
  };
}
