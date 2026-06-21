import { useEditor, EditorContent, BubbleMenu } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { useEffect, useRef, useState, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { Loader2 } from "lucide-react";
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

async function callInlineWrite(bookId: string, action: AiAction, selectedText: string, context: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/books/${encodeURIComponent(bookId)}/inline-write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: action, selectedText, context, maxTokens: 300 }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { text?: string; content?: string };
    return data.text ?? data.content ?? null;
  } catch {
    return null;
  }
}

function AIBubbleMenu({ editor, bookId }: { editor: Editor; bookId: string }) {
  const [loading, setLoading] = useState<AiAction | null>(null);

  const handleAction = useCallback(async (action: AiAction) => {
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, " ");
    if (!selectedText.trim()) return;

    setLoading(action);
    try {
      const context = getSurroundingContext(editor);
      const result = await callInlineWrite(bookId, action, selectedText, context);
      if (!result) return;

      if (action === "continue") {
        // 续写：追加到选中文本之后
        editor.chain().focus().insertContentAt(to, result).run();
      } else {
        // 润色/改写/扩写：替换选中文本
        editor.chain().focus().deleteRange({ from, to }).insertContentAt(from, result).run();
      }
    } finally {
      setLoading(null);
    }
  }, [editor, bookId]);

  return (
    <BubbleMenu editor={editor} tippyOptions={{ duration: 100 }}>
      <div className="flex gap-1 rounded-lg border bg-card p-1 shadow-lg">
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
    </BubbleMenu>
  );
}

// ---------------------------------------------------------------------------
// ChapterEditor 组件
// ---------------------------------------------------------------------------

interface ChapterEditorProps {
  content: string;
  readonly?: boolean;
  onContentChange?: (content: string) => void;
  placeholder?: string;
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
  showMinimap = true,
  bookId,
}: ChapterEditorProps) {
  const [wordCount, setWordCount] = useState(0);
  const [searchMode, setSearchMode] = useState<"search" | "replace" | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
    onUpdate: ({ editor: ed }) => {
      if (isExternalUpdate.current) return;

      // Update word count
      const text = ed.getText();
      setWordCount(text.length);

      // Debounced save
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const md = ed.storage.markdown.getMarkdown() as string;
        onContentChange?.(md);
      }, 1500);
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
    if (content !== currentMd) {
      isExternalUpdate.current = true;
      editor.commands.setContent(content || "");
      isExternalUpdate.current = false;
      setWordCount(editor.getText().length);
    }
  }, [editor, content]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      clearTimeout(saveTimer.current);
    };
  }, []);

  // Initial word count
  useEffect(() => {
    if (editor) {
      setWordCount(editor.getText().length);
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
    <div className="chapter-editor relative flex flex-col" onKeyDown={handleKeyDown}>
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
