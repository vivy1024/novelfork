/**
 * InkEditor — Novel (TipTap) based rich text editor for NovelFork.
 * Supports markdown input/output, slash commands, and bubble menu.
 */

import {
  EditorRoot,
  EditorContent,
  EditorCommand,
  EditorCommandList,
  EditorCommandItem,
  EditorCommandEmpty,
  EditorBubble,
  EditorBubbleItem,
  handleCommandNavigation,
  createSuggestionItems,
  Command,
  renderItems,
  StarterKit,
  Placeholder,
  type SuggestionItem,
} from "novel";
import { useEditor } from "novel";
import { Markdown } from "tiptap-markdown";
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Minus,
  Bold,
  Italic,
  Strikethrough,
  Sparkles,
  Eraser,
  Expand,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import { DiffPanel } from "./DiffPanel";
import { GhostText } from "../extensions/ghost-text";
import { useTabCompletion } from "../hooks/use-tab-completion";
import { fetchJson } from "../hooks/use-api";

interface InkEditorProps {
  initialContent?: string;
  onChange?: (markdown: string) => void;
  editable?: boolean;
  className?: string;
  onAIAction?: (params: { text: string; surrounding: string; mode: string }) => Promise<string>;
  bookId?: string;
  chapterNumber?: number;
}

const suggestionItems = createSuggestionItems([
  {
    title: "Heading 1",
    description: "Large section heading",
    icon: <Heading1 size={18} />,
    searchTerms: ["h1", "title", "heading"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run();
    },
  },
  {
    title: "Heading 2",
    description: "Medium section heading",
    icon: <Heading2 size={18} />,
    searchTerms: ["h2", "subtitle"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run();
    },
  },
  {
    title: "Heading 3",
    description: "Small section heading",
    icon: <Heading3 size={18} />,
    searchTerms: ["h3"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run();
    },
  },
  {
    title: "Bullet List",
    description: "Unordered list",
    icon: <List size={18} />,
    searchTerms: ["unordered", "ul", "bullet"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    title: "Numbered List",
    description: "Ordered list",
    icon: <ListOrdered size={18} />,
    searchTerms: ["ordered", "ol", "number"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  {
    title: "Quote",
    description: "Block quote",
    icon: <Quote size={18} />,
    searchTerms: ["blockquote", "quote"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run();
    },
  },
  {
    title: "Divider",
    description: "Horizontal rule",
    icon: <Minus size={18} />,
    searchTerms: ["hr", "divider", "separator"],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
    },
  },
]);

const slashCommand = Command.configure({
  suggestion: {
    items: () => suggestionItems,
    render: renderItems,
  },
});

const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
  }),
  Placeholder.configure({
    placeholder: ({ node }) =>
      node.type.name === "heading"
        ? `Heading ${node.attrs.level}`
        : "Press '/' for commands...",
    includeChildren: true,
  }),
  Markdown.configure({
    html: false,
    transformCopiedText: true,
    transformPastedText: true,
  }),
  slashCommand,
  GhostText,
];

/** Extract surrounding context around a selection */
function getSurrounding(editor: any, from: number, to: number, chars = 500): string {
  const doc = editor.state.doc;
  const before = doc.textBetween(Math.max(0, from - chars), from, "\n");
  const after = doc.textBetween(to, Math.min(doc.content.size, to + chars), "\n");
  return `${before}\n[SELECTED]\n${after}`;
}

/** Get markdown from editor instance */
export function getMarkdown(editor: any): string {
  return editor?.storage?.markdown?.getMarkdown?.() ?? "";
}

interface PendingDiff {
  readonly from: number;
  readonly to: number;
  readonly originalText: string;
  readonly newText: string;
  readonly mode: string;
}

