import { User, BotMessageSquare, Edit2 } from "lucide-react";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { MessageEditor } from "./MessageEditor";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface MessageItemProps {
  message: Message;
  isEditing?: boolean;
  onEdit?: (messageId: string) => void;
  onSaveEdit?: (messageId: string, newContent: string) => void;
  onCancelEdit?: () => void;
}

export function MessageItem({
  message,
  isEditing = false,
  onEdit,
  onSaveEdit,
  onCancelEdit
}: MessageItemProps) {
  const isUser = message.role === "user";
  const time = new Date(message.timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const handleClick = () => {
    if (!isEditing && onEdit) {
      onEdit(message.id);
    }
  };

  return (
    <div
      className={`flex gap-3 py-4 px-4 ${isUser ? "bg-background" : "bg-secondary/20"} ${
        !isEditing && onEdit ? "cursor-pointer hover:bg-secondary/30 transition-colors" : ""
      }`}
      onClick={!isEditing ? handleClick : undefined}
    >
      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
          isUser ? "bg-primary text-primary-foreground" : "bg-secondary"
        }`}
      >
        {isUser ? <User size={16} /> : <BotMessageSquare size={16} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium">{isUser ? "You" : "Assistant"}</span>
          <span className="text-xs text-muted-foreground">{time}</span>
          {!isEditing && onEdit && (
            <Edit2 size={12} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
        </div>
        {isEditing ? (
          <MessageEditor
            initialContent={message.content}
            onSave={(newContent) => onSaveEdit?.(message.id, newContent)}
            onCancel={() => onCancelEdit?.()}
          />
        ) : (
          <div className="text-sm">
            {isUser ? (
              <p className="whitespace-pre-wrap break-words">{message.content}</p>
            ) : (
              <MarkdownRenderer content={message.content} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
