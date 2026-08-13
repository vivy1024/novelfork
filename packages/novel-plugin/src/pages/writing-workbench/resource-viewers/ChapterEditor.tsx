import { useEditor, EditorContent, BubbleMenu } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { useEffect, useRef, useState, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { Loader2 } from "lucide-react";
import { fetchJson } from "@/hooks/use-api";
import { SearchExtension } from "../ide/SearchExtension";
import { SearchBar } from "../ide/SearchBar";
import { EditorMinimap } from "./EditorMinimap";

// ---------------------------------------------------------------------------
// BubbleMenu AI actions
// ---------------------------------------------------------------------------

type AiAction = "continue" | "polish" | "rewrite" | "expand";

const AI_ACTION_LABELS: Record<AiAction, string> = {
  continue: "续写",
  polish: "润色",
  rewrite: "改写",
  expand: "扩写",
};

function BubbleButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="text-xs px-2 py-1 rounded hover:bg-muted disabled:opacity-50 disabled:pointer-events-none transition-colors"
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

/** Get surrounding text around the selection for context */
function getSurroundingContext(editor: Editor, maxChars = 500): string {
  const { from, to } = editor.state.selection;
  const fullText = editor.state.doc.textContent;
  const before = fullText.slice(Math.max(0, from - maxChars), from);
  const after = fullText.slice(to, Math.min(fullText.length, to + maxChars));
  return `${before}[选中]${after}`;
}

/** Map frontend action names to backend inline-write mode names */
const ACTION_TO_MODE: Record<AiAction, string> = {
  continue: "continuation",
  polish: "polish",
  rewrite: "rewrite",
  expand: "expansion",
};

async function callInlineWrite(bookId: string, action: AiAction, selectedText: string, context: string): Promise<string | null> {
  try {
    const data = await fetchJson<{ text?: string; content?: string }>(
      `/api/books/${encodeURIComponent(bookId)}/inline-write`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: ACTION_TO_MODE[action], selectedText, context, maxTokens: 300 }),
      },
    );
    return data.text ?? data.content ?? null;
  } catch {
    return null;
  }
}

interface PendingInlineEdit {
  readonly action: AiAction;
  readonly from: number;
  readonly to: number;
  readonly sourceText: string;
  readonly text: string;
}

function AIBubbleMenu({ editor, bookId }: { editor: Editor; bookId: string }) {
  const [loading, setLoading] = useState<AiAction | null>(null);
  const [pending, setPending] = useState<PendingInlineEdit | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);

  const handleAction = useCallback(async (action: AiAction) => {
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, " ");
    if (!selectedText.trim()) return;

    setPending(null);
    setPendingError(null);
    setLoading(action);
    try {
      const context = getSurroundingContext(editor);
      const result = await callInlineWrite(bookId, action, selectedText, context);
      if (!result) return;
      // 生成只产生候选，不直接改编辑器；作者明确点击“应用”后才改变未保存正文。
      setPending({ action, from, to, sourceText: selectedText, text: result });
    } finally {
      setLoading(null);
    }
  }, [editor, bookId]);

  const applyPending = useCallback(() => {
    if (!pending) return;
    const currentText = editor.state.doc.textBetween(pending.from, pending.to, " ");
    if (currentText !== pending.sourceText) {
      setPendingError("选中文本已变化，请重新选择后生成候选");
      return;
    }
    if (pending.action === "continue") {
      editor.chain().focus().insertContentAt(pending.to, pending.text).run();
    } else {
      editor.chain().focus().deleteRange({ from: pending.from, to: pending.to }).insertContentAt(pending.from, pending.text).run();
    }
    setPending(null);
    setPendingError(null);
  }, [editor, pending]);

  return (
    <BubbleMenu editor={editor} tippyOptions={{ duration: 100 }}>
      <div className="max-w-sm rounded-lg border bg-card p-1.5 shadow-lg">
        {pending ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="text-[11px] font-medium">已生成{AI_ACTION_LABELS[pending.action]}候选</span>
              <span className="text-[10px] text-muted-foreground">不会自动覆盖正文</span>
            </div>
            <div className="max-h-28 overflow-y-auto rounded bg-muted/50 p-2 text-xs whitespace-pre-wrap">{pending.text}</div>
            {pendingError ? <div className="px-1 text-[10px] text-destructive">{pendingError}</div> : null}
            <div className="flex justify-end gap-1">
              <BubbleButton onClick={() => { setPending(null); setPendingError(null); }}>放弃</BubbleButton>
              <BubbleButton onClick={applyPending}>应用候选</BubbleButton>
            </div>
          </div>
        ) : (
          <div className="flex gap-1">
            {(Object.keys(AI_ACTION_LABELS) as AiAction[]).map((action) => (
              <BubbleButton
                key={action}
                onClick={() => void handleAction(action)}
                disabled={loading !== null}
              >
                {loading === action ? (
                  <Loader2 className="size-3 animate-spin inline" />
                ) : (
                  AI_ACTION_LABELS[action]
                )}
              </BubbleButton>
            ))}
          </div>
        )}
      </div>
    </BubbleMenu>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cleanWhitespace(str: string): string {
  return (str || "").replace(/\r\n/g, "\n").trim();
}

