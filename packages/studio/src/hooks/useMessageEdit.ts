import { useState, useCallback } from "react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface MessageHistory {
  messageId: string;
  versions: Array<{
    content: string;
    timestamp: number;
  }>;
  currentVersion: number;
}

export function useMessageEdit() {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [messageHistories, setMessageHistories] = useState<Map<string, MessageHistory>>(new Map());

  const startEdit = useCallback((messageId: string) => {
    setEditingMessageId(messageId);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingMessageId(null);
  }, []);

  const saveEdit = useCallback((
    messageId: string,
    newContent: string,
    messages: Message[],
    setMessages: (messages: Message[]) => void
  ) => {
    // Find message index
    const messageIndex = messages.findIndex((m) => m.id === messageId);
    if (messageIndex === -1) return;

    const oldMessage = messages[messageIndex];

    // Save to history
    setMessageHistories((prev) => {
      const newHistories = new Map(prev);
      const history = newHistories.get(messageId) || {
        messageId,
        versions: [{ content: oldMessage.content, timestamp: oldMessage.timestamp }],
        currentVersion: 0,
      };

      history.versions.push({ content: newContent, timestamp: Date.now() });
      history.currentVersion = history.versions.length - 1;
      newHistories.set(messageId, history);

      return newHistories;
    });

    // Update message
    const updatedMessages = [...messages];
    updatedMessages[messageIndex] = {
      ...oldMessage,
      content: newContent,
      timestamp: Date.now(),
    };

    // Delete messages after this one
    const newMessages = updatedMessages.slice(0, messageIndex + 1);
    setMessages(newMessages);

    setEditingMessageId(null);

    return newMessages;
  }, []);

  const undoEdit = useCallback((messageId: string, messages: Message[], setMessages: (messages: Message[]) => void) => {
    const history = messageHistories.get(messageId);
    if (!history || history.currentVersion === 0) return;

    const newVersion = history.currentVersion - 1;
    const versionContent = history.versions[newVersion].content;

    setMessageHistories((prev) => {
      const newHistories = new Map(prev);
      const updatedHistory = { ...history, currentVersion: newVersion };
      newHistories.set(messageId, updatedHistory);
      return newHistories;
    });

    const messageIndex = messages.findIndex((m) => m.id === messageId);
    if (messageIndex === -1) return;

    const updatedMessages = [...messages];
    updatedMessages[messageIndex] = {
      ...updatedMessages[messageIndex],
      content: versionContent,
    };
    setMessages(updatedMessages);
  }, [messageHistories]);

  return {
    editingMessageId,
    startEdit,
    cancelEdit,
    saveEdit,
    undoEdit,
    messageHistories,
  };
}
