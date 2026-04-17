import { useState, useRef, useEffect } from "react";
import { Check, X } from "lucide-react";

interface MessageEditorProps {
  initialContent: string;
  onSave: (content: string) => void;
  onCancel: () => void;
}

export function MessageEditor({ initialContent, onSave, onCancel }: MessageEditorProps) {
  const [content, setContent] = useState(initialContent);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Focus and select all on mount
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  const handleSave = () => {
    const trimmed = content.trim();
    if (trimmed && trimmed !== initialContent) {
      onSave(trimmed);
    } else {
      onCancel();
    }
  };

  return (
    <div className="flex-1 min-w-0">
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        className="w-full min-h-[60px] px-3 py-2 text-sm bg-background border border-primary rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-primary/50"
        placeholder="Edit message..."
      />
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={handleSave}
          className="flex items-center gap-1 px-3 py-1 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          title="Save (Ctrl+Enter)"
        >
          <Check size={14} />
          Save
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1 px-3 py-1 text-xs bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors"
          title="Cancel (Esc)"
        >
          <X size={14} />
          Cancel
        </button>
        <span className="text-xs text-muted-foreground ml-2">
          Ctrl+Enter to save, Esc to cancel
        </span>
      </div>
    </div>
  );
}
