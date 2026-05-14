import { useEditor, EditorContent, BubbleMenu } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { useEffect, useCallback, useRef, useState } from "react";

interface ChapterEditorProps {
  content: string;
  readonly?: boolean;
  onContentChange?: (content: string) => void;
  onInlineWrite?: (mode: "continue" | "expand" | "rewrite" | "variants", selectedText: string, start: number, end: number) => void;
  placeholder?: string;
}

export function ChapterEditor({ content, readonly, onContentChange, onInlineWrite, placeholder }: ChapterEditorProps) {
  const [wordCount, setWordCount] = useState(0);
  const [inlineWriting, setInlineWriting] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isExternalUpdate = useRef(false);

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

  const handleInlineWrite = useCallback((mode: "continue" | "expand" | "rewrite" | "variants") => {
    if (!editor || !onInlineWrite) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const selectedText = editor.state.doc.textBetween(from, to, "\n");
    if (!selectedText) return;
    setInlineWriting(true);
    onInlineWrite(mode, selectedText, from, to);
    // The parent will handle the async operation and update content
    setTimeout(() => setInlineWriting(false), 3000);
  }, [editor, onInlineWrite]);

  if (!editor) return null;

  return (
    <div className="chapter-editor relative flex flex-col">
      {/* Bubble menu for selection toolbar */}
      {!readonly && onInlineWrite && (
        <BubbleMenu
          editor={editor}
          tippyOptions={{ duration: 150, placement: "top" }}
          className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 shadow-md"
        >
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-[10px] hover:bg-muted"
            onClick={() => handleInlineWrite("continue")}
            disabled={inlineWriting}
          >
            续写
          </button>
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-[10px] hover:bg-muted"
            onClick={() => handleInlineWrite("expand")}
            disabled={inlineWriting}
          >
            扩写
          </button>
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-[10px] hover:bg-muted"
            onClick={() => handleInlineWrite("rewrite")}
            disabled={inlineWriting}
          >
            改写
          </button>
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-[10px] hover:bg-muted"
            onClick={() => handleInlineWrite("variants")}
            disabled={inlineWriting}
          >
            多版本
          </button>
        </BubbleMenu>
      )}

      {/* Editor content */}
      <EditorContent editor={editor} className="chapter-editor__content flex-1" />

      {/* Footer: word count + status */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-border text-[11px] text-muted-foreground">
        <span>{wordCount} 字</span>
        {inlineWriting && <span className="animate-pulse">生成中…</span>}
      </div>
    </div>
  );
}
