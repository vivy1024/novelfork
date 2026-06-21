/**
 * SearchBar — floating search & replace bar for ChapterEditor.
 *
 * Keyboard shortcuts (registered in ChapterEditor):
 *   Ctrl+F → open in search mode
 *   Ctrl+H → open in replace mode
 *   Escape → close
 *   Enter → next match (when search input focused)
 *   Shift+Enter → previous match
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { Editor } from "@tiptap/core";
import { Search, ChevronUp, ChevronDown, X, TextCursorInput } from "lucide-react";
import { scrollToCurrentMatch } from "./SearchExtension";

type SearchMode = "search" | "replace";

interface SearchBarProps {
  editor: Editor;
  mode: SearchMode;
  onClose: () => void;
}

export function SearchBar({ editor, mode, onClose }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [currentIdx, setCurrentIdx] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const [replaceResult, setReplaceResult] = useState<string | null>(null);
  const replaceResultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryInputRef = useRef<HTMLInputElement>(null);

  // Update search state from editor
  const syncState = useCallback(() => {
    setCurrentIdx(editor.storage.search.currentIndex as number);
    setMatchCount(editor.storage.search.matchCount as number);
  }, [editor]);

  // Apply search query to editor
  useEffect(() => {
    if (query) {
      editor.chain().setSearchQuery(query).run();
    } else {
      editor.chain().clearSearch().run();
    }
    syncState();
  }, [editor, query, syncState]);

  // Scroll current match into view on index change
  useEffect(() => {
    if (matchCount === 0) return;
    const container = editor.view.dom.closest(".chapter-editor");
    if (container) {
      requestAnimationFrame(() => {
        scrollToCurrentMatch(editor, container as HTMLElement);
      });
    }
  }, [editor, currentIdx, matchCount]);

  // Auto-focus the search input when opened
  useEffect(() => {
    queryInputRef.current?.focus();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      editor.chain().clearSearch().run();
      if (replaceResultTimer.current) clearTimeout(replaceResultTimer.current);
    };
  }, [editor]);

  const showResult = useCallback((msg: string) => {
    setReplaceResult(msg);
    if (replaceResultTimer.current) clearTimeout(replaceResultTimer.current);
    replaceResultTimer.current = setTimeout(() => setReplaceResult(null), 2500);
  }, []);

  const handleGoNext = useCallback(() => {
    if (matchCount === 0) return;
    editor.chain().goToNextMatch().run();
    syncState();
  }, [editor, matchCount, syncState]);

  const handleGoPrev = useCallback(() => {
    if (matchCount === 0) return;
    editor.chain().goToPreviousMatch().run();
    syncState();
  }, [editor, matchCount, syncState]);

  const handleReplace = useCallback(() => {
    if (matchCount === 0) return;
    editor.chain().replaceMatch(replacement).run();
    syncState();
  }, [editor, matchCount, replacement, syncState]);

  const handleReplaceAll = useCallback(() => {
    if (matchCount === 0) return;
    const count = matchCount;
    editor.chain().replaceAllMatches(replacement).run();
    syncState();
    showResult(`已替换 ${count} 处`);
  }, [editor, matchCount, replacement, syncState, showResult]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleGoNext();
      }
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        handleGoPrev();
      }
    },
    [onClose, handleGoNext, handleGoPrev],
  );

  const matchLabel =
    matchCount > 0 ? `${currentIdx + 1}/${matchCount}` : query ? "无匹配" : "";

  return (
    <div className="ide-search-bar" onKeyDown={handleKeyDown}>
      {/* Close button */}
      <button
        type="button"
        className="ide-search-bar__btn"
        onClick={onClose}
        title="关闭 (Esc)"
      >
        <X className="size-3.5" />
      </button>

      {/* Search input */}
      <div className="ide-search-bar__field">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={queryInputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索…"
          className="ide-search-bar__input"
          aria-label="搜索关键词"
        />
        {matchLabel && (
          <span className="ide-search-bar__count">{matchLabel}</span>
        )}
      </div>

      {/* Navigation */}
      <button
        type="button"
        className="ide-search-bar__btn"
        onClick={handleGoPrev}
        title="上一个 (Shift+Enter)"
        disabled={matchCount === 0}
      >
        <ChevronUp className="size-3.5" />
      </button>
      <button
        type="button"
        className="ide-search-bar__btn"
        onClick={handleGoNext}
        title="下一个 (Enter)"
        disabled={matchCount === 0}
      >
        <ChevronDown className="size-3.5" />
      </button>

      {/* Replace row (only in replace mode) */}
      {mode === "replace" && (
        <>
          <div className="ide-search-bar__divider" />
          <div className="ide-search-bar__field">
            <TextCursorInput className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              type="text"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="替换为…"
              className="ide-search-bar__input"
              aria-label="替换文本"
            />
          </div>
          <button
            type="button"
            className="ide-search-bar__action"
            onClick={handleReplace}
            disabled={matchCount === 0}
            title="替换当前匹配"
          >
            替换
          </button>
          <button
            type="button"
            className="ide-search-bar__action"
            onClick={handleReplaceAll}
            disabled={matchCount === 0}
            title="替换全部匹配"
          >
            全部替换
          </button>
        </>
      )}

      {/* Replace result toast */}
      {replaceResult && (
        <span className="ide-search-bar__result">{replaceResult}</span>
      )}
    </div>
  );
}