function countWords(text: string): number {
  if (!text) return 0;
  const chineseChars = text.match(/[\u4e00-\u9fa5]/g)?.length ?? 0;
  const englishWords = text.replace(/[\u4e00-\u9fa5]/g, " ").match(/[a-zA-Z0-9_-]+/g)?.length ?? 0;
  return chineseChars + englishWords;
}

// ---------------------------------------------------------------------------
// ChapterEditor 组件
// ---------------------------------------------------------------------------

interface ChapterEditorProps {
  content: string;
  readonly?: boolean;
  onContentChange?: (content: string) => void;
  placeholder?: string;
  /** 编辑器的 accessible name */
  ariaLabel?: string;
  /** Minimap 功能开关（默认开启） */
  showMinimap?: boolean;
  /** 书籍 ID，用于 AI 浮动工具栏调用 inline-write API */
  bookId?: string;
}

export function ChapterEditor({
  content,
  readonly,
  onContentChange,
  placeholder,
  ariaLabel = "章节正文",
  showMinimap = true,
  bookId,
}: ChapterEditorProps) {
  const [wordCount, setWordCount] = useState(0);
  const [searchMode, setSearchMode] = useState<"search" | "replace" | null>(null);
  const isExternalUpdate = useRef(false);

  // Task B: Minimap 需要的 ref
  const editorRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        history: { depth: 100 },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? "开始写作…",
      }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      SearchExtension,
    ],
    content: content || "",
    editable: !readonly,
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (isExternalUpdate.current) return;

      // Update word count and surface content changes immediately so the
      // containing canvas can mark the resource dirty without waiting for an
      // autosave debounce.
      const text = ed.getText();
      setWordCount(countWords(text));
      onContentChange?.(ed.storage.markdown.getMarkdown() as string);
    },
  });

  // Sync editable state
  useEffect(() => {
    if (editor) {
      editor.setEditable(!readonly);
    }
  }, [editor, readonly]);

  // Sync external content changes
  useEffect(() => {
    if (!editor) return;
    const currentMd = editor.storage.markdown.getMarkdown() as string;
    if (cleanWhitespace(content) !== cleanWhitespace(currentMd)) {
      // If user is editing, do not swallow composition/letters unless it's a huge external change (e.g. Git load)
      if (editor.isFocused && Math.abs((content || "").length - currentMd.length) < 50) {
        return;
      }
      isExternalUpdate.current = true;
      editor.commands.setContent(content || "");
      isExternalUpdate.current = false;
      setWordCount(countWords(editor.getText()));
    }
  }, [editor, content]);

  // Initial word count
  useEffect(() => {
    if (editor) {
      setWordCount(countWords(editor.getText()));
    }
  }, [editor]);

  // Ctrl+F / Ctrl+H keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) return;

      // Skip if event originates from inside the search bar (let SearchBar handle its own keys)
      const target = e.target as HTMLElement;
      if (target.closest(".ide-search-bar")) return;

      if (e.key === "f") {
        e.preventDefault();
        e.stopPropagation();
        setSearchMode("search");
      } else if (e.key === "h") {
        e.preventDefault();
        e.stopPropagation();
        setSearchMode("replace");
      }
    },
    [],
  );

  const handleCloseSearch = useCallback(() => {
    setSearchMode(null);
  }, []);

  if (!editor) return null;

  return (
    <div className="chapter-editor relative flex flex-col h-full min-h-0" onKeyDown={handleKeyDown}>
      {/* AI BubbleMenu — 选中文本后出现 */}
      {!readonly && bookId && editor && (
        <AIBubbleMenu editor={editor} bookId={bookId} />
      )}

      {/* Editor content with minimap */}
      <div className="flex-1 flex min-h-0">
        <div ref={editorRef} className="chapter-editor-wrapper flex-1 min-h-0 overflow-y-auto">
          <EditorContent editor={editor} className="chapter-editor__content" />
        </div>

        {/* Task B: Minimap */}
        {showMinimap && editor && (
          <EditorMinimap editor={editor} scrollContainerRef={editorRef} />
        )}
      </div>

      {/* Floating search bar */}
      {searchMode && (
        <SearchBar editor={editor} mode={searchMode} onClose={handleCloseSearch} />
      )}

      {/* Footer: word count */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-border text-[11px] text-muted-foreground">
        <span>{wordCount} 字</span>
      </div>
    </div>
  );
}
