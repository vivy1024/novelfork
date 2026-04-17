/**
 * SessionList — Display and manage sessions with drag-and-drop sorting
 */

import { useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { SessionCard } from "./SessionCard";
import { useSession } from "../../hooks/useSession";

export function SessionList() {
  const {
    sessions,
    loaded,
    createSession,
    loadSession,
    renameSession,
    removeSession,
    reorderSessions,
    exportSession,
  } = useSession();

  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [showNewSession, setShowNewSession] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newModel, setNewModel] = useState("claude-opus-4-7");

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = sessions.findIndex((s) => s.id === active.id);
      const newIndex = sessions.findIndex((s) => s.id === over.id);
      const newOrder = arrayMove(sessions, oldIndex, newIndex);
      reorderSessions(newOrder);
    }
  };

  const handleDelete = (id: string) => {
    setShowDeleteConfirm(id);
  };

  const confirmDelete = () => {
    if (showDeleteConfirm) {
      removeSession(showDeleteConfirm);
      setShowDeleteConfirm(null);
    }
  };

  const handleRename = (id: string) => {
    const session = sessions.find((s) => s.id === id);
    if (session) {
      setRenameId(id);
      setRenameValue(session.title);
    }
  };

  const confirmRename = () => {
    if (renameId && renameValue.trim()) {
      renameSession(renameId, renameValue.trim());
      setRenameId(null);
      setRenameValue("");
    }
  };

  const handleCreateSession = async () => {
    if (newTitle.trim()) {
      await createSession(newTitle.trim(), newModel);
      setShowNewSession(false);
      setNewTitle("");
      setNewModel("claude-opus-4-7");
    }
  };

  if (!loaded) {
    return <div className="session-list-loading">Loading sessions...</div>;
  }

  return (
    <div className="session-list">
      <div className="session-list-header">
        <h2>Sessions</h2>
        <button
          onClick={() => setShowNewSession(true)}
          className="session-list-new-btn"
        >
          + New Session
        </button>
      </div>

      {showNewSession && (
        <div className="session-dialog">
          <div className="session-dialog-content">
            <h3>Create New Session</h3>
            <input
              type="text"
              placeholder="Session title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateSession()}
              autoFocus
            />
            <select value={newModel} onChange={(e) => setNewModel(e.target.value)}>
              <option value="claude-opus-4-7">Claude Opus 4.7</option>
              <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
              <option value="claude-haiku-4-5">Claude Haiku 4.5</option>
            </select>
            <div className="session-dialog-actions">
              <button onClick={handleCreateSession}>Create</button>
              <button onClick={() => setShowNewSession(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {renameId && (
        <div className="session-dialog">
          <div className="session-dialog-content">
            <h3>Rename Session</h3>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmRename()}
              autoFocus
            />
            <div className="session-dialog-actions">
              <button onClick={confirmRename}>Rename</button>
              <button onClick={() => setRenameId(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="session-dialog">
          <div className="session-dialog-content">
            <h3>Delete Session</h3>
            <p>Are you sure you want to delete this session? This cannot be undone.</p>
            <div className="session-dialog-actions">
              <button onClick={confirmDelete} className="session-dialog-danger">
                Delete
              </button>
              <button onClick={() => setShowDeleteConfirm(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={sessions} strategy={verticalListSortingStrategy}>
          <div className="session-list-items">
            {sessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                onClick={() => loadSession(session.id)}
                onDelete={() => handleDelete(session.id)}
                onRename={() => handleRename(session.id)}
                onExport={() => exportSession(session.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {sessions.length === 0 && (
        <div className="session-list-empty">
          <p>No sessions yet. Create one to get started.</p>
        </div>
      )}
    </div>
  );
}