const InkEditorComponent = forwardRef(function InkEditor({ initialContent, onChange, editable = true, className, onAIAction, bookId, chapterNumber }: InkEditorProps, ref: React.Ref<any>) {
  const [aiLoading, setAiLoading] = useState(false);
  const [pendingDiff, setPendingDiff] = useState<PendingDiff | null>(null);
  const [diffPosition, setDiffPosition] = useState<{ top: number; left: number }>({ top: 100, left: 100 });
  const editorRef = useRef<any>(null);
  const lastSnapshotTimeRef = useRef<number>(0);

  // Expose editor instance to parent via ref
  useImperativeHandle(ref, () => editorRef.current, []);

  const handleAcceptDiff = useCallback(() => {
    if (!pendingDiff || !editorRef.current) return;
    const editor = editorRef.current;
    editor.chain().focus().insertContentAt(
      { from: pendingDiff.from, to: pendingDiff.to },
      pendingDiff.newText,
    ).run();
    setPendingDiff(null);
    setAiLoading(false);
  }, [pendingDiff]);

  const handleRejectDiff = useCallback(() => {
    setPendingDiff(null);
    setAiLoading(false);
  }, []);

  // Create snapshot helper
  const createSnapshot = useCallback(async (triggerType: string, description: string) => {
    if (!bookId || !chapterNumber || !editorRef.current) return;

    // Debounce: skip if last snapshot was < 30 seconds ago
    const now = Date.now();
    if (now - lastSnapshotTimeRef.current < 30000) {
      console.log("[InkEditor] Skipping snapshot due to debounce");
      return;
    }

    try {
      const content = getMarkdown(editorRef.current);
      await fetchJson("/api/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId,
          chapterNumber,
          content,
          triggerType,
          description,
        }),
      });
      lastSnapshotTimeRef.current = now;
      console.log(`[InkEditor] Snapshot created: ${description}`);
    } catch (err) {
      console.error("[InkEditor] Failed to create snapshot:", err);
      // Don't block AI action on snapshot failure
    }
  }, [bookId, chapterNumber]);

  // Keyboard shortcuts: Ctrl+Enter = accept, Escape = reject
  useEffect(() => {
    if (!pendingDiff) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleRejectDiff();
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleAcceptDiff();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pendingDiff, handleAcceptDiff, handleRejectDiff]);

  const { trigger: triggerCompletion, cancel: cancelCompletion } = useTabCompletion({
    editor: editorRef.current,
    enabled: editable && !pendingDiff && !aiLoading,
  });

  const handleAI = async (editor: any, mode: string) => {
    if (!onAIAction || aiLoading) return;
    cancelCompletion();
    const { from, to } = editor.state.selection;
    if (from === to) return;

    const text = editor.state.doc.textBetween(from, to, "\n");
    const surrounding = getSurrounding(editor, from, to);

    setAiLoading(true);

    // Create "before AI" snapshot
    await createSnapshot("before_ai", `AI ${mode} 前`);

    try {
      const result = await onAIAction({ text, surrounding, mode });

      // Compute position near the selection
      const coords = editor.view.coordsAtPos(from);
      setDiffPosition({ top: coords.bottom + 8, left: Math.max(16, coords.left - 120) });

      // Store diff for review instead of direct replacement
      setPendingDiff({ from, to, originalText: text, newText: result, mode });
      // Keep aiLoading=true to disable AI buttons while diff panel is shown

      // Create "after AI" snapshot
      await createSnapshot("after_ai", `AI ${mode} 后`);
    } catch (err) {
      console.error("[InkEditor] AI action failed:", err);
      setAiLoading(false);
    }
  };

  return (
    <EditorRoot>
      <EditorContent
        className={className}
        extensions={extensions}
        initialContent={initialContent as any}
        editable={editable && !pendingDiff}
        editorProps={{
          handleDOMEvents: {
            keydown: (_view: any, event: any) => handleCommandNavigation(event),
          },
          attributes: {
            class: "prose prose-zinc dark:prose-invert max-w-none font-serif text-lg leading-[1.8] focus:outline-none min-h-[60vh]",
          },
        }}
        onCreate={({ editor }) => {
          editorRef.current = editor;
        }}
        onUpdate={({ editor }) => {
          editorRef.current = editor;
          if (onChange) {
            onChange(getMarkdown(editor));
          }
          triggerCompletion();
        }}
      >
        {/* Slash Command Menu */}
        <EditorCommand className="z-50 h-auto max-h-[330px] overflow-y-auto rounded-xl border border-border bg-background px-1 py-2 shadow-xl transition-all">
          <EditorCommandEmpty className="px-2 text-sm text-muted-foreground">
            No results
          </EditorCommandEmpty>
          <EditorCommandList>
            {suggestionItems.map((item: SuggestionItem) => (
              <EditorCommandItem
                value={item.title}
                onCommand={(val) => item.command?.(val)}
                key={item.title}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-accent cursor-pointer"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
                  {item.icon}
                </div>
                <div>
                  <p className="font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
              </EditorCommandItem>
            ))}
          </EditorCommandList>
        </EditorCommand>

        {/* Bubble Menu on text selection */}
        <EditorBubble className="flex items-center gap-0.5 rounded-xl border border-border bg-background p-1 shadow-xl">
          <BubbleButton
            action={(editor) => editor.chain().focus().toggleBold().run()}
            isActive={(editor) => editor.isActive("bold")}
          >
            <Bold size={14} />
          </BubbleButton>
          <BubbleButton
            action={(editor) => editor.chain().focus().toggleItalic().run()}
            isActive={(editor) => editor.isActive("italic")}
          >
            <Italic size={14} />
          </BubbleButton>
          <BubbleButton
            action={(editor) => editor.chain().focus().toggleStrike().run()}
            isActive={(editor) => editor.isActive("strike")}
          >
            <Strikethrough size={14} />
          </BubbleButton>

          {/* Separator between format and AI buttons */}
          <div className="w-px h-4 bg-border mx-1" />

          {/* AI action buttons */}
          <AIBubbleButton
            action={(editor) => handleAI(editor, "polish")}
            disabled={aiLoading}
          >
            {aiLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          </AIBubbleButton>
          <AIBubbleButton
            action={(editor) => handleAI(editor, "condense")}
            disabled={aiLoading}
          >
            {aiLoading ? <Loader2 size={14} className="animate-spin" /> : <Eraser size={14} />}
          </AIBubbleButton>
          <AIBubbleButton
            action={(editor) => handleAI(editor, "expand")}
            disabled={aiLoading}
          >
            {aiLoading ? <Loader2 size={14} className="animate-spin" /> : <Expand size={14} />}
          </AIBubbleButton>
          <AIBubbleButton
            action={(editor) => handleAI(editor, "audit")}
            disabled={aiLoading}
          >
            {aiLoading ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
          </AIBubbleButton>
        </EditorBubble>
      </EditorContent>

      {/* Diff review panel */}
      {pendingDiff && (
        <DiffPanel
          originalText={pendingDiff.originalText}
          newText={pendingDiff.newText}
          mode={pendingDiff.mode}
          position={diffPosition}
          onAccept={handleAcceptDiff}
          onReject={handleRejectDiff}
        />
      )}
    </EditorRoot>
  );
});

InkEditorComponent.displayName = "InkEditor";

function BubbleButton({ children, action, isActive }: {
  children: React.ReactNode;
  action: (editor: any) => void;
  isActive?: (editor: any) => boolean;
}) {
  return (
    <EditorBubbleItem
      onSelect={action}
      className="rounded-lg p-2 hover:bg-accent transition-colors data-[active=true]:bg-accent"
    >
      {children}
    </EditorBubbleItem>
  );
}

function AIBubbleButton({ children, action, disabled }: {
  children: React.ReactNode;
  action: (editor: any) => void;
  disabled?: boolean;
}) {
  return (
    <EditorBubbleItem
      onSelect={(editor) => { if (!disabled) action(editor); }}
      className={`rounded-lg p-2 transition-colors ${disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-accent cursor-pointer"}`}
    >
      {children}
    </EditorBubbleItem>
  );
}

export const InkEditor = InkEditorComponent;
