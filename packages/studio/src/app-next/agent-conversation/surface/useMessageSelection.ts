import { useState, useCallback, useEffect } from "react";

export interface MessageSelectionState {
  selectedIds: Set<string>;
  lastSelectedId: string | null;
}

export function useMessageSelection(messageIds: string[]) {
  const [state, setState] = useState<MessageSelectionState>({
    selectedIds: new Set(),
    lastSelectedId: null,
  });

  const toggle = useCallback(
    (id: string, event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
      setState((prev) => {
        const next = new Set(prev.selectedIds);

        if (event.shiftKey && prev.lastSelectedId) {
          // Range select
          const startIdx = messageIds.indexOf(prev.lastSelectedId);
          const endIdx = messageIds.indexOf(id);
          if (startIdx >= 0 && endIdx >= 0) {
            const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
            for (let i = from; i <= to; i++) {
              next.add(messageIds[i]!);
            }
          }
        } else if (event.ctrlKey || event.metaKey) {
          // Toggle single
          if (next.has(id)) next.delete(id);
          else next.add(id);
        } else {
          // Plain click — don't interfere with normal text selection
          return prev;
        }

        return { selectedIds: next, lastSelectedId: id };
      });
    },
    [messageIds],
  );

  const clear = useCallback(() => {
    setState({ selectedIds: new Set(), lastSelectedId: null });
  }, []);

  const selectAll = useCallback(() => {
    setState({
      selectedIds: new Set(messageIds),
      lastSelectedId: messageIds[messageIds.length - 1] ?? null,
    });
  }, [messageIds]);

  // Escape key clears selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && state.selectedIds.size > 0) {
        clear();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [state.selectedIds.size, clear]);

  return {
    selectedIds: state.selectedIds,
    isSelected: (id: string) => state.selectedIds.has(id),
    selectionCount: state.selectedIds.size,
    toggle,
    clear,
    selectAll,
  };
}
