import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { useEffect, useRef, useState } from "react";

interface ChapterEditorProps {
  content: string;
  readonly?: boolean;
  onContentChange?: (content: string) => void;
  placeholder?: string;
}

export function ChapterEditor({ content, readonly, onContentChange, placeholder }: ChapterEditorProps) {
  const [wordCount, setWordCount] = useState(0);
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

  if (!editor) return null;

  return (
    <div className="chapter-editor relative flex flex-col">
      {/* Editor content */}
      <EditorContent editor={editor} className="chapter-editor__content flex-1" />

      {/* Footer: word count */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-border text-[11px] text-muted-foreground">
        <span>{wordCount} 字</span>
      </div>
    </div>
  );
}
