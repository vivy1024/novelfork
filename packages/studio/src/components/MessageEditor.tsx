import { useState, useRef, useEffect } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

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
      <Textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        className="w-full min-h-[60px] resize-y"
        placeholder="编辑消息..."
      />
      <div className="flex items-center gap-2 mt-2">
        <Button size="sm" onClick={handleSave} title="保存（Ctrl+Enter）">
          <Check size={14} />
          保存
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel} title="取消（Esc）">
          <X size={14} />
          取消
        </Button>
        <span className="text-xs text-muted-foreground ml-2">
          Ctrl+Enter 保存，Esc 取消
        </span>
      </div>
    </div>
  );
}
