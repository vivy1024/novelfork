/**
 * SessionCard — Display a single session with actions
 */

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Session } from "../../hooks/useSession";

interface SessionCardProps {
  session: Session;
  onClick: () => void;
  onDelete: () => void;
  onRename: () => void;
  onExport: () => void;
}

export function SessionCard({
  session,
  onClick,
  onDelete,
  onRename,
  onExport,
}: SessionCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: session.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const formatDate = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="session-card"
      {...attributes}
    >
      <div className="session-card-drag" {...listeners}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="4" cy="4" r="1.5" />
          <circle cx="4" cy="8" r="1.5" />
          <circle cx="4" cy="12" r="1.5" />
          <circle cx="12" cy="4" r="1.5" />
          <circle cx="12" cy="8" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
        </svg>
      </div>

      <div className="session-card-content" onClick={onClick}>
        <div className="session-card-header">
          <h3 className="session-card-title">{session.title}</h3>
          <span className="session-card-model">{session.model}</span>
        </div>

        <div className="session-card-meta">
          <span>{session.messageCount} messages</span>
          <span>•</span>
          <span>{formatDate(session.lastModified)}</span>
          {session.worktree && (
            <>
              <span>•</span>
              <span className="session-card-worktree">{session.worktree}</span>
            </>
          )}
        </div>
      </div>

      <div className="session-card-actions">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRename();
          }}
          title="Rename"
          className="session-card-action"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor">
            <path d="M11 2L14 5L5 14H2V11L11 2Z" strokeWidth="1.5" />
          </svg>
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onExport();
          }}
          title="Export"
          className="session-card-action"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor">
            <path d="M8 2V10M8 10L5 7M8 10L11 7" strokeWidth="1.5" />
            <path d="M2 12V13C2 13.5523 2.44772 14 3 14H13C13.5523 14 14 13.5523 14 13V12" strokeWidth="1.5" />
          </svg>
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete"
          className="session-card-action session-card-action-danger"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor">
            <path d="M3 4H13M5 4V3C5 2.44772 5.44772 2 6 2H10C10.5523 2 11 2.44772 11 3V4M6 7V11M10 7V11M4 4L5 13C5 13.5523 5.44772 14 6 14H10C10.5523 14 11 13.5523 11 13L12 4" strokeWidth="1.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
