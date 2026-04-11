/**
 * InkEditor — Novel (TipTap) based rich text editor for InkOS.
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
} from "lucide-react";

interface InkEditorProps {
  initialContent?: string;
  onChange?: (markdown: string) => void;
  editable?: boolean;
  className?: string;
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
];

/** Get markdown from editor instance */
export function getMarkdown(editor: any): string {
  return editor?.storage?.markdown?.getMarkdown?.() ?? "";
}

export function InkEditor({ initialContent, onChange, editable = true, className }: InkEditorProps) {
  return (
    <EditorRoot>
      <EditorContent
        className={className}
        extensions={extensions}
        initialContent={initialContent as any}
        editable={editable}
        editorProps={{
          handleDOMEvents: {
            keydown: (_view: any, event: any) => handleCommandNavigation(event),
          },
          attributes: {
            class: "prose prose-zinc dark:prose-invert max-w-none font-serif text-lg leading-[1.8] focus:outline-none min-h-[60vh]",
          },
        }}
        onUpdate={({ editor }) => {
          if (onChange) {
            onChange(getMarkdown(editor));
          }
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
        </EditorBubble>
      </EditorContent>
    </EditorRoot>
  );
}

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
