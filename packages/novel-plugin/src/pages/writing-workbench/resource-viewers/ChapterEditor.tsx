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
// Task A: Heading Folding Extension (via onUpdate, no prosemirror-state needed)
// ---------------------------------------------------------------------------

/** 注入折叠箭头 + 标记折叠态 */
function setupFoldGutters(container: HTMLElement, foldedSet: Set<string>) {
  // container 可能是 ProseMirror 元素本身，也可能是外层 wrapper
  const editorEl = (container.classList.contains("ProseMirror")
    ? container
    : container.querySelector(".ProseMirror")) as HTMLElement | null;
  if (!editorEl) return;

  // 1) 注入/更新样式标签
  let styleEl = document.getElementById("chapter-fold-styles");
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "chapter-fold-styles";
    styleEl.textContent = `
.chapter-editor-wrapper { position: relative; }
.chapter-editor-wrapper .ProseMirror { padding-left: 32px !important; }
.ce-fold-gutter {
  position: absolute; left: 0; width: 24px; display: flex;
  align-items: center; justify-content: center; cursor: pointer;
  color: var(--muted-foreground, #888); opacity: 0; transition: opacity .15s;
  z-index: 1; user-select: none; font-size: 12px;
}
.ProseMirror h1, .ProseMirror h2, .ProseMirror h3,
.ProseMirror h4, .ProseMirror h5, .ProseMirror h6 { position: relative; }
.ProseMirror h1:hover, .ProseMirror h2:hover, .ProseMirror h3:hover,
.ProseMirror h4:hover, .ProseMirror h5:hover, .ProseMirror h6:hover { position: relative; }
.ProseMirror h1>.ce-fold-gutter, .ProseMirror h2>.ce-fold-gutter,
.ProseMirror h3>.ce-fold-gutter, .ProseMirror h4>.ce-fold-gutter,
.ProseMirror h5>.ce-fold-gutter, .ProseMirror h6>.ce-fold-gutter { opacity: 0; }
.ProseMirror h1:hover>.ce-fold-gutter, .ProseMirror h2:hover>.ce-fold-gutter,
.ProseMirror h3:hover>.ce-fold-gutter, .ProseMirror h4:hover>.ce-fold-gutter,
.ProseMirror h5:hover>.ce-fold-gutter, .ProseMirror h6:hover>.ce-fold-gutter { opacity: 1; }
.ce-fold-gutter[data-folded="true"] { opacity: 1 !important; }
.ce-fold-gutter[data-folded="true"]+.ce-fold-placeholder { display: block; }
.ce-fold-placeholder {
  display: none; padding: 2px 8px; margin: 0 0 4px; font-size: 11px;
  color: var(--muted-foreground, #888); opacity: .6; pointer-events: none;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 300px;
}

/* ── 折叠隐藏规则（纯 CSS，用 data-folded-to 属性选择器） ── */
.ce-folded-to-h1~* { display: none !important; }
.ce-folded-to-h1~*.ProseMirror-heading[data-level="1"] { display: block !important; }
.ce-folded-to-h2~* { display: none !important; }
.ce-folded-to-h2~*.ProseMirror-heading[data-level="1"],
.ce-folded-to-h2~*.ProseMirror-heading[data-level="2"] { display: block !important; }
.ce-folded-to-h3~* { display: none !important; }
.ce-folded-to-h3~*.ProseMirror-heading[data-level="1"],
.ce-folded-to-h3~*.ProseMirror-heading[data-level="2"],
.ce-folded-to-h3~*.ProseMirror-heading[data-level="3"] { display: block !important; }
.ce-folded-to-h4~* { display: none !important; }
.ce-folded-to-h4~*.ProseMirror-heading[data-level="1"],
.ce-folded-to-h4~*.ProseMirror-heading[data-level="2"],
.ce-folded-to-h4~*.ProseMirror-heading[data-level="3"],
.ce-folded-to-h4~*.ProseMirror-heading[data-level="4"] { display: block !important; }
.ce-folded-to-h5~* { display: none !important; }
.ce-folded-to-h5~*.ProseMirror-heading[data-level="1"],
.ce-folded-to-h5~*.ProseMirror-heading[data-level="2"],
.ce-folded-to-h5~*.ProseMirror-heading[data-level="3"],
.ce-folded-to-h5~*.ProseMirror-heading[data-level="4"],
.ce-folded-to-h5~*.ProseMirror-heading[data-level="5"] { display: block !important; }
.ce-folded-to-h6~* { display: none !important; }
.ce-folded-to-h6~*.ProseMirror-heading[data-level="1"],
.ce-folded-to-h6~*.ProseMirror-heading[data-level="2"],
.ce-folded-to-h6~*.ProseMirror-heading[data-level="3"],
.ce-folded-to-h6~*.ProseMirror-heading[data-level="4"],
.ce-folded-to-h6~*.ProseMirror-heading[data-level="5"],
.ce-folded-to-h6~*.ProseMirror-heading[data-level="6"] { display: block !important; }
`;
    document.head.appendChild(styleEl);
  }

  // 2) 事件委托（只绑定一次）
  if (!editorEl.dataset.foldDelegated) {
    editorEl.dataset.foldDelegated = "true";
    editorEl.addEventListener("click", (e) => {
      const toggle = (e.target as HTMLElement).closest(".ce-fold-gutter");
      if (!toggle) return;
      e.preventDefault();
      e.stopPropagation();

      const heading = toggle.parentElement as HTMLElement;
      if (!heading) return;
      const level = heading.dataset.level;
      if (!level) return;

      const key = `${level}:${heading.textContent?.slice(0, 20) ?? ""}`;
      const isCurrentlyFolded = toggle.getAttribute("data-folded") === "true";

      if (isCurrentlyFolded) {
        toggle.setAttribute("data-folded", "false");
        toggle.textContent = "▸";
        heading.classList.remove(`ce-folded-to-h${level}`);
        foldedSet.delete(key);
      } else {
        toggle.setAttribute("data-folded", "true");
        toggle.textContent = "▾";
        heading.classList.add(`ce-folded-to-h${level}`);
        foldedSet.add(key);
      }
    });
  }

  // 3) 为每个标题注入折叠按钮
  const headings = editorEl.querySelectorAll<HTMLElement>(
    ".ProseMirror-heading, h1, h2, h3, h4, h5, h6",
  );

  for (const heading of headings) {
    const level = heading.dataset.level ?? heading.tagName.replace("H", "");
    if (heading.querySelector(".ce-fold-gutter")) continue;

    // 标记为标题节点（用于 CSS 选择器）
    heading.classList.add("ProseMirror-heading");
    heading.dataset.level = level;

    const key = `${level}:${heading.textContent?.slice(0, 20) ?? ""}`;
    const isFolded = foldedSet.has(key);

    const btn = document.createElement("span");
    btn.className = "ce-fold-gutter";
    btn.setAttribute("data-folded", String(isFolded));
    btn.textContent = isFolded ? "▾" : "▸";
    btn.title = "折叠/展开";
    heading.prepend(btn);

    if (isFolded) {
      heading.classList.add(`ce-folded-to-h${level}`);
    }
  }
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

  // Task A: 折叠状态（ref，不触发 re-render）
  const foldedRef = useRef(new Set<string>());

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

      // Task A: 在每次更新后设置折叠 gutter
      requestAnimationFrame(() => {
        const editorEl = ed.view.dom as HTMLElement;
        setupFoldGutters(editorEl, foldedRef.current);
      });

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

  // Task A: 初始化折叠 gutter（editor 创建后 + 内容变更后）
  useEffect(() => {
    if (!editor) return;
    const timer = setTimeout(() => {
      setupFoldGutters(editor.view.dom as HTMLElement, foldedRef.current);
    }, 50);
    return () => clearTimeout(timer);
  }, [editor, content]);

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
